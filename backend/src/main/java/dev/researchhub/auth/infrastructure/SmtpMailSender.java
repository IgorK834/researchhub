package dev.researchhub.auth.infrastructure;

import dev.researchhub.auth.application.MailSender;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

@Component
@Profile("azure")
public class SmtpMailSender implements MailSender {
    private final JavaMailSender smtp;
    private final String from;
    public SmtpMailSender(JavaMailSender smtp,@Value("${researchhub.auth.mail.from}") String from,
                          @Value("${researchhub.auth.mail.public-base-url}") String publicBaseUrl) {
        if (!"https".equals(java.net.URI.create(publicBaseUrl).getScheme())) throw new IllegalStateException("Azure account links require an HTTPS public base URL");
        if (from.isBlank()) throw new IllegalStateException("Mail sender address is required");
        this.smtp=smtp;this.from=from;
        if (smtp instanceof org.springframework.mail.javamail.JavaMailSenderImpl adapter) {
            adapter.getJavaMailProperties().setProperty("mail.debug","false");
            adapter.getJavaMailProperties().setProperty("mail.debug.auth","false");
            adapter.getSession().setDebug(false);
        }
    }
    @Override public void send(Message message) {
        var mail=new SimpleMailMessage(); mail.setFrom(from);mail.setTo(message.recipient());
        mail.setSubject(message.subject());mail.setText(message.text());smtp.send(mail);
    }
}
