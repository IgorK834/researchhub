package dev.researchhub.user.application;

import dev.researchhub.shared.error.*;
import dev.researchhub.user.domain.UserEmail;
import dev.researchhub.user.domain.UserStatus;
import dev.researchhub.user.infrastructure.UserEntity;
import dev.researchhub.user.infrastructure.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Public identity/security boundary. Other modules never read user rows or password hashes. */
@Service
public class AccountSecurityService {
    public record Identity(UUID id, String email, String normalizedEmail, String displayName, Instant emailVerifiedAt) {}
    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final PasswordPolicy policy;
    private final Clock clock;
    public AccountSecurityService(UserRepository users, PasswordEncoder passwords, PasswordPolicy policy, Clock clock) {
        this.users=users; this.passwords=passwords; this.policy=policy; this.clock=clock;
    }
    public static String normalize(String email) {
        try { return UserEmail.of(email).normalized(); }
        catch (IllegalArgumentException invalid) { throw new ApiException(ApiErrorCode.VALIDATION_FAILED, "Invalid email address"); }
    }
    @Transactional(readOnly=true)
    public Identity require(UUID user) { return identity(users.findById(user).filter(u -> u.getStatus()==UserStatus.ACTIVE)
        .orElseThrow(() -> new UnauthenticatedException("Account is unavailable"))); }
    @Transactional(readOnly=true)
    public Optional<Identity> find(String normalized) {
        return users.findByNormalizedEmail(normalized).filter(u -> u.getStatus()==UserStatus.ACTIVE).map(AccountSecurityService::identity);
    }
    @Transactional
    public void lockForSecurity(UUID user) { lock(user); }
    @Transactional
    public void changePassword(UUID user, String current, String replacement) {
        var row = lock(user);
        if (current==null || current.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > PasswordPolicy.BCRYPT_MAX_BYTES
            || !passwords.matches(current, row.getPasswordHash())) throw new UnauthenticatedException("Current password is incorrect");
        updatePassword(row, replacement);
    }
    @Transactional
    public void resetPassword(UUID user, String replacement) { updatePassword(lock(user), replacement); }
    @Transactional
    public void verifyEmail(UUID user) { var row=lock(user); if (row.getEmailVerifiedAt()==null) row.verifyEmail(clock.instant()); }
    private UserEntity lock(UUID user) {
        return users.findByIdForUpdate(user).filter(u -> u.getStatus()==UserStatus.ACTIVE)
            .orElseThrow(() -> new UnauthenticatedException("Account is unavailable"));
    }
    private void updatePassword(UserEntity row, String replacement) {
        var failure=policy.describeFailure(replacement);
        if (failure!=null) throw new ApiException(ApiErrorCode.VALIDATION_FAILED, failure);
        row.changePassword(passwords.encode(replacement), clock.instant()); users.flush();
    }
    private static Identity identity(UserEntity row) {
        return new Identity(row.getId(), row.getEmail(), row.getNormalizedEmail(), row.getDisplayName(), row.getEmailVerifiedAt());
    }
}
