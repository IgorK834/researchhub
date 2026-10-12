package dev.researchhub.auth.application;

import dev.researchhub.auth.infrastructure.PostgresAccountTokenStore;
import dev.researchhub.security.application.*;
import dev.researchhub.shared.error.*;
import dev.researchhub.user.application.AccountSecurityService;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountLifecycleServiceTest {
    final PostgresAccountTokenStore tokens=mock(PostgresAccountTokenStore.class);
    final AccountSecurityService accounts=mock(AccountSecurityService.class);
    final AccountSessionService sessions=mock(AccountSessionService.class);
    final SecurityOperationLimiter limits=mock(SecurityOperationLimiter.class);
    final AccountAudit audit=mock(AccountAudit.class);
    final ApplicationEventPublisher events=mock(ApplicationEventPublisher.class);
    final Instant now=Instant.parse("2026-10-12T10:00:00Z");final UUID user=UUID.randomUUID();final String token=SecureTokens.create();
    final AccountLifecycleService service=new AccountLifecycleService(tokens,accounts,sessions,limits,audit,events,Clock.fixed(now,ZoneOffset.UTC),"https://app.example.test/");
    AccountSecurityService.Identity identity(Instant verified) {return new AccountSecurityService.Identity(user,"Ada@Example.test","ada@example.test","Ada",verified);}
    PostgresAccountTokenStore.Token row(MailSender.Purpose purpose,Instant expires,Instant used) {return new PostgresAccountTokenStore.Token(UUID.randomUUID(),"ada@example.test",purpose,expires,used);}
    @BeforeEach void lookup() {
        when(accounts.find(anyString())).thenReturn(Optional.of(identity(null)));
        when(tokens.find(anyString(),any())).thenAnswer(call -> tokens.lock(call.getArgument(0),call.getArgument(1)));
    }
    @Test void requestsDoTheSameWorkForEveryAddressAndEmitOnlyInMemorySecrets() {
        service.requestReset(" Ada@Example.test ","127.0.0.1");verifyNoInteractions(accounts,sessions,audit);
        var event=ArgumentCaptor.forClass(AccountMailRequested.class);verify(events).publishEvent(event.capture());
        assertTrue(event.getValue().link().startsWith("https://app.example.test/reset-password#"));
        String secret=event.getValue().link().split("#")[1];assertTrue(SecureTokens.valid(secret));assertFalse(event.getValue().toString().contains(secret));
        verify(tokens).create("ada@example.test",MailSender.Purpose.RESET,SecureTokens.hash(secret),now,now.plusSeconds(1800));
        when(accounts.require(user)).thenReturn(identity(null));service.requestVerification(user);
        verify(tokens).create(eq("ada@example.test"),eq(MailSender.Purpose.VERIFY),anyString(),eq(now),eq(now.plusSeconds(86400)));
        clearInvocations(tokens,events);when(accounts.require(user)).thenReturn(identity(now));service.requestVerification(user);verifyNoInteractions(tokens,events);
    }
    @Test void resetAndVerificationAreSingleUseWithPurposeAndEmailBinding() {
        var reset=row(MailSender.Purpose.RESET,now.plusSeconds(1),null);when(tokens.lock(SecureTokens.hash(token),MailSender.Purpose.RESET)).thenReturn(Optional.of(reset));
        when(accounts.find(reset.email())).thenReturn(Optional.of(identity(null)));service.reset(token,"valid-password-new","ip");
        verify(accounts).resetPassword(user,"valid-password-new");verify(tokens).use(reset.id(),now);verify(sessions).revokeAll(user,null);verify(audit).record(user,AccountAudit.Type.PASSWORD_RESET);
        var verification=row(MailSender.Purpose.VERIFY,now.plusSeconds(1),null);when(tokens.lock(SecureTokens.hash(token),MailSender.Purpose.VERIFY)).thenReturn(Optional.of(verification));
        when(accounts.require(user)).thenReturn(identity(null));service.verify(token,user);verify(accounts).verifyEmail(user);verify(audit).record(user,AccountAudit.Type.EMAIL_VERIFIED);
        when(accounts.require(user)).thenReturn(new AccountSecurityService.Identity(user,"wrong@example.test","wrong@example.test","Wrong",null));assertThrows(ApiException.class,()->service.verify(token,user));
    }
    @Test void missingExpiredUsedMalformedAndUnknownAccountLinksAllRejectWithoutEchoingSecret() {
        assertThrows(ApiException.class,()->service.reset("invalid","password","ip"));
        when(tokens.lock(anyString(),eq(MailSender.Purpose.RESET))).thenReturn(Optional.empty());assertThrows(ApiException.class,()->service.reset(token,"password","ip"));
        for(var row:List.of(row(MailSender.Purpose.RESET,now,null),row(MailSender.Purpose.RESET,now.plusSeconds(2),now))) {
            when(tokens.lock(anyString(),eq(MailSender.Purpose.RESET))).thenReturn(Optional.of(row));var ex=assertThrows(ApiException.class,()->service.reset(token,"password","ip"));assertFalse(ex.getMessage().contains(token));
        }
        when(tokens.lock(anyString(),eq(MailSender.Purpose.RESET))).thenReturn(Optional.of(row(MailSender.Purpose.RESET,now.plusSeconds(2),null)));
        when(accounts.find(anyString())).thenReturn(Optional.empty());assertThrows(ApiException.class,()->service.reset(token,"password","ip"));verifyNoInteractions(sessions,audit);
    }
    @Test void linksOnlyUseConfiguredHttpOrigins() {
        for(String bad:List.of("file:///secret","https://app.test?token=x","https://app.test#x","https://user:password@app.test"))
            assertThrows(IllegalStateException.class,()->new AccountLifecycleService(tokens,accounts,sessions,limits,audit,events,Clock.systemUTC(),bad));
    }
}
