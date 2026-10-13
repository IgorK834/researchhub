package dev.researchhub.source.application;

import dev.researchhub.shared.error.ApiErrorCode;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.shared.error.ConflictException;
import dev.researchhub.shared.error.PayloadTooLargeException;
import dev.researchhub.shared.error.ResourceNotFoundException;
import dev.researchhub.source.application.BibliographyImportContracts.*;
import dev.researchhub.source.domain.SourceFilename;
import dev.researchhub.source.domain.SourceLabels;
import dev.researchhub.source.infrastructure.PostgresBibliographyImportStore;
import dev.researchhub.source.infrastructure.PostgresBibliographyImportStore.Candidate;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Preview/confirm workflow for file bibliography migration; no imported metadata enters retrieval. */
@Service
public class BibliographyImportService {
    public static final int MAX_FILE_BYTES = 2 * 1024 * 1024;
    public static final int MAX_RECORDS = 1000;
    private static final String NOT_FOUND = "Bibliography import was not found";

    private final BibliographyParser parser;
    private final PostgresBibliographyImportStore store;
    private final WorkspaceAuthorizationService authorization;
    private final ObjectMapper json;
    private final Clock clock;
    private final dev.researchhub.security.application.UploadInspector inspector;

    public BibliographyImportService(BibliographyParser parser, PostgresBibliographyImportStore store,
                                     WorkspaceAuthorizationService authorization, ObjectMapper json, Clock clock,
                                     dev.researchhub.security.application.UploadInspector inspector) {
        this.parser = parser;
        this.store = store;
        this.authorization = authorization;
        this.json = json;
        this.clock = clock;
        this.inspector = inspector;
    }

    public Preview preview(UUID workspaceId, UUID callerId, String originalFilename, long declaredSize,
                           Format requestedFormat, Origin origin, InputStream content) {
        authorization.requireContentEditor(workspaceId, callerId);
        if (content == null) throw invalid("A bibliography file is required");
        if (declaredSize > MAX_FILE_BYTES) throw tooLarge();
        byte[] bytes = readBounded(content);
        if (bytes.length == 0) throw invalid("The bibliography file is empty");
        inspect(bytes);
        String fileName;
        try { fileName = SourceFilename.of(originalFilename).value(); }
        catch (IllegalArgumentException invalid) { throw invalid(invalid.getMessage()); }
        Format format = requestedFormat == null ? format(fileName) : requestedFormat;
        Origin safeOrigin = origin == null ? Origin.GENERIC : origin;
        String hash = sha256(bytes);
        var existing = store.findActive(workspaceId, hash);
        if (existing.isPresent()) return withStatus(existing.get());

        ParsedBatch batch;
        try { batch = parser.parse(format, bytes); }
        catch (IllegalArgumentException invalid) { throw invalid(invalid.getMessage()); }
        int total = batch.records().size() + batch.errors().size();
        if (total > MAX_RECORDS) throw new PayloadTooLargeException("A bibliography import may contain at most 1000 records");
        List<Candidate> candidates = store.candidates(workspaceId);
        var duplicateKeys = duplicateCitationKeys(batch.records());
        var records = new ArrayList<PreviewRecord>();
        var seen = new ArrayList<ParsedRecord>();
        for (ParsedRecord parsed : batch.records()) {
            var matches = organizationMatches(matches(parsed.bibliography(), candidates),parsed.tags(),parsed.collections());
            var issues = new ArrayList<>(parsed.warnings());
            RecordStatus status;
            String key = parsed.bibliography().citationKey();
            var batchDuplicate = seen.stream().filter(previous -> equivalent(parsed.bibliography(),previous.bibliography()))
                    .findFirst();
            if (key != null && duplicateKeys.containsKey(key.toLowerCase(Locale.ROOT))) {
                status = RecordStatus.CONFLICT;
                issues.add("Citation key is repeated in records " + duplicateKeys.get(key.toLowerCase(Locale.ROOT)));
            } else if (batchDuplicate.isPresent()) {
                status = RecordStatus.DUPLICATE;
                issues.add("Duplicate of record " + batchDuplicate.get().recordNumber() + " in this file");
            } else if (store.citationKeyExists(workspaceId,key,null) && matches.isEmpty()) {
                status = RecordStatus.CONFLICT;
                issues.add("Citation key is already used by another entry in this workspace");
            } else if (matches.isEmpty()) status = RecordStatus.READY;
            else if (matches.stream().allMatch(match -> match.conflictingFields().isEmpty())) status = RecordStatus.DUPLICATE;
            else status = RecordStatus.CONFLICT;
            records.add(new PreviewRecord(parsed.recordNumber(), parsed.location(), status, parsed.itemType(),
                    parsed.bibliography(), parsed.tags(), parsed.collections(), parsed.ignoredAttachments(), issues,matches));
            seen.add(parsed);
        }
        for (ParseError error : batch.errors()) records.add(new PreviewRecord(error.recordNumber(), error.location(),
                RecordStatus.REJECTED, null, null, List.of(), List.of(), 0, List.of(error.message()), List.of()));
        records.sort(Comparator.comparingInt(PreviewRecord::recordNumber));
        Instant now = clock.instant();
        Preview preview = new Preview(UUID.randomUUID(), workspaceId, fileName, hash, format, safeOrigin, "PREVIEWED",
                total, count(records, RecordStatus.READY), count(records, RecordStatus.DUPLICATE),
                count(records, RecordStatus.CONFLICT), count(records, RecordStatus.REJECTED), records, now);
        try { store.create(preview, callerId); }
        catch (DataIntegrityViolationException raced) {
            return store.findActive(workspaceId, hash).map(this::withStatus).orElseThrow(() -> raced);
        }
        return preview;
    }

    @Transactional(readOnly = true)
    public Preview find(UUID workspaceId, UUID callerId, UUID importId) {
        authorization.requireContentReader(workspaceId, callerId);
        return withStatus(store.find(workspaceId, importId).orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND)));
    }

    @Transactional
    public Result confirm(UUID workspaceId, UUID callerId, UUID importId, ConfirmRequest request) {
        authorization.requireContentEditor(workspaceId, callerId);
        ConfirmRequest safeRequest = request == null ? new ConfirmRequest(List.of()) : request;
        Map<Integer, Decision> decisions = decisions(safeRequest);
        String requestHash = confirmationHash(safeRequest);
        var row = store.findForUpdate(workspaceId, importId)
                .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
        if ("CONFIRMED".equals(row.status())) {
            if (!Objects.equals(row.confirmationSha256(), requestHash))
                throw new ConflictException("This import was already confirmed with different decisions");
            return row.result();
        }
        if (!"PREVIEWED".equals(row.status())) throw new ConflictException("A cancelled import cannot be confirmed");

        Preview preview = row.preview();
        if (decisions.keySet().stream().anyMatch(number -> preview.records().stream().noneMatch(r -> r.recordNumber()==number)))
            throw invalid("A decision refers to an unknown record");
        store.serializeWorkspace(workspaceId);
        List<Candidate> currentCandidates = store.candidates(workspaceId);
        var results = new ArrayList<RecordResult>();
        Instant now = clock.instant();
        for (PreviewRecord record : preview.records()) {
            Decision decision = decisions.get(record.recordNumber());
            if (record.status() == RecordStatus.REJECTED) {
                persist(workspaceId, importId, record.recordNumber(), ConfirmAction.SKIP, Outcome.REJECTED,
                        null, null, null, now, results);
                continue;
            }
            ConfirmAction action = decision == null ? defaultAction(record.status()) : decision.action();
            if (action == null) throw invalid("Every import decision needs an action");
            SourceBibliography accepted = decision != null && decision.acceptedBibliography() != null
                    ? normalize(decision.acceptedBibliography()) : record.bibliography();
            switch (action) {
                case SKIP -> persist(workspaceId, importId, record.recordNumber(), action,
                        record.status() == RecordStatus.DUPLICATE ? Outcome.DUPLICATE : Outcome.SKIPPED,
                        null, null, null, now, results);
                case LINK_SOURCE -> {
                    Candidate before = selectedCandidate(record,decision,currentCandidates,MatchKind.SOURCE,false);
                    UUID target = before.id();
                    if (decision.mergeOrganization()) merge(workspaceId,before,before.bibliography(),record,now);
                    persist(workspaceId, importId, record.recordNumber(), action, Outcome.LINKED, accepted,
                            MatchKind.SOURCE, target, now, results);
                }
                case REPLACE_SOURCE, REPLACE_ITEM -> {
                    MatchKind kind=action==ConfirmAction.REPLACE_SOURCE?MatchKind.SOURCE:MatchKind.BIBLIOGRAPHIC_ITEM;
                    Candidate before=selectedCandidate(record,decision,currentCandidates,kind,true);
                    UUID target = before.id();
                    requireCitationKeyAvailable(workspaceId, accepted, target);
                    if (currentCandidates.stream().anyMatch(c -> !c.id().equals(target) && equivalent(accepted,c.bibliography())))
                        throw duplicateConflict();
                    try { merge(workspaceId,before,accepted,decision.mergeOrganization()?record:null,now); }
                    catch (DataIntegrityViolationException duplicate) { throw duplicateConflict(); }
                    persist(workspaceId, importId, record.recordNumber(), action, Outcome.UPDATED, accepted,
                            kind, target, now, results);
                }
                case CREATE -> {
                    if (record.status() != RecordStatus.READY && (decision == null || decision.acceptedBibliography() == null))
                        throw invalid("A conflicting record needs an explicit accepted metadata version before creating a separate item");
                    var present=matches(accepted,currentCandidates);
                    if(!present.isEmpty()) {
                        if(present.stream().anyMatch(m -> !m.conflictingFields().isEmpty())) throw duplicateConflict();
                        Match duplicate=present.getFirst();
                        persist(workspaceId,importId,record.recordNumber(),action,Outcome.DUPLICATE,null,
                                duplicate.kind(),duplicate.id(),now,results);
                        continue;
                    }
                    requireCitationKeyAvailable(workspaceId, accepted, null);
                    UUID target;
                    try {
                        target = store.createItem(workspaceId, callerId, record.itemType(), accepted,
                                SourceLabels.normalize(record.tags()), SourceLabels.normalize(record.collections()),
                                fingerprint(accepted), importId, record.recordNumber(), preview.fileSha256(), now);
                    } catch (DataIntegrityViolationException duplicate) { throw duplicateConflict(); }
                    currentCandidates = new ArrayList<>(currentCandidates);
                    currentCandidates.add(new Candidate(MatchKind.BIBLIOGRAPHIC_ITEM, target,
                            accepted.title() == null ? "Untitled reference" : accepted.title(), accepted,record.tags(),record.collections()));
                    persist(workspaceId, importId, record.recordNumber(), action, Outcome.CREATED, accepted,
                            MatchKind.BIBLIOGRAPHIC_ITEM, target, now, results);
                }
            }
        }
        Result result = result(importId, results, now);
        store.confirm(workspaceId, importId, requestHash, result);
        return result;
    }

    @Transactional(readOnly=true)
    public ItemPage items(UUID workspace,UUID caller,int offset) {
        authorization.requireContentReader(workspace,caller);
        if(offset<0||offset>100000)throw invalid("Bibliography offset must be between 0 and 100000");
        return store.items(workspace,offset);
    }

    @Transactional
    public void updateItem(UUID workspace,UUID caller,UUID id,ItemUpdate request) {
        authorization.requireContentEditor(workspace,caller);
        if(request==null||request.expectedUpdatedAt()==null)throw invalid("An expected metadata version is required");
        store.serializeWorkspace(workspace);
        try {
            var accepted=normalize(request.bibliography());
            var tags=SourceLabels.normalize(request.tags());
            var collections=SourceLabels.normalize(request.collections());
            requireCitationKeyAvailable(workspace,accepted,id);
            if(!store.updateItem(workspace,id,new ItemUpdate(accepted,tags,collections,request.expectedUpdatedAt()),
                    fingerprint(accepted),clock.instant()))throw new ConflictException("Bibliography metadata changed; reload before saving");
        }catch(IllegalArgumentException bad){throw invalid(bad.getMessage());}
        catch(DataIntegrityViolationException duplicate){throw duplicateConflict();}
    }

    @Transactional(readOnly=true)
    public Result savedResult(UUID workspace,UUID caller,UUID id) {
        authorization.requireContentReader(workspace,caller);
        var row=store.find(workspace,id).orElseThrow(()->new ResourceNotFoundException(NOT_FOUND));
        if(row.result()==null)throw new ConflictException("This import has not been confirmed");
        return row.result();
    }

    @Transactional
    public void cancel(UUID workspaceId, UUID callerId, UUID importId) {
        authorization.requireContentEditor(workspaceId, callerId);
        var row = store.findForUpdate(workspaceId, importId)
                .orElseThrow(() -> new ResourceNotFoundException(NOT_FOUND));
        if ("CANCELLED".equals(row.status())) return;
        if ("CONFIRMED".equals(row.status())) throw new ConflictException("A confirmed import cannot be cancelled");
        if (!store.cancel(workspaceId, importId, clock.instant())) throw new ConflictException("Bibliography import state changed");
    }

    private void persist(UUID workspaceId, UUID importId, int number, ConfirmAction action, Outcome outcome,
                         SourceBibliography accepted, MatchKind kind, UUID target, Instant now,
                         List<RecordResult> results) {
        store.record(workspaceId, importId, number, action, outcome, accepted, kind, target, now);
        results.add(new RecordResult(number, outcome, kind, target));
    }

    private static Candidate selectedCandidate(PreviewRecord record, Decision decision,List<Candidate> candidates,
                                               MatchKind kind,boolean requirePreview) {
        if (decision == null || decision.targetId() == null) throw invalid("Link and replace decisions require a source id");
        Candidate selected=candidates.stream().filter(c -> c.kind()==kind&&c.id().equals(decision.targetId()))
                .findFirst().orElseThrow(()->new ResourceNotFoundException("The selected bibliography destination was not found"));
        if(requirePreview) {
            Match old=record.matches().stream().filter(m -> m.kind()==kind&&m.id().equals(selected.id()))
                    .findFirst().orElseThrow(()->invalid("Replacement requires a previewed conflict"));
            if(!old.existingBibliography().equals(selected.bibliography())||!old.tags().equals(selected.tags())
                    ||!old.collections().equals(selected.collections()))
                throw new ConflictException("Destination metadata changed since preview; create a new preview");
        }
        return selected;
    }

    private void merge(UUID workspace,Candidate before,SourceBibliography metadata,PreviewRecord imported,Instant now) {
        var tags=new ArrayList<>(before.tags());var collections=new ArrayList<>(before.collections());
        if(imported!=null){tags.addAll(imported.tags());collections.addAll(imported.collections());}
        try {
            // Dedupe before enforcing SourceOrganization's 20-label bound.
            var normalizedTags=SourceLabels.normalize(tags.stream().distinct().toList());
            var normalizedCollections=SourceLabels.normalize(collections.stream().distinct().toList());
            if(!store.updateCandidate(workspace,before,metadata,normalizedTags,normalizedCollections,fingerprint(metadata),now))
                throw new ConflictException("Destination metadata changed during confirmation");
        }catch(IllegalArgumentException bad){throw invalid(bad.getMessage());}
    }

    private void requireCitationKeyAvailable(UUID workspaceId, SourceBibliography accepted, UUID exceptSource) {
        if (store.citationKeyExists(workspaceId, accepted.citationKey(), exceptSource)) throw duplicateConflict();
    }

    private static ConflictException duplicateConflict() {
        return new ConflictException("The accepted DOI, metadata fingerprint, or citation key is already present in this workspace");
    }

    private static SourceBibliography normalize(SourceBibliography value) {
        if (value == null) throw invalid("Accepted bibliography metadata is required");
        try { return SourceBibliography.from(value.toDomain()); }
        catch (IllegalArgumentException invalid) { throw invalid(invalid.getMessage()); }
    }

    private static ConfirmAction defaultAction(RecordStatus status) {
        return status == RecordStatus.READY ? ConfirmAction.CREATE : ConfirmAction.SKIP;
    }

    private static Map<Integer, Decision> decisions(ConfirmRequest request) {
        var result = new HashMap<Integer, Decision>();
        for (Decision decision : request.decisions()) {
            if (decision == null || decision.recordNumber() < 1 || decision.recordNumber() > MAX_RECORDS
                    || result.put(decision.recordNumber(), decision) != null)
                throw invalid("Import decisions must have unique record numbers between 1 and 1000");
        }
        return result;
    }

    private String confirmationHash(ConfirmRequest request) {
        var ordered = request.decisions().stream().sorted(Comparator.comparingInt(Decision::recordNumber)).toList();
        return sha256(json.writeValueAsBytes(new ConfirmRequest(ordered)));
    }

    private Preview withStatus(PostgresBibliographyImportStore.ImportRow row) {
        Preview value = row.preview();
        return new Preview(value.id(), value.workspaceId(), value.fileName(), value.fileSha256(), value.format(),
                value.origin(), row.status(), value.totalRecords(), value.ready(), value.duplicates(), value.conflicts(),
                value.rejected(), value.records(), value.createdAt());
    }

    private static Map<String, String> duplicateCitationKeys(List<ParsedRecord> records) {
        var numbers = new LinkedHashMap<String, List<Integer>>();
        for (ParsedRecord record : records) {
            String key = record.bibliography().citationKey();
            if (key != null) numbers.computeIfAbsent(key.toLowerCase(Locale.ROOT), ignored -> new ArrayList<>())
                    .add(record.recordNumber());
        }
        var result = new HashMap<String, String>();
        numbers.forEach((key, values) -> { if (values.size() > 1) result.put(key, values.toString()); });
        return result;
    }

    private static List<Match> matches(SourceBibliography proposed, List<Candidate> candidates) {
        String fingerprint = fingerprint(proposed);
        var doi = candidates.stream().filter(candidate -> proposed.doi() != null
                && proposed.doi().equals(candidate.bibliography().doi())).toList();
        List<Candidate> selected = doi.isEmpty()
                ? candidates.stream().filter(candidate -> fingerprint.equals(fingerprint(candidate.bibliography()))).toList()
                : doi;
        MatchReason reason = doi.isEmpty() ? MatchReason.METADATA : MatchReason.DOI;
        return selected.stream().map(candidate -> new Match(candidate.kind(), candidate.id(), candidate.title(), reason,
                conflicts(proposed, candidate.bibliography()),candidate.bibliography(),candidate.tags(),candidate.collections())).toList();
    }

    private static boolean equivalent(SourceBibliography left,SourceBibliography right) {
        return left.doi()!=null&&left.doi().equals(right.doi()) ||
                left.title()!=null&&right.title()!=null&&fingerprint(left).equals(fingerprint(right));
    }

    private static List<Match> organizationMatches(List<Match> matches,List<String> tags,List<String> collections) {
        return matches.stream().map(match -> {
            var fields=new ArrayList<>(match.conflictingFields());
            if(!match.tags().containsAll(tags))fields.add("tags");
            if(!match.collections().containsAll(collections))fields.add("collections");
            return new Match(match.kind(),match.id(),match.title(),match.reason(),fields,match.existingBibliography(),match.tags(),match.collections());
        }).toList();
    }

    private static List<String> conflicts(SourceBibliography proposed, SourceBibliography existing) {
        var result = new ArrayList<String>();
        if (!Objects.equals(proposed.title(), existing.title())) result.add("title");
        if (!Objects.equals(proposed.authors(), existing.authors())) result.add("authors");
        if (!Objects.equals(proposed.publicationYear(), existing.publicationYear())) result.add("publicationYear");
        if (!Objects.equals(proposed.doi(), existing.doi())) result.add("doi");
        if (!Objects.equals(proposed.venue(), existing.venue())) result.add("venue");
        if (!Objects.equals(proposed.url(), existing.url())) result.add("url");
        if (!Objects.equals(proposed.citationKey(), existing.citationKey())) result.add("citationKey");
        return List.copyOf(result);
    }

    public static String fingerprint(SourceBibliography bibliography) {
        String authors = bibliography.authors().stream().map(BibliographyImportService::searchText).sorted()
                .reduce((left, right) -> left + "|" + right).orElse("");
        return sha256((searchText(bibliography.title()==null?bibliography.doi()==null?bibliography.citationKey():bibliography.doi():bibliography.title()) + "\n" +
                (bibliography.publicationYear() == null ? "" : bibliography.publicationYear()) + "\n" + authors)
                .getBytes(StandardCharsets.UTF_8));
    }

    private void inspect(byte[] bytes) {
        java.nio.file.Path staged=null;
        try {
            staged=java.nio.file.Files.createTempFile("researchhub-bibliography-", ".txt");
            java.nio.file.Files.write(staged,bytes);
            inspector.requireSafe(staged,"TXT");
        }catch(IOException failed){throw new UncheckedIOException("The bibliography file could not be inspected",failed);}
        finally {
            if(staged!=null)try{java.nio.file.Files.deleteIfExists(staged);}catch(IOException failed){throw new UncheckedIOException(failed);}
        }
    }

    private static String searchText(String value) {
        if (value == null) return "";
        String decomposed = Normalizer.normalize(value, Normalizer.Form.NFKD).toLowerCase(Locale.ROOT);
        return decomposed.replaceAll("\\p{M}+", "").replaceAll("[^\\p{L}\\p{N}]+", " ").strip();
    }

    private static Result result(UUID importId, List<RecordResult> records, Instant now) {
        return new Result(importId, outcomes(records, Outcome.CREATED), outcomes(records, Outcome.LINKED),
                outcomes(records, Outcome.UPDATED), outcomes(records, Outcome.SKIPPED),
                outcomes(records, Outcome.REJECTED), outcomes(records, Outcome.DUPLICATE), records, now);
    }

    private static int outcomes(List<RecordResult> records, Outcome outcome) {
        return (int) records.stream().filter(record -> record.outcome() == outcome).count();
    }

    private static int count(List<PreviewRecord> records, RecordStatus status) {
        return (int) records.stream().filter(record -> record.status() == status).count();
    }

    private static Format format(String fileName) {
        String lower = fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".bib")) return Format.BIBTEX;
        if (lower.endsWith(".ris")) return Format.RIS;
        if (lower.endsWith(".json")) return Format.CSL_JSON;
        throw invalid("Supported bibliography files are .bib, .ris, and CSL-JSON .json");
    }

    private static byte[] readBounded(InputStream content) {
        try {
            byte[] bytes = content.readNBytes(MAX_FILE_BYTES + 1);
            if (bytes.length > MAX_FILE_BYTES) throw tooLarge();
            return bytes;
        } catch (IOException failed) {
            throw new UncheckedIOException("The bibliography file could not be read", failed);
        }
    }

    private static PayloadTooLargeException tooLarge() {
        return new PayloadTooLargeException("A bibliography file must be at most 2 MiB");
    }

    private static ApiException invalid(String message) {
        return new ApiException(ApiErrorCode.VALIDATION_FAILED,
                message == null || message.isBlank() ? "Invalid bibliography import" : message);
    }

    private static String sha256(byte[] bytes) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
