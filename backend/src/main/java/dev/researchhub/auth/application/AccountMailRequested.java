package dev.researchhub.auth.application;

/** In-memory event only: the secret is delivered after the hashed token transaction commits. */
public record AccountMailRequested(String normalizedEmail,MailSender.Purpose purpose,String link) {
    @Override public String toString() { return "AccountMailRequested[purpose="+purpose+", link=REDACTED]"; }
}
