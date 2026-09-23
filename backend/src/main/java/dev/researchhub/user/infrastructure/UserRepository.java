package dev.researchhub.user.infrastructure;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link UserEntity}. Found by the JPA scan in
 * {@code dev.researchhub.shared.infrastructure.persistence.JpaPersistenceConfiguration}.
 *
 * <p>Lookups go through the normalized email, never the raw one, so sign-in is case- and
 * whitespace-insensitive in the same way the unique index is.
 */
public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    Optional<UserEntity> findByNormalizedEmail(String normalizedEmail);

    boolean existsByNormalizedEmail(String normalizedEmail);

}
