package dev.researchhub.source.infrastructure;

import com.azure.storage.blob.*;
import dev.researchhub.source.application.SourceStorage;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
class AzureBlobStorageConfigurationTest {
    private static final String KEY = "YWJjZA==";
    private static final String CONNECTION = "DefaultEndpointsProtocol=https;AccountName=researchhubcloud;AccountKey=" + KEY
            + ";EndpointSuffix=core.windows.net";
    private final ApplicationContextRunner config = new ApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withUserConfiguration(AzureBlobStorageConfiguration.class);

    @Test void localAndDemoKeepAzuriteDefaultsWithoutConnectingAtStartup() {
        for (String profile : new String[]{"local", "demo"}) config
                .withPropertyValues("spring.profiles.active=" + profile).run(app -> {
                    assertThat(app).hasNotFailed().hasSingleBean(SourceStorage.class);
                    var properties = app.getBean(AzureBlobStorageProperties.class);
                    assertThat(properties.endpoint()).isEqualTo("http://127.0.0.1:10000/devstoreaccount1");
                    assertThat(properties.accountName()).isEqualTo("devstoreaccount1");
                    assertThat(properties.accountKey()).isNotBlank();
                    assertThat(properties.createContainer()).isTrue();
                    assertThat(properties.createContainerOnStartup()).isFalse();
                });
    }

    @Test void azureHasNoEmulatorDefaultsAndFailsFastWithoutBlobEndpoint() {
        config.withPropertyValues("spring.profiles.active=azure", "BLOB_ENDPOINT=", "BLOB_CONNECTION_STRING=" + CONNECTION)
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage(
                            "BLOB_ENDPOINT must be set when the azure profile is active"));
        new ApplicationContextRunner().withInitializer(new ConfigDataApplicationContextInitializer())
                .withPropertyValues("spring.profiles.active=azure", "BLOB_ENDPOINT=")
                .run(app -> {
                    var environment = app.getEnvironment();
                    assertThat(environment.getProperty("researchhub.sources.storage.azure-blob.endpoint")).isEmpty();
                    assertThat(environment.getProperty("researchhub.sources.storage.azure-blob.account-name")).isNull();
                    assertThat(environment.getProperty("researchhub.sources.storage.azure-blob.account-key")).isNull();
                    assertThat(environment.getProperty("researchhub.sources.storage.azure-blob.create-container")).isEqualTo("false");
                    assertThat(environment.getProperty("researchhub.security.quotas.store")).isEqualTo("postgres");
                });
    }

    @Test void azureUsesTheCloudEndpointAndKeyBasedConnectionWithoutCreatingContainers() {
        azure().run(app -> {
            assertThat(app).hasNotFailed().hasSingleBean(SourceStorage.class);
            assertThat(app.getBean(BlobServiceClient.class).getAccountUrl()).isEqualTo("https://researchhubcloud.blob.core.windows.net");
            var properties = app.getBean(AzureBlobStorageProperties.class);
            assertThat(properties.accountName()).isNull(); assertThat(properties.accountKey()).isNull();
            assertThat(properties.createContainer()).isFalse(); assertThat(properties.createContainerOnStartup()).isFalse();
        });
    }

    @Test void azureRequiresAConnectionStringAndRejectsStartupProvisioningAndInsecureEndpoints() {
        azure().withPropertyValues("BLOB_CONNECTION_STRING=").run(app -> assertThat(app).hasFailed()
                .getFailure().hasRootCauseMessage("BLOB_CONNECTION_STRING is required for Azure Blob connection-string auth"));
        for (String setting : new String[]{"create-container", "create-container-on-startup"}) azure()
                .withPropertyValues("researchhub.sources.storage.azure-blob." + setting + "=true")
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage(
                        "Azure Blob containers must be provisioned by infrastructure in the azure profile"));
        azure().withPropertyValues("BLOB_ENDPOINT=http://researchhubcloud.blob.core.windows.net")
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage(
                        "The azure profile requires BLOB_ENDPOINT as its HTTPS service endpoint"));
    }

    @Test void credentialFactoryIsReplaceableForManagedIdentityWithoutChangingCallers() {
        var factory = mock(BlobServiceClientFactory.class);
        var service = mock(BlobServiceClient.class);
        var container = mock(BlobContainerClient.class);
        when(factory.create(any(), any())).thenReturn(service);
        when(service.getBlobContainerClient(anyString())).thenReturn(container);
        azure().withPropertyValues("BLOB_AUTH=managed-identity", "BLOB_CONNECTION_STRING=")
                .withBean(BlobServiceClientFactory.class, () -> factory).run(app -> {
                    assertThat(app).hasNotFailed().hasSingleBean(SourceStorage.class);
                    verify(container, never()).createIfNotExists();
                });
    }

    @Test void defaultFactoryFailsClearlyUntilTask2117ImplementsManagedIdentity() {
        azure().withPropertyValues("BLOB_AUTH=managed-identity", "BLOB_CONNECTION_STRING=")
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage(
                        "Managed identity requires the BlobServiceClientFactory from Task 21.17"));
    }

    @Test void startupContainerCreationCanBeEnabledLocally() {
        var factory = mock(BlobServiceClientFactory.class);
        var service = mock(BlobServiceClient.class);
        var container = mock(BlobContainerClient.class);
        when(factory.create(any(), any())).thenReturn(service);
        when(service.getBlobContainerClient(anyString())).thenReturn(container);
        config.withPropertyValues("spring.profiles.active=local", "BLOB_CREATE_CONTAINER_ON_STARTUP=true")
                .withBean(BlobServiceClientFactory.class, () -> factory).run(app -> {
                    assertThat(app).hasNotFailed(); verify(container).createIfNotExists();
                });
    }

    @Test void invalidCredentialsDoNotAppearInStartupLogs(org.springframework.boot.test.system.CapturedOutput output) {
        String secret = "private-connection-string-that-must-not-be-logged";
        azure().withPropertyValues("BLOB_CONNECTION_STRING=" + secret)
                .run(app -> assertThat(app).hasFailed().getFailure().hasRootCauseMessage(
                        "Azure Blob key-based credentials are missing or invalid"));
        assertThat(output.getAll()).doesNotContain(secret);
    }

    private ApplicationContextRunner azure() {
        return config.withPropertyValues("spring.profiles.active=azure",
                "BLOB_ENDPOINT=https://researchhubcloud.blob.core.windows.net", "BLOB_CONNECTION_STRING=" + CONNECTION);
    }
}
