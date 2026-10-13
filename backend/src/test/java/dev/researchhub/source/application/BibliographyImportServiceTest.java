package dev.researchhub.source.application;

import dev.researchhub.source.application.BibliographyImportContracts.*;
import dev.researchhub.source.infrastructure.LocalBibliographyParser;
import dev.researchhub.source.infrastructure.PostgresBibliographyImportStore;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.io.*;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class BibliographyImportServiceTest {
    final ObjectMapper json=new ObjectMapper();final MemoryStore store=new MemoryStore(json);
    final UUID workspace=UUID.randomUUID(),user=UUID.randomUUID();
    final Instant now=Instant.parse("2026-10-13T10:00:00Z");
    final WorkspaceAuthorizationService auth=new WorkspaceAuthorizationService(null,null) {
        @Override public void requireContentEditor(UUID w,UUID u){}
        @Override public void requireContentReader(UUID w,UUID u){}
    };
    final BibliographyImportService service=new BibliographyImportService(new LocalBibliographyParser(json),store,auth,json,
        Clock.fixed(now,ZoneOffset.UTC),new dev.researchhub.security.application.UploadInspector(List.of()));
    static final String BIB="@article{ada,title={Example},author={Example, Ada},year=2025,doi={10.5555/ada}}";

    @Test void boundsFileAdmissionAndFormatValidationBeforePersistence() {
        assertThrows(ApiException.class,()->service.preview(workspace,user,"a.bib",0,null,null,null));
        assertThrows(PayloadTooLargeException.class,()->service.preview(workspace,user,"a.bib",3_000_000,null,null,new ByteArrayInputStream(new byte[0])));
        assertThrows(ApiException.class,()->preview("a.bib",""));
        assertThrows(ApiException.class,()->preview(null,BIB));assertThrows(ApiException.class,()->preview("a.exe",BIB));
        assertThrows(UncheckedIOException.class,()->service.preview(workspace,user,"a.bib",-1,null,null,new InputStream(){public int read()throws IOException{throw new IOException("test");}}));
        assertThrows(PayloadTooLargeException.class,()->service.preview(workspace,user,"a.bib",-1,null,null,new ByteArrayInputStream(new byte[2*1024*1024+1])));
        assertThrows(UnsupportedFileTypeException.class,()->preview("binary.bib","MZexecutable"));
        assertThrows(UnsupportedFileTypeException.class,()->service.preview(workspace,user,"utf.bib",2,null,null,new ByteArrayInputStream(new byte[]{(byte)0xc3,0x28})));
        assertTrue(store.rows.isEmpty());
    }

    @Test void previewIncludesKeyConflictsBatchDuplicatesErrorsAndFileHashReplay() {
        var batch=preview("a.bib",BIB+"\n"+BIB.replace("{ada,","{second,")+"\n@software{bad,title={Unsupported}}");
        assertEquals(3,batch.totalRecords());assertEquals(1,batch.ready());assertEquals(1,batch.duplicates());assertEquals(1,batch.rejected());
        assertEquals(batch.id(),preview("same.bib",BIB+"\n"+BIB.replace("{ada,","{second,")+"\n@software{bad,title={Unsupported}}").id());
        var result=service.confirm(workspace,user,batch.id(),null);assertEquals(1,result.created());assertEquals(1,result.duplicates());assertEquals(1,result.rejected());
        assertEquals(result,service.confirm(workspace,user,batch.id(),new ConfirmRequest(null)));
        assertEquals(result,service.savedResult(workspace,user,batch.id()));assertEquals("CONFIRMED",service.find(workspace,user,batch.id()).status());
        assertThrows(ConflictException.class,()->service.cancel(workspace,user,batch.id()));
        assertThrows(ConflictException.class,()->service.confirm(workspace,user,batch.id(),new ConfirmRequest(List.of(new Decision(1,ConfirmAction.SKIP,null,null,false)))));
    }

    @Test void normalizesDoiBeforeTitleAndFindsMetadataAndCitationKeyConflicts() {
        var existing=metadata("Curated", "old", "10.5555/ada");
        store.candidates.add(new PostgresBibliographyImportStore.Candidate(MatchKind.SOURCE,UUID.randomUUID(),"Source",existing,List.of("old"),List.of("existing")));
        var proposed=preview("a.bib",BIB+"\n@article{changed,title={Curated},author={Example, Ada},year=2025}");
        assertEquals(2,proposed.conflicts());assertEquals(MatchReason.DOI,proposed.records().getFirst().matches().getFirst().reason());
        assertEquals(MatchReason.METADATA,proposed.records().get(1).matches().getFirst().reason());
        store.keyTaken=true;var key=preview("key.bib","@book{taken,title={A distinct publication}}");assertEquals(RecordStatus.CONFLICT,key.records().getFirst().status());
        var dupe=preview("dupe.bib","@book{same,title={First}} @book{same,title={Second}}");assertEquals(2,dupe.conflicts());
        assertEquals(BibliographyImportService.fingerprint(metadata("Café methods","a",null)),BibliographyImportService.fingerprint(metadata("cafe METHODS","b",null)));
    }

    @Test void linksSourcesAndReplacesMetadataOnlyWithExplicitPreviewedDecision() {
        UUID source=UUID.randomUUID();var old=metadata("Curated","old","10.5555/ada");
        store.candidates.add(new PostgresBibliographyImportStore.Candidate(MatchKind.SOURCE,source,"Source",old,List.of("kept"),List.of("kept collection")));
        var p=preview("a.bib",BIB);
        assertThrows(ApiException.class,()->service.confirm(workspace,user,p.id(),request(1,ConfirmAction.REPLACE_SOURCE,null,false)));
        assertThrows(ResourceNotFoundException.class,()->service.confirm(workspace,user,p.id(),request(1,ConfirmAction.REPLACE_SOURCE,UUID.randomUUID(),false)));
        var replaced=service.confirm(workspace,user,p.id(),request(1,ConfirmAction.REPLACE_SOURCE,source,true));assertEquals(1,replaced.updated());
        assertEquals("Example",store.candidates.getFirst().bibliography().title());assertEquals(List.of("kept"),store.candidates.getFirst().tags());
        var linked=preview("link.bib","@book{linked,title={Another publication},keywords={new},collection={imported}}");
        assertEquals(1,service.confirm(workspace,user,linked.id(),request(1,ConfirmAction.LINK_SOURCE,source,true)).linked());
        assertEquals(List.of("kept","new"),store.candidates.getFirst().tags());
    }

    @Test void itemReplacementAndChangedPreviewAreFenced() {
        UUID target=UUID.randomUUID();var old=metadata("Old","old","10.5555/ada");
        store.candidates.add(new PostgresBibliographyImportStore.Candidate(MatchKind.BIBLIOGRAPHIC_ITEM,target,"Existing",old,List.of(),List.of()));
        var p=preview("item.bib",BIB);assertEquals(1,service.confirm(workspace,user,p.id(),request(1,ConfirmAction.REPLACE_ITEM,target,false)).updated());
        var changed=preview("changed.bib",BIB.replace("title={Example}","title={Revised}"));
        store.candidates.set(0,new PostgresBibliographyImportStore.Candidate(MatchKind.BIBLIOGRAPHIC_ITEM,target,"Edited",metadata("Edited","old","10.5555/ada"),List.of(),List.of()));
        assertThrows(ConflictException.class,()->service.confirm(workspace,user,changed.id(),request(1,ConfirmAction.REPLACE_ITEM,target,false)));
        store.updateFails=true;assertThrows(ConflictException.class,()->service.updateItem(workspace,user,target,new ItemUpdate(old,List.of(),List.of(),now)));
        assertThrows(ApiException.class,()->service.updateItem(workspace,user,target,null));
        assertThrows(ApiException.class,()->service.updateItem(workspace,user,target,new ItemUpdate(old,null,List.of(),now)));
        store.updateFails=false;service.updateItem(workspace,user,target,new ItemUpdate(old,List.of(),List.of(),now));
        assertThrows(ApiException.class,()->service.items(workspace,user,-1));assertThrows(ApiException.class,()->service.items(workspace,user,100001));
        assertNotNull(service.items(workspace,user,0));
    }

    @Test void invalidDecisionsCancellationAndExactDuplicateReplayDoNotWriteItems() {
        var p=preview("a.bib",BIB);
        assertThrows(ConflictException.class,()->service.savedResult(workspace,user,p.id()));
        assertThrows(ApiException.class,()->service.confirm(workspace,user,p.id(),request(1000,ConfirmAction.SKIP,null,false)));
        assertThrows(ApiException.class,()->service.confirm(workspace,user,p.id(),request(0,ConfirmAction.SKIP,null,false)));
        assertThrows(ApiException.class,()->service.confirm(workspace,user,p.id(),new ConfirmRequest(List.of(new Decision(1,null,null,null,false)))));
        var decision=new Decision(1,ConfirmAction.SKIP,null,null,false);
        assertThrows(ApiException.class,()->service.confirm(workspace,user,p.id(),new ConfirmRequest(List.of(decision,decision))));
        service.cancel(workspace,user,p.id());service.cancel(workspace,user,p.id());assertEquals("CANCELLED",service.find(workspace,user,p.id()).status());
        assertThrows(ConflictException.class,()->service.confirm(workspace,user,p.id(),null));
        assertThrows(ResourceNotFoundException.class,()->service.find(workspace,user,UUID.randomUUID()));
        assertThrows(ResourceNotFoundException.class,()->service.cancel(workspace,user,UUID.randomUUID()));
        assertThrows(ResourceNotFoundException.class,()->service.confirm(workspace,user,UUID.randomUUID(),null));
        assertThrows(ResourceNotFoundException.class,()->service.savedResult(workspace,user,UUID.randomUUID()));
    }

    @Test void citationsAndLateDuplicateAdmissionsAreCheckedAgainAtConfirm() {
        var p=preview("a.bib",BIB);var same=p.records().getFirst().bibliography();
        store.candidates.add(new PostgresBibliographyImportStore.Candidate(MatchKind.BIBLIOGRAPHIC_ITEM,UUID.randomUUID(),"Example",same,List.of(),List.of()));
        assertEquals(1,service.confirm(workspace,user,p.id(),null).duplicates());
        var conflicts=preview("b.bib",BIB.replace("Example}","Conflicting}"));
        assertThrows(ApiException.class,()->service.confirm(workspace,user,conflicts.id(),request(1,ConfirmAction.CREATE,null,false)));
        assertThrows(ConflictException.class,()->service.confirm(workspace,user,conflicts.id(),new ConfirmRequest(List.of(new Decision(1,ConfirmAction.CREATE,null,conflicts.records().getFirst().bibliography(),false)))));
        var unique=preview("u.bib","@book{unique,title={Unique}}");store.keyTaken=true;
        assertThrows(ConflictException.class,()->service.confirm(workspace,user,unique.id(),null));
    }

    Preview preview(String name,String content){return service.preview(workspace,user,name,-1,null,null,new ByteArrayInputStream(content.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
    static ConfirmRequest request(int number,ConfirmAction action,UUID target,boolean merge){return new ConfirmRequest(List.of(new Decision(number,action,target,null,merge)));}
    static SourceBibliography metadata(String title,String key,String doi){return new SourceBibliography(title,List.of("Example, Ada"),2025,doi,null,null,key);}
    static class MemoryStore extends PostgresBibliographyImportStore {
        final Map<UUID,ImportRow> rows=new HashMap<>();final List<Candidate> candidates=new ArrayList<>();boolean keyTaken,updateFails;
        MemoryStore(ObjectMapper json){super(null,json);}
        @Override public void serializeWorkspace(UUID id){}
        @Override public Optional<ImportRow> findActive(UUID w,String hash){return rows.values().stream().filter(r->r.preview().fileSha256().equals(hash)&&!r.status().equals("CANCELLED")).findFirst();}
        @Override public Optional<ImportRow> find(UUID w,UUID id){return Optional.ofNullable(rows.get(id));}
        @Override public Optional<ImportRow> findForUpdate(UUID w,UUID id){return find(w,id);}
        @Override public void create(Preview p,UUID u){rows.put(p.id(),new ImportRow(p,"PREVIEWED",null,null));}
        @Override public List<Candidate> candidates(UUID w){return List.copyOf(candidates);}
        @Override public boolean citationKeyExists(UUID w,String key,UUID except){return key!=null&&keyTaken;}
        @Override public UUID createItem(UUID w,UUID u,String type,SourceBibliography b,List<String> tags,List<String> collections,String fp,UUID i,int n,String hash,Instant at){return UUID.randomUUID();}
        @Override public void record(UUID w,UUID i,int n,ConfirmAction a,Outcome o,SourceBibliography b,MatchKind k,UUID target,Instant at){}
        @Override public void confirm(UUID w,UUID id,String hash,Result result){var old=rows.get(id);rows.put(id,new ImportRow(old.preview(),"CONFIRMED",hash,result));}
        @Override public boolean cancel(UUID w,UUID id,Instant at){var old=rows.get(id);rows.put(id,new ImportRow(old.preview(),"CANCELLED",null,null));return true;}
        @Override public boolean updateCandidate(UUID w,Candidate before,SourceBibliography b,List<String> tags,List<String> collections,String fp,Instant at){
            if(updateFails)return false;candidates.remove(before);candidates.add(new Candidate(before.kind(),before.id(),b.title(),b,tags,collections));return true;}
        @Override public ItemPage items(UUID w,int offset){return new ItemPage(List.of(),-1);}
        @Override public boolean updateItem(UUID w,UUID id,ItemUpdate u,String fp,Instant at){return !updateFails;}
    }
}
