package dev.researchhub.user.application;

import dev.researchhub.user.domain.UserEmail;
import dev.researchhub.user.domain.UserStatus;
import dev.researchhub.user.infrastructure.UserEntity;
import dev.researchhub.user.infrastructure.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Resolves users another module already knows how to identify: one exact email address, or a set of ids
 * it holds.
 *
 * <p>Separate from {@link UserAuthenticationService} because this is not authentication. That class
 * deliberately requires a password and refuses to say whether an address exists; using it to add a
 * workspace member would mean asking for a credential the caller does not have. Separate from a
 * "directory" service because there is no directory: <strong>nothing here lists or searches users</strong>.
 * Both methods take an exact key the caller must already possess, and there is no HTTP endpoint that
 * exposes either one on its own.
 *
 * <p>That restraint is the privacy boundary. An endpoint that resolved a partial email, or returned
 * several candidates, would let any account enumerate the user table. An owner adding a colleague already
 * knows their address; they type it in full or the add fails.
 *
 * <p>Available in every product runtime; persistence dependencies must be configured at startup.
 */
@Service
public class UserLookupService {

    private final UserRepository users;

    public UserLookupService(UserRepository users) {
        this.users = users;
    }

    /**
     * The active account for this exact address, or empty.
     *
     * <p>Normalization happens here, through {@link UserEmail}, so a caller in another module passes the
     * raw string a person typed and does not reimplement — or forget — the trim-and-lowercase rule that
     * uniqueness is decided on. {@code  Ada@Example.COM } therefore finds the account registered as
     * {@code ada@example.com}.
     *
     * <p>Returns empty for an address that is blank, unusable as an email, unknown, or attached to an
     * account that is not {@link UserStatus#ACTIVE}. The caller cannot tell those apart, and should answer
     * with one message for all of them: a disabled colleague and a typo must look the same, or the
     * response becomes a way to probe which addresses have accounts here.
     */
    @Transactional(readOnly = true)
    public Optional<UserAccount> findActiveByEmail(String rawEmail) {
        UserEmail email;
        try {
            email = UserEmail.of(rawEmail);
        } catch (IllegalArgumentException unusable) {
            // Not an address at all. Indistinguishable from "no such user" on purpose.
            return Optional.empty();
        }

        return users.findByNormalizedEmail(email.normalized())
                .filter(entity -> entity.getStatus() == UserStatus.ACTIVE)
                .map(entity -> UserAccount.from(entity.toDomain()));
    }

    /**
     * The accounts for these exact ids, in no particular order.
     *
     * <p>For rendering names alongside rows that already reference a user — a workspace's member list, and
     * later document or source authorship. The caller supplies the ids, so this widens nothing: it can only
     * return users the caller could already name.
     *
     * <p>Status is <strong>not</strong> filtered, unlike {@link #findActiveByEmail}. A member whose account
     * was later disabled is still a member, and dropping them from the list would make the workspace look
     * like it had fewer people in it than it does.
     */
    @Transactional(readOnly = true)
    public List<UserAccount> findAllByIds(Collection<UUID> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return users.findAllById(ids).stream()
                .map(UserEntity::toDomain)
                .map(UserAccount::from)
                .toList();
    }

}
