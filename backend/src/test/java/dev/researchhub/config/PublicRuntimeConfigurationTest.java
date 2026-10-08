package dev.researchhub.config;

import dev.researchhub.ai.application.*;
import dev.researchhub.ai.application.GenerationContracts.ModelMetadata;
import dev.researchhub.user.application.*;
import dev.researchhub.user.infrastructure.UnavailableRegistrationInvitations;
import dev.researchhub.shared.error.ApiException;
import org.junit.jupiter.api.Test;
import java.time.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PublicRuntimeConfigurationTest {
    final ModelProvider model = mock(ModelProvider.class);
    final Clock clock = mock(Clock.class);
    final RegistrationPolicy registration = new RegistrationPolicy("disabled", mock(RegistrationRejectionAudit.class), new UnavailableRegistrationInvitations());
    @Test void fixtureIdentityIsHonestCachedAndRefreshesFromActualProvider() {
        var now = Instant.parse("2026-10-08T10:00:00Z"); when(clock.instant()).thenReturn(now);
        when(model.modelMetadata()).thenReturn(new ModelMetadata("deterministic","extractive-fixture","1",true,false));
        var controller = new PublicRuntimeConfiguration("demo",registration,model,clock);
        var response = controller.config(); assertEquals("max-age=60, public",response.getHeaders().getCacheControl());
        assertTrue(response.getBody().demo()); assertEquals("disabled",response.getBody().registrationMode());
        assertEquals("deterministic",response.getBody().ai().mode()); assertNull(response.getBody().ai().modelName());
        controller.config(); verify(model,times(1)).modelMetadata();
        when(clock.instant()).thenReturn(now.plusSeconds(60)); when(model.modelMetadata()).thenReturn(new ModelMetadata("foundry","gpt-fixture-test","1",true,false));
        assertEquals("live",controller.config().getBody().ai().mode()); assertEquals("gpt-fixture-test",controller.config().getBody().ai().modelName());
        assertFalse(new PublicRuntimeConfiguration("local",registration,model,clock).config().getBody().demo());
    }
    @Test void internalUrlsAndUnsafeModelNamesCannotEscapePublicAllowlist() {
        when(clock.instant()).thenReturn(Instant.now());
        for (String name : new String[]{"https://worker.internal","api:key","//internal"}) {
            when(model.modelMetadata()).thenReturn(new ModelMetadata("foundry",name,"1",true,false));
            assertThrows(ApiException.class, () -> new PublicRuntimeConfiguration("demo",registration,model,clock).config());
        }
    }
}
