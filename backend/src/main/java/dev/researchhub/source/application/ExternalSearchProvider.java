package dev.researchhub.source.application;

import java.util.List;
import dev.researchhub.source.application.ExternalSourceContracts.Result;

/** Discovery only: no model generation, page downloads or implicit imports. */
public interface ExternalSearchProvider {
    boolean available();
    String name();
    List<Result> search(String query);
}
