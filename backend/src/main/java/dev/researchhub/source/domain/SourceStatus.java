package dev.researchhub.source.domain;

import java.util.Set;

/**
 * Where a source is in processing. Pinned by {@code ck_sources_status}.
 *
 * <pre>
 *   UPLOADED ──▶ PROCESSING ──▶ READY
 *                   ▲   │
 *                   │   ▼
 *                   └─ FAILED
 * </pre>
 *
 * <p>A new source is {@link #UPLOADED}: its bytes are stored and its metadata recorded, and nothing has read it yet.
 * Ingestion moves it to {@link #PROCESSING} and then to {@link #READY} or {@link #FAILED}. A failed source may be
 * processed again. READY is final within a run. Explicit reprocessing creates another job for the same immutable
 * file and retains parser/processing provenance. Changed input must be uploaded as a new source.
 */
public enum SourceStatus {

    /** Stored and recorded; not yet processed. */
    UPLOADED,

    /** Being read by ingestion. */
    PROCESSING,

    /** Processed; usable by retrieval and analysis. */
    READY,

    /** Processing failed. The original is kept, and it may be processed again. */
    FAILED;

    /** The statuses this one may move to. */
    public Set<SourceStatus> next() {
        return switch (this) {
            case UPLOADED, FAILED -> Set.of(PROCESSING);
            case PROCESSING -> Set.of(READY, FAILED);
            case READY -> Set.of();
        };
    }

    public boolean canMoveTo(SourceStatus target) {
        return next().contains(target);
    }

}
