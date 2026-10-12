package dev.researchhub.user.infrastructure;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data repository for {@link UserEntity}. Found by Spring Boot's repository auto-configuration
 * in every runtime with JPA persistence.
 *
 * <p>Lookups go through the normalized email, never the raw one, so sign-in is case- and
 * whitespace-insensitive in the same way the unique index is.
 */
public interface UserRepository extends JpaRepository<UserEntity, UUID> {

    Optional<UserEntity> findByNormalizedEmail(String normalizedEmail);

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select u from UserEntity u where u.id = :id")
    Optional<UserEntity> findByIdForUpdate(UUID id);

    boolean existsByNormalizedEmail(String normalizedEmail);

}
