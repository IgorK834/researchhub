package dev.researchhub.workspace.application;

import dev.researchhub.shared.infrastructure.persistence.PostgresTestcontainersConfiguration;
import dev.researchhub.workspace.UserRowFixture;
import dev.researchhub.workspace.infrastructure.WorkspaceMemberRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

/**
 * Proves that a workspace and its owner membership are written in one transaction.
 *
 * <p>Deliberately <strong>not</strong> {@code @Transactional}, unlike the other workspace persistence
 * tests. A test-managed transaction would swallow the very thing under test: the service would join the
 * test's transaction, and the rollback that matters would be indistinguishable from the rollback the
 * test performs at the end anyway. Here the service owns the transaction, so a failure inside it is a
 * real commit-or-nothing decision, and rows are cleaned before each method instead.
 *
 * <p>Why it matters: a workspace is reachable only through a membership. A committed workspace with no
 * membership row would be invisible and unreachable to everyone, including its creator — nobody could
 * open it, delete it, or grant anyone access to it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles("local")
@Import(PostgresTestcontainersConfiguration.class)
class WorkspaceCreationTransactionIntegrationTest {

    /**
     * A spy rather than a mock: every test but one needs the repository to behave normally, and the
     * failing test stubs a single call.
     */
    @MockitoSpyBean
    private WorkspaceMemberRepository members;

    @Autowired
    private WorkspaceService workspaces;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void removeRowsFromPreviousTests() {
        UserRowFixture.deleteWorkspaceAndUserRows(jdbcTemplate);
    }

    private int countRows(String table) {
        Integer count = jdbcTemplate.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return count == null ? 0 : count;
    }

    @Test
    void commitsTheWorkspaceAndItsOwnerMembershipTogether() {
        UUID creator = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada Lovelace");

        WorkspaceSummary created = workspaces.create(
                new CreateWorkspaceCommand("Electronics Lab", "Team 4", creator));

        assertEquals(1, countRows("workspaces"), "The workspace is committed");
        assertEquals(1, countRows("workspace_members"), "So is the membership that makes it reachable");
        assertEquals(1, (int) jdbcTemplate.queryForObject("""
                        SELECT count(*) FROM workspace_members
                        WHERE workspace_id = ? AND user_id = ? AND role = 'OWNER'
                        """, Integer.class, created.id(), creator),
                "The committed membership is an OWNER row for the creator");
    }

    @Test
    void aFailedMembershipInsertLeavesNoWorkspaceRow() {
        UUID creator = UserRowFixture.insertUser(jdbcTemplate, "ada@example.com", "Ada Lovelace");
        doThrow(new DataIntegrityViolationException("forced membership failure"))
                .when(members).saveAndFlush(any());

        assertThrows(DataIntegrityViolationException.class,
                () -> workspaces.create(new CreateWorkspaceCommand("Electronics Lab", "Team 4", creator)),
                "The failure must surface rather than leaving a half-created workspace behind");

        assertEquals(0, countRows("workspaces"),
                "The workspace insert must roll back with the membership, not survive it");
        assertEquals(0, countRows("workspace_members"));
    }

}
