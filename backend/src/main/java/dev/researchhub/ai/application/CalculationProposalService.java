package dev.researchhub.ai.application;

import dev.researchhub.ai.application.CalculationPackageContracts.*;
import dev.researchhub.ai.application.CanvasProposalContracts.*;
import dev.researchhub.ai.infrastructure.PostgresCanvasProposalStore;
import dev.researchhub.analysis.application.*;
import dev.researchhub.document.application.*;
import dev.researchhub.shared.error.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.*;
import tools.jackson.databind.node.ObjectNode;
import java.time.Clock;
import java.util.*;

/** Deterministic proposal from saved capabilities. Neither model prose nor client editor JSON becomes a result. */
@Service
public class CalculationProposalService {
    private final PostgresCanvasProposalStore store;private final DocumentService documents;
    private final CanvasContextService contexts;private final ConversationStore conversations;
    private final CanvasTurnStore turns;private final ProblemStore problems;private final SolutionService solutions;
    private final ExecutionService executions;private final ObjectMapper json;private final Clock clock;
    public CalculationProposalService(PostgresCanvasProposalStore store,DocumentService documents,CanvasContextService contexts,
            ConversationStore conversations,CanvasTurnStore turns,ProblemStore problems,SolutionService solutions,
            ExecutionService executions,ObjectMapper json,Clock clock) {
        this.store=store;this.documents=documents;this.contexts=contexts;this.conversations=conversations;this.turns=turns;
        this.problems=problems;this.solutions=solutions;this.executions=executions;this.json=json;this.clock=clock;
    }
    @Transactional public Proposal prepare(UUID workspace,UUID document,UUID caller,Request request) {
        var doc=documents.lockForReview(workspace,caller,document);
        var context=contexts.resolve(workspace,document,caller,request.contextId());
        if(request.conversationId()!=null) {
            var origin=conversations.find(workspace,request.conversationId()).origin();
            if(origin==null || !origin.documentId().equals(document))throw new ResourceNotFoundException("Origin conversation was not found");
            turns.find(workspace,request.conversationId(),request.turnId());
        }
        var blocks=new ArrayList<JsonNode>();String workload;
        if(problems.find(workspace,request.analysisId()).isPresent()) {
            workload="PROBLEM";
            var bundle=solutions.find(workspace,caller,request.analysisId(),request.executionId());
            if(request.selection()==Selection.FULL) {
                blocks.add(block(request,"solution","INPUTS",null,true));
                for(var step:bundle.steps())blocks.add(block(request,"solution","STEP",step.id(),true));
                blocks.add(block(request,"solution","SOLUTION",null,true));
                blocks.add(block(request,"solution","ASSUMPTIONS",null,true));
                if(!bundle.plot().isNull()){blocks.add(block(request,"plot-data","TABLE",null,true));blocks.add(block(request,"plot","CHART",null,true));}
            } else {
                if(bundle.plot().isNull() || !request.outputId().equals(request.selection()==Selection.TABLE?"plot-data":"plot"))throw invalid();
                blocks.add(block(request,request.outputId(),request.selection().name(),null,true));
            }
        } else {
            workload="DATASET";
            var record=executions.record(workspace,caller,request.analysisId(),request.executionId());
            if(record.execution().status()!=ExecutionContracts.Status.SUCCEEDED || record.execution().result()==null)throw invalid();
            for(var output:record.execution().result().outputs()) {
                String mode=output.kind()==AnalysisContracts.OutputKind.TEXT?"SUMMARY":output.kind().name();
                if(request.selection()==Selection.FULL || request.outputId().equals(output.name()) && request.selection().name().equals(mode))
                    blocks.add(block(request,output.name(),mode,null,false));
            }
            if(blocks.isEmpty())throw invalid();
        }
        int i=0;
        for(var block:blocks)((ObjectNode)block.path("attrs")).put("blockId",UUID.nameUUIDFromBytes((request.clientProposalId()+":"+i++).getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString());
        var content=new Content("2.0",workload,request.analysisId(),request.executionId(),request.selection(),request.outputId(),request.conversationId(),blocks);
        String version=ProblemJson.hash(json,List.of(caller,request,content));
        var previous=store.lookup(workspace,document,request.clientProposalId(),true);
        if(previous.isPresent()) {
            if(!previous.get().versionHash().equals(version))throw new ConflictException("Proposal identity was reused with another selection");
            return previous.get();
        }
        if(request.turnId()!=null && turns.find(workspace,request.conversationId(),request.turnId()).calculationProposalIds().size()>=32)throw new ConflictException("This turn already has 32 saved packages; start a new turn to prepare another package");
        // Check the splice before persisting. Preview does not enter autosave or document history.
        new CanvasEdit(json).planBlocks(doc.content(),context.target(),false,blocks,request.clientProposalId());
        var proposal=new Proposal("2.0",request.clientProposalId(),workspace,document,request.contextId(),request.turnId(),null,Mode.INSERT_AT_ANCHOR,"PENDING",version,
            context.text(),List.of("Saved "+workload.toLowerCase(Locale.ROOT)+" package — "+request.selection().name().toLowerCase(Locale.ROOT)),List.of(),
            List.of(workload.equals("PROBLEM")?"Arithmetic checks cover saved computations. Physical interpretation and assumptions remain unchecked. Captions are human annotations.":"These values come from the exact saved dataset execution. Captions are human annotations."),
            null,null,clock.instant(),null,null,content);
        try {store.save(proposal);} catch(org.springframework.dao.DuplicateKeyException collision) {throw new ConflictException("Proposal identity already exists; choose a new identity");}return proposal;
    }
    private JsonNode block(Request request,String output,String mode,String step,boolean problem) {
        var block=json.createObjectNode().put("type","analysisResult");
        var attrs=block.putObject("attrs").put("blockId",UUID.randomUUID().toString()).put("caption","");
        var reference=attrs.putObject("reference").put("analysisId",request.analysisId().toString()).put("executionId",request.executionId().toString())
            .put("outputId",output).put("renderMode",mode);
        reference.put("schemaVersion","2.0").put("workload",problem?"PROBLEM":"DATASET");
        if(step==null)reference.putNull("stepId");else reference.put("stepId",step);
        if(request.conversationId()==null)reference.putNull("conversationId");else reference.put("conversationId",request.conversationId().toString());
        return block;
    }
    private static ApiException invalid(){return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Choose an existing successful package, table or chart from the exact execution");}
}
