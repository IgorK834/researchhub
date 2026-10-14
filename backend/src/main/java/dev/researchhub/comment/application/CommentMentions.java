package dev.researchhub.comment.application;

import dev.researchhub.comment.application.CommentContracts.Mention;
import dev.researchhub.shared.error.*;
import dev.researchhub.workspace.application.WorkspacePeople;
import org.springframework.stereotype.Service;
import java.util.*;

@Service
public class CommentMentions {
    private final WorkspacePeople people;
    public CommentMentions(WorkspacePeople people) {this.people=people;}
    public List<Mention> validate(UUID workspace,String body,List<Mention> input) {
        if(input==null)return List.of();
        if(input.size()>20 || input.stream().anyMatch(Objects::isNull))throw invalid();
        var sorted=input.stream().sorted(Comparator.comparingInt(Mention::start)).toList();
        int end=0;
        for(var mention:sorted) {
            if(mention.userId()==null || mention.displayLabel()==null || mention.displayLabel().isBlank() || mention.displayLabel().length()>120
                || mention.start()<end || mention.end()>body.length() || mention.end()<=mention.start()
                || !body.substring(mention.start(),mention.end()).equals("@"+mention.displayLabel()))throw invalid();
            var person=people.person(workspace,mention.userId()).orElseThrow(CommentMentions::invalid);
            if(!person.displayLabel().equals(mention.displayLabel()))throw invalid();
            end=mention.end();
        }
        return sorted.stream().map(m->new Mention(m.userId(),m.displayLabel(),m.start(),m.end())).toList();
    }
    public List<Mention> present(UUID workspace,List<Mention> input) {
        return input.stream().map(m->new Mention(m.userId(),m.displayLabel(),m.start(),m.end(),people.current(workspace,m.userId()))).toList();
    }
    public static List<UUID> added(List<Mention> before,List<Mention> after) {
        var previous=before.stream().map(Mention::userId).collect(java.util.stream.Collectors.toSet());
        return after.stream().map(Mention::userId).distinct().filter(id->!previous.contains(id)).toList();
    }
    private static ApiException invalid() {return new ApiException(ApiErrorCode.VALIDATION_FAILED,"Mentions must reference current workspace members with valid non-overlapping text ranges");}
}
