package dev.researchhub.source.application;

import java.time.Instant;
import java.util.UUID;

/** Lightweight audit history; extracted text is stored only in the current source extraction. */
public record ExtractionRun(UUID jobId, String parserVersion, String processingVersion, String schemaVersion,
                            String payloadSha256, Instant persistedAt, String jobStatus, String retrievalProcessingVersion, dev.researchhub.ai.application.ChunkingConfig chunkingConfig) {}
