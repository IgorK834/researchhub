package dev.researchhub.export.domain;

import java.text.Normalizer;
import java.util.Locale;

public final class ExportFilename {
    private ExportFilename() {}
    public static String of(String title, ExportFormat format) {
        String stem=Normalizer.normalize(title,Normalizer.Form.NFKC)
            .replaceAll("[\\p{Cntrl}\\p{Cf}<>:\"/\\\\|?*]", "_").replaceAll("\\s+"," ").strip()
            .replaceAll("^[. ]+|[. ]+$","");
        if (stem.length()>100) {
            int end=Character.isHighSurrogate(stem.charAt(99)) ? 99 : 100;
            stem=stem.substring(0,end).replaceAll("[. ]+$","");
        }
        String device=stem.split("\\.",2)[0].toUpperCase(Locale.ROOT);
        if (stem.isBlank() || device.matches("CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]")) stem="report";
        return stem+"."+format.extension();
    }
}
