package dev.researchhub.ai.application;
import static org.junit.jupiter.api.Assertions.*;
import dev.researchhub.ai.application.CalculationPackageContracts.*;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.nio.file.*;
import java.util.*;
class CalculationPackageContractsTest {
    final UUID id=UUID.randomUUID();
    @Test void sharedSelectionIsClosedAndDoesNotAcceptEditorContent() throws Exception {
        var json=new ObjectMapper();var sample=json.readValue(Files.readString(Path.of("../contracts/analysis/document-block/v2/request.json")),Request.class);
        assertEquals(Selection.FULL,sample.selection());
        for(int i=0;i<5;i++){var values=new UUID[]{id,id,id,id};if(i<4)values[i]=null;final int index=i;assertThrows(IllegalArgumentException.class,()->new Request(values[0],values[1],values[2],values[3],index==4?null:Selection.FULL,null,null,null));}
        assertThrows(IllegalArgumentException.class,()->new Request(id,id,id,id,Selection.FULL,"invented",null,null));
        assertThrows(IllegalArgumentException.class,()->new Request(id,id,id,id,Selection.FULL,null,id,null));
        assertThrows(IllegalArgumentException.class,()->new Request(id,id,id,id,Selection.FULL,null,null,id));
        for(String bad:Arrays.asList(null,""," ","x".repeat(101)))assertThrows(IllegalArgumentException.class,()->new Request(id,id,id,id,Selection.CHART,bad,null,null));
        assertEquals("chart",new Request(id,id,id,id,Selection.CHART,"chart",id,id).outputId());
        var block=json.readTree(Files.readString(Path.of("../contracts/analysis/document-block/v2/block.json")));
        assertEquals(1,new Content("2.0","PROBLEM",id,id,Selection.FULL,null,null,List.of(block)).blocks().size());
        assertThrows(IllegalArgumentException.class,()->new Content("1.0","PROBLEM",id,id,Selection.FULL,null,null,List.of(block)));
        assertThrows(IllegalArgumentException.class,()->new Content("2.0","MODEL",id,id,Selection.FULL,null,null,List.of(block)));
        assertThrows(IllegalArgumentException.class,()->new Content("2.0","DATASET",id,id,Selection.FULL,null,null,List.of()));
        assertThrows(IllegalArgumentException.class,()->new Content("2.0","DATASET",id,id,Selection.FULL,null,null,Collections.nCopies(33,block)));
    }
}
