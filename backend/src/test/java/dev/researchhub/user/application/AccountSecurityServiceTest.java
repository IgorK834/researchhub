package dev.researchhub.user.application;

import dev.researchhub.user.infrastructure.*;
import dev.researchhub.user.domain.UserStatus;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountSecurityServiceTest {
    final UserRepository users=mock(UserRepository.class);final PasswordEncoder encoder=mock(PasswordEncoder.class);
    final Instant now=Instant.parse("2026-10-12T10:00:00Z");final AccountSecurityService service=new AccountSecurityService(users,encoder,new PasswordPolicy(12),Clock.fixed(now,ZoneOffset.UTC));
    final UUID id=UUID.randomUUID();
    UserEntity row() {
        var row=mock(UserEntity.class);when(row.getId()).thenReturn(id);when(row.getStatus()).thenReturn(UserStatus.ACTIVE);
        when(row.getNormalizedEmail()).thenReturn("ada@example.test");when(row.getEmail()).thenReturn("Ada@example.test");when(row.getDisplayName()).thenReturn("Ada");when(row.getPasswordHash()).thenReturn("hash");return row;
    }
    @Test void lookupNormalizesAndRejectsInactiveOrUnknownUsers() {
        assertEquals("ada@example.test",AccountSecurityService.normalize(" Ada@Example.test "));assertThrows(ApiException.class,()->AccountSecurityService.normalize("invalid"));
        var row=row();when(users.findById(id)).thenReturn(Optional.of(row));assertEquals(id,service.require(id).id());
        when(users.findByNormalizedEmail("ada@example.test")).thenReturn(Optional.of(row));assertTrue(service.find("ada@example.test").isPresent());
        when(row.getStatus()).thenReturn(UserStatus.DISABLED);assertThrows(UnauthenticatedException.class,()->service.require(id));assertTrue(service.find("ada@example.test").isEmpty());
        when(users.findById(id)).thenReturn(Optional.empty());assertThrows(UnauthenticatedException.class,()->service.require(id));
    }
    @Test void passwordMutationLocksAccountVerifiesCurrentAndUsesPolicy() {
        var row=row();when(users.findByIdForUpdate(id)).thenReturn(Optional.of(row));when(encoder.matches("current","hash")).thenReturn(true);
        assertThrows(UnauthenticatedException.class,()->service.changePassword(id,"wrong","replacement-long-password"));
        assertThrows(UnauthenticatedException.class,()->service.changePassword(id,null,"replacement-long-password"));
        assertThrows(UnauthenticatedException.class,()->service.changePassword(id,"é".repeat(40),"replacement-long-password"));
        assertThrows(ApiException.class,()->service.changePassword(id,"current","short"));
        when(encoder.encode("replacement-long-password")).thenReturn("new hash");service.changePassword(id,"current","replacement-long-password");verify(row).changePassword("new hash",now);verify(users).flush();
        service.resetPassword(id,"replacement-long-password");verify(row,times(2)).changePassword("new hash",now);
        when(row.getStatus()).thenReturn(UserStatus.DISABLED);assertThrows(UnauthenticatedException.class,()->service.resetPassword(id,"replacement-long-password"));
        when(users.findByIdForUpdate(id)).thenReturn(Optional.empty());assertThrows(UnauthenticatedException.class,()->service.verifyEmail(id));
    }
    @Test void emailVerificationKeepsOriginalVerificationTime() {
        var row=row();when(users.findByIdForUpdate(id)).thenReturn(Optional.of(row));service.verifyEmail(id);verify(row).verifyEmail(now);
        when(row.getEmailVerifiedAt()).thenReturn(now);service.verifyEmail(id);verify(row,times(1)).verifyEmail(now);
    }
}
