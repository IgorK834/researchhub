package dev.researchhub.auth.infrastructure;

import dev.researchhub.auth.application.*;
import dev.researchhub.user.application.AccountSecurityService;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AccountMailTest {
    @Test void smtpTemplatesContainOnlyDisplayNameAndActionAndNeverLogLink() {
        var smtp=mock(JavaMailSender.class);var sender=new SmtpMailSender(smtp,"noreply@example.test","https://app.test");
        for(var purpose:MailSender.Purpose.values()) {
            var message=new MailSender.Message("recipient@example.test","Ada",purpose,"https://app.test/#secret");sender.send(message);
            assertFalse(message.toString().contains("secret"));assertTrue(message.text().contains("Ada"));assertTrue(message.text().contains(message.link()));
            assertFalse(message.text().contains(message.recipient()));assertFalse(message.text().contains("workspace"));
        }
        var captor=org.mockito.ArgumentCaptor.forClass(SimpleMailMessage.class);verify(smtp,times(2)).send(captor.capture());
        assertEquals("noreply@example.test",captor.getValue().getFrom());assertEquals("recipient@example.test",captor.getValue().getTo()[0]);
        assertThrows(IllegalStateException.class,()->new SmtpMailSender(smtp,"","https://app.test"));
        assertThrows(IllegalStateException.class,()->new SmtpMailSender(smtp,"noreply@example.test","http://app.test"));
    }
    @Test void smtpForcesDebugOffEvenForAnAlreadyInitializedMailSession() {
        var smtp=new org.springframework.mail.javamail.JavaMailSenderImpl();
        smtp.getJavaMailProperties().setProperty("mail.debug","true");smtp.getSession().setDebug(true);
        new SmtpMailSender(smtp,"noreply@example.test","https://app.test");assertFalse(smtp.getSession().getDebug());
        assertEquals("false",smtp.getJavaMailProperties().getProperty("mail.debug.auth"));
    }
    @Test void azureAndCloudDisableLoggingAdapterEvenWhenLocalIsAlsoSelected() {
        for(String[] profiles:List.of(new String[]{"azure","local"},new String[]{"cloud","demo"},new String[]{"azure"})) {
            try(var context=new AnnotationConfigApplicationContext()) {
                context.getEnvironment().setActiveProfiles(profiles);context.register(LoggingMailSender.class);context.refresh();assertTrue(context.getBeansOfType(MailSender.class).isEmpty());
            }
        }
    }
    @Test void deliveryDoesNothingForUnknownEmailsAndSanitizesMailFailures() {
        var accounts=mock(AccountSecurityService.class);var mail=mock(MailSender.class);var delivery=new AccountMailDelivery(accounts,mail);
        var event=new AccountMailRequested("ada@example.test",MailSender.Purpose.RESET,"https://app.test/#secret");
        when(accounts.find(event.normalizedEmail())).thenReturn(Optional.empty());delivery.deliver(event);verifyNoInteractions(mail);
        when(accounts.find(event.normalizedEmail())).thenReturn(Optional.of(new AccountSecurityService.Identity(UUID.randomUUID(),"ada@example.test","ada@example.test","Ada",null)));
        delivery.deliver(event);verify(mail).send(any());doThrow(new RuntimeException("SMTP secret body")).when(mail).send(any());assertDoesNotThrow(()->delivery.deliver(event));
    }
    @Test void secretRequestRecordsAreRedacted() {
        assertFalse(new dev.researchhub.auth.api.AccountLifecycleController.TokenRequest("secret").toString().contains("secret"));
        assertFalse(new dev.researchhub.auth.api.AccountLifecycleController.ResetRequest("secret","password").toString().contains("secret"));
        assertFalse(new dev.researchhub.auth.api.AccountSettingsController.PasswordRequest("secret","password").toString().contains("secret"));
        assertFalse(new dev.researchhub.user.application.RegisterUserCommand("a@test.example","password","A","secret").toString().contains("secret"));
        assertFalse(new dev.researchhub.auth.api.RegisterRequest("a@test.example","password","A","secret").toString().contains("secret"));
    }
}
