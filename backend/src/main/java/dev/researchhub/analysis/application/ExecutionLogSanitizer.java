package dev.researchhub.analysis.application;

import java.util.regex.Pattern;

/** Persist inert, bounded diagnostic summaries rather than terminal commands or credential-shaped values. */
public final class ExecutionLogSanitizer {
    public static final int MAX_CHARACTERS=8192;
    private static final Pattern OSC=Pattern.compile("\u001B\\][^\u0007\u001B]*(?:\u0007|\u001B\\\\|$)");
    private static final Pattern CSI=Pattern.compile("[\u001B\u009B]\\[[0-?]*[ -/]*[@-~]");
    private static final Pattern CONTROLS=Pattern.compile("[\\p{Cc}&&[^\\n\\t]]|[\u202A-\u202E\u2066-\u2069]");
    private static final Pattern CREDENTIALS=Pattern.compile(
        "(?i)(authorization\\s*:\\s*(?:bearer\\s+|basic\\s+)?|(?:api[_-]?key|access[_-]?token|password|secret)\\s*[:=]\\s*)[^\\s,;]+");
    private ExecutionLogSanitizer() {}
    public record Summary(String text, boolean truncated) {}
    public static Summary summarize(String raw) {
        if (raw==null) return new Summary("",false);
        String clean=OSC.matcher(raw).replaceAll("");
        clean=CSI.matcher(clean).replaceAll("");
        clean=CONTROLS.matcher(clean.replace("\r\n","\n").replace('\r','\n')).replaceAll("");
        clean=CREDENTIALS.matcher(clean).replaceAll("$1[redacted]");
        return new Summary(clean.substring(0,Math.min(MAX_CHARACTERS,clean.length())),clean.length()>MAX_CHARACTERS);
    }
}
