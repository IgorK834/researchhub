package dev.researchhub.ai.application;

import dev.researchhub.shared.localization.ContentLanguage;

/** Server-owned language constraint participates in the frozen prompt hash and normal context/token budget. */
final class LocalizedGenerationPolicy implements GenerationPolicy {
    private final GenerationPolicy base;
    private final String instruction;
    private LocalizedGenerationPolicy(GenerationPolicy base, ContentLanguage language) {
        this.base=base;
        this.instruction=base.systemInstruction()+"\n"+language.choose(
                "Write the answer and proposed prose in English.", "Write the answer and proposed prose in Polish.")
            +" Keep original source quotations, bibliographic titles, citation keys, mathematical notation, units and scientific values unchanged. Language selection never authorizes invented facts or new evidence.";
    }
    static GenerationPolicy of(GenerationPolicy base, ContentLanguage language) {
        // Old retained requests preserve their original prompt identity.
        return language==null ? base : new LocalizedGenerationPolicy(base,language);
    }
    static GenerationPolicy template(String id,String instruction,GenerationContracts.Parameters parameters,ContentLanguage language) {
        return of(new Base(id,instruction,parameters),language);
    }
    private record Base(String templateId,String systemInstruction,GenerationContracts.Parameters parameters) implements GenerationPolicy {
        public String templateHash() { return RetrievalIdentity.hash(systemInstruction); }
    }
    // Worker routing uses the existing template family; exact language variation is frozen in the hash.
    public String templateId() { return base.templateId(); }
    public String templateHash() { return RetrievalIdentity.hash(instruction); }
    public String systemInstruction() { return instruction; }
    public GenerationContracts.Parameters parameters() { return base.parameters(); }
}
