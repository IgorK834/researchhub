package dev.researchhub.auth.application;

/** Adapter receives only account display name and action link; no workspace content. */
public interface MailSender {
    enum Purpose { RESET, VERIFY }
    record Message(String recipient,String displayName,Purpose purpose,String link) {
        @Override public String toString() { return "AccountMail[purpose="+purpose+", link=REDACTED]"; }
        public String subject() { return purpose==Purpose.RESET?"Reset your ResearchHub password":"Verify your ResearchHub email"; }
        public String text() { return "Hello "+displayName+",\n\n"+subject()+":\n"+link+"\n\nIf you did not request this, ignore this message."; }
    }
    void send(Message message);
}
