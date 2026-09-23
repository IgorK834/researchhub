package dev.researchhub.auth.api;

import jakarta.validation.constraints.NotBlank;

/**
 * Body of {@code POST /api/auth/login}.
 *
 * <p>Only presence is validated. Login must not apply the format or length rules that registration
 * does: telling a caller their input "is not a valid email" or "is too short to be our password" leaks
 * what a stored credential looks like, and a rule tightened later would lock out accounts created
 * under the old one. Anything that does not match a stored credential gets the same generic 401.
 */
public record LoginRequest(@NotBlank String email, @NotBlank String password) {

    @Override
    public String toString() {
        return "LoginRequest[email=" + email + ", password=REDACTED]";
    }

}
