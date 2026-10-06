package dev.researchhub.security.api;

import dev.researchhub.auth.application.CurrentUserResolver;
import dev.researchhub.user.application.UserAccount;
import dev.researchhub.workspace.application.WorkspaceAuthorizationService;
import dev.researchhub.shared.error.ForbiddenException;
import dev.researchhub.security.application.*;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.*;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerMapping;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CostlyRequestInterceptorTest {
    static class Routes {
        @CostlyOperation(CostCategory.LLM) public void reader() {}
        @CostlyOperation(value=CostCategory.ANALYSIS, access=CostlyOperation.Access.EDIT) public void editor() {}
        @CostlyOperation(value=CostCategory.LLM, access=CostlyOperation.Access.AI_CONTRIBUTOR) public void ai() {}
        public void ordinary() {}
    }
    @Test void admissionFollowsAuthorizationAndAsyncRedispatchIsCountedOnce() throws Exception {
        UUID user = UUID.randomUUID(), workspace = UUID.randomUUID();
        var users = mock(CurrentUserResolver.class);
        var authorization = mock(WorkspaceAuthorizationService.class);
        var store = mock(CostQuotaStore.class);
        when(users.requireCurrentUser()).thenReturn(new UserAccount(user,"a@example.com","Ada","ACTIVE"));
        var policy = new QuotaPolicy(1, 1, Duration.ofMinutes(1));
        var interceptor = new CostlyRequestInterceptor(users, authorization, store,
                Map.of(CostCategory.LLM, policy, CostCategory.ANALYSIS, policy));
        var response = new MockHttpServletResponse();
        for (String method : List.of("reader", "editor", "ai")) {
            var request = new MockHttpServletRequest();
            request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, Map.of("workspaceId",workspace.toString()));
            var handler = new HandlerMethod(new Routes(), Routes.class.getMethod(method));
            assertTrue(interceptor.preHandle(request, response, handler));
            assertTrue(interceptor.preHandle(request, response, handler));
        }
        verify(store,times(2)).admit(user,workspace,CostCategory.LLM,policy);
        verify(store).admit(user,workspace,CostCategory.ANALYSIS,policy);
        verify(authorization).requireContentReader(workspace,user);
        verify(authorization).requireContentEditor(workspace,user);
        verify(authorization).requireAiContributor(workspace,user);
        clearInvocations(store);
        doThrow(new ForbiddenException("Denied")).when(authorization).requireAiContributor(workspace,user);
        var request = new MockHttpServletRequest();
        request.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, Map.of("workspaceId",workspace.toString()));
        assertThrows(ForbiddenException.class, () -> interceptor.preHandle(request,response,
                new HandlerMethod(new Routes(),Routes.class.getMethod("ai"))));
        verifyNoInteractions(store);
        assertTrue(interceptor.preHandle(request,response,new Object()));
        assertTrue(interceptor.preHandle(request,response,new HandlerMethod(new Routes(),Routes.class.getMethod("ordinary"))));
        var noWorkspace = new MockHttpServletRequest();
        var invalid = new MockHttpServletRequest();
        invalid.setAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE, Map.of("workspaceId", "invalid"));
        assertThrows(dev.researchhub.shared.error.ApiException.class, () -> interceptor.preHandle(invalid, response,
                new HandlerMethod(new Routes(),Routes.class.getMethod("reader"))));
        assertThrows(IllegalStateException.class, () -> interceptor.preHandle(noWorkspace,response,
                new HandlerMethod(new Routes(),Routes.class.getMethod("reader"))));
    }
}
