package dev.researchhub.user.infrastructure;

import com.azure.storage.blob.BlobContainerClient;
import com.azure.storage.blob.models.*;
import com.azure.storage.blob.options.BlobParallelUploadOptions;
import com.azure.core.util.BinaryData;
import dev.researchhub.user.application.ErasureLedger;

import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import java.io.IOException;

/** Separate namespace in existing Blob storage; source erasure never deletes this restore ledger. */
@Component
@org.springframework.boot.autoconfigure.condition.ConditionalOnProperty(name="researchhub.sources.storage.adapter",havingValue="azure-blob")
public class AzureBlobErasureLedger implements ErasureLedger {
    private final BlobContainerClient container;
    private final ObjectMapper json;
    private final boolean createContainer;
    public AzureBlobErasureLedger(BlobContainerClient container,ObjectMapper json){this(container,json,false);}
    @org.springframework.beans.factory.annotation.Autowired
    public AzureBlobErasureLedger(BlobContainerClient container,ObjectMapper json,@org.springframework.beans.factory.annotation.Value("${researchhub.sources.storage.azure-blob.create-container:true}") boolean createContainer){this.container=container;this.json=json;this.createContainer=createContainer;}
    @Override public void record(Entry entry) throws IOException {
        var blob=container.getBlobClient("erasure-ledger/"+entry.requestId()+".json");
        try {
            if(createContainer)container.createIfNotExists();
            blob.uploadWithResponse(new BlobParallelUploadOptions(BinaryData.fromBytes(json.writeValueAsBytes(entry)))
                .setHeaders(new BlobHttpHeaders().setContentType("application/json"))
                .setRequestConditions(new BlobRequestConditions().setIfNoneMatch("*")),java.time.Duration.ofSeconds(30),com.azure.core.util.Context.NONE);
        } catch(BlobStorageException conflict) {
            if(conflict.getStatusCode()==409 || conflict.getStatusCode()==412) {
                try { if(json.readValue(blob.downloadContent().toBytes(),Entry.class).equals(entry))return; }
                catch(RuntimeException ignored) { }
            }
            throw new IOException("Erasure restore ledger could not be durably recorded");
        } catch(RuntimeException failure) {throw new IOException("Erasure restore ledger could not be durably recorded");}
    }
}
