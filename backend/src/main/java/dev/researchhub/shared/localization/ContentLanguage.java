package dev.researchhub.shared.localization;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/** Explicit content/export choice. Never resolved from Accept-Language or a shared account preference. */
public enum ContentLanguage {
    EN("en", "en-US"), PL("pl", "pl-PL");
    private final String code;
    private final String locale;
    ContentLanguage(String code, String locale) { this.code = code; this.locale = locale; }
    @JsonValue public String code() { return code; }
    public String locale() { return locale; }
    public String choose(String english, String polish) { return this == PL ? polish : english; }
    @JsonCreator public static ContentLanguage from(String code) {
        if ("en".equals(code)) return EN;
        if ("pl".equals(code)) return PL;
        throw new IllegalArgumentException("Only en and pl content languages are supported");
    }
}
