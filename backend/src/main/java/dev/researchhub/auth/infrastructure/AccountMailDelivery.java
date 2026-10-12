package dev.researchhub.auth.infrastructure;

import dev.researchhub.auth.application.*;
import dev.researchhub.user.application.AccountSecurityService;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class AccountMailDelivery {
    private final AccountSecurityService accounts;
    private final MailSender mail;
    public AccountMailDelivery(AccountSecurityService accounts,MailSender mail) { this.accounts=accounts;this.mail=mail; }
    @Async
    @TransactionalEventListener
    public void deliver(AccountMailRequested event) {
        // No account lookup or SMTP work is done on the request thread, avoiding enumeration via latency.
        try {
            accounts.find(event.normalizedEmail()).ifPresent(user -> mail.send(new MailSender.Message(
                user.email(),user.displayName(),event.purpose(),event.link())));
        } catch (RuntimeException unavailable) {
            // SMTP exception text can contain message bodies: never pass the exception to a logger.
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("event=account.mail.failed purpose={}",event.purpose());
        }
    }
}
