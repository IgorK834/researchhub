package dev.researchhub.user.infrastructure;
import com.azure.storage.blob.*;
import com.azure.storage.blob.models.*;
import com.azure.core.util.BinaryData;
import dev.researchhub.user.application.ErasureLedger;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class AzureBlobErasureLedgerTest {
 @Test void immutableRestoreAuthorityContainsOnlyPseudonymousHeadersAndHandlesDuplicateRequests() throws Exception {
  var container=mock(BlobContainerClient.class);var blob=mock(BlobClient.class);var json=JsonMapper.builder().build();
  var entry=new ErasureLedger.Entry("1.0",UUID.randomUUID(),UUID.randomUUID(),List.of(UUID.randomUUID()),"ADR-014/live-erasure-v1",Instant.parse("2026-10-12T12:00:00Z"));
  when(container.getBlobClient("erasure-ledger/"+entry.requestId()+".json")).thenReturn(blob);var ledger=new AzureBlobErasureLedger(container,json);
  ledger.record(entry);verify(blob).uploadWithResponse(any(),any(),any());
  var response=mock(com.azure.core.http.HttpResponse.class);when(response.getStatusCode()).thenReturn(412);var exists=new BlobStorageException("sig=secret",response,null);
  doThrow(exists).when(blob).uploadWithResponse(any(),any(),any());when(blob.downloadContent()).thenReturn(BinaryData.fromBytes(json.writeValueAsBytes(entry)));ledger.record(entry);
  when(blob.downloadContent()).thenReturn(BinaryData.fromString("{}"));var failure=assertThrows(java.io.IOException.class,()->ledger.record(entry));assertNull(failure.getCause());assertFalse(failure.getMessage().contains("secret"));
  doThrow(new IllegalStateException("AccountKey=secret")).when(blob).uploadWithResponse(any(),any(),any());assertThrows(java.io.IOException.class,()->ledger.record(entry));
 }
}
