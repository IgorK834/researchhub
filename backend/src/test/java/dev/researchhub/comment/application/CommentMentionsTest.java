package dev.researchhub.comment.application;

import dev.researchhub.comment.application.CommentContracts.Mention;
import dev.researchhub.shared.error.ApiException;
import dev.researchhub.workspace.application.WorkspacePeople;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CommentMentionsTest {
    final UUID scope=UUID.randomUUID(),user=UUID.randomUUID();
    final WorkspacePeople people=mock(WorkspacePeople.class);
    final CommentMentions service=new CommentMentions(people);
    final Mention valid=new Mention(user,"Ada",0,4);
    @Test void plainAtTextNeverCreatesRecipientsAndRangesAreBoundedNonOverlappingAndMemberScoped() {
        assertEquals(List.of(),service.validate(scope,"@ai @ada@email.test",null));
        assertEquals(List.of(),service.validate(scope,"@Ada",List.of()));
        assertThrows(ApiException.class,()->service.validate(scope,"@Ada",Collections.nCopies(21,valid)));
        assertThrows(ApiException.class,()->service.validate(scope,"@Ada",Arrays.asList((Mention)null)));
        for(var malformed:List.of(new Mention(null,"Ada",0,4),new Mention(user,null,0,4),new Mention(user," ",0,2),
            new Mention(user,"a".repeat(121),0,4),new Mention(user,"Ada",-1,4),new Mention(user,"Ada",0,5),
            new Mention(user,"Ada",2,2),new Mention(user,"Wrong",0,4))) {
            assertThrows(ApiException.class,()->service.validate(scope,"@Ada",List.of(malformed)));
        }
        when(people.person(scope,user)).thenReturn(Optional.empty());assertThrows(ApiException.class,()->service.validate(scope,"@Ada",List.of(valid)));
        when(people.person(scope,user)).thenReturn(Optional.of(new WorkspacePeople.Person(user,"Renamed")));assertThrows(ApiException.class,()->service.validate(scope,"@Ada",List.of(valid)));
        when(people.person(scope,user)).thenReturn(Optional.of(new WorkspacePeople.Person(user,"Ada")));
        assertEquals(List.of(valid),service.validate(scope,"@Ada",List.of(new Mention(user,"Ada",0,4,false))));
        assertThrows(ApiException.class,()->service.validate(scope,"@Ada",List.of(valid,valid)));
    }
    @Test void stableIdentitiesSurviveRepeatedNamesAndOnlyNewRecipientsAreEmitted() {
        when(people.person(scope,user)).thenReturn(Optional.of(new WorkspacePeople.Person(user,"Ada")));
        var second=new Mention(user,"Ada",5,9);
        assertEquals(List.of(valid,second),service.validate(scope,"@Ada @Ada",List.of(second,valid)));
        assertEquals(List.of(user),CommentMentions.added(List.of(),List.of(valid,second)));
        assertEquals(List.of(),CommentMentions.added(List.of(valid),List.of(second)));
        when(people.current(scope,user)).thenReturn(false);var shown=service.present(scope,List.of(valid)).getFirst();
        assertFalse(shown.available());assertEquals(user,shown.userId());
        when(people.current(scope,user)).thenReturn(true);assertTrue(service.present(scope,List.of(valid)).getFirst().available());
    }
}
