package dev.researchhub.auth.infrastructure;

import dev.researchhub.auth.application.MailSender;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("(local | demo) & !azure & !cloud")
public class LoggingMailSender implements MailSender {
    @Override public void send(Message message) {
        LoggerFactory.getLogger(getClass()).info("event=account.mail.local purpose={} link={}",message.purpose(),message.link());
    }
}
