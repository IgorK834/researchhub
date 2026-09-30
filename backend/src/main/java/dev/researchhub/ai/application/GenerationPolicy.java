package dev.researchhub.ai.application;

/** Server-owned, versioned feature configuration shared by grounded model use cases. */
interface GenerationPolicy {
    String templateId();
    String templateHash();
    String systemInstruction();
    GenerationContracts.Parameters parameters();
}
