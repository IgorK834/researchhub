package dev.researchhub.user.domain;

/**
 * Lifecycle state of a ResearchHub identity.
 *
 * <p>An account is disabled or locked rather than deleted, so workspace membership history and
 * authored content keep pointing at a real identity. The {@code users.status} check constraint in
 * {@code V2__create_users.sql} allows exactly these names; adding a value here needs a migration
 * that widens that constraint in the same change.
 */
public enum UserStatus {

    /** Normal account. May authenticate once the auth module exists. */
    ACTIVE,

    /** Deactivated by an administrator or by the user. Must not be able to authenticate. */
    DISABLED,

    /** Temporarily barred, for example after repeated failed sign-in attempts. */
    LOCKED

}
