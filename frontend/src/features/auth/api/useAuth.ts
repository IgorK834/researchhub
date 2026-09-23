import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { hasApiErrorCode, queryKeys, type ApiError } from '../../../shared/api';
import {
  fetchCurrentUser,
  login,
  logout,
  register,
  type AuthenticatedUser,
  type LoginInput,
  type RegisterInput,
} from './authApi';

/**
 * The signed-in user, or `null` when nobody is signed in.
 *
 * A 401 is a normal answer here, not a failure: it is how the server says "no session". Mapping it to
 * `null` keeps `isError` meaningful for real problems, such as the backend being unreachable. Without
 * that distinction the UI could not tell "please log in" from "something is broken".
 *
 * Runs on mount, which is what restores the user after a page reload.
 */
export function useCurrentUser(): UseQueryResult<AuthenticatedUser | null, Error> {
  return useQuery({
    queryKey: queryKeys.currentUser(),
    queryFn: async ({ signal }) => {
      try {
        return await fetchCurrentUser(signal);
      } catch (error) {
        if (hasApiErrorCode(error, 'UNAUTHENTICATED')) {
          return null;
        }
        throw error;
      }
    },
    // An expired session should be noticed promptly rather than served from cache.
    staleTime: 0,
    // Retrying a 401 is pointless, and this query treats it as data anyway.
    retry: false,
  });
}

/**
 * Logs in and seeds the current-user cache from the response.
 *
 * Seeding avoids an immediate second round trip for data the login call already returned. The stored
 * value is public metadata only; the password is not retained and the session id is not readable.
 */
export function useLogin(): UseMutationResult<AuthenticatedUser, ApiError, LoginInput> {
  const queryClient = useQueryClient();

  return useMutation<AuthenticatedUser, ApiError, LoginInput>({
    mutationFn: (input) => login(input),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.currentUser(), user);
    },
  });
}

/**
 * Registers an account.
 *
 * Does not touch the current-user cache: registration deliberately does not establish a session, so
 * writing a user here would make the app look signed in when the server disagrees.
 */
export function useRegister(): UseMutationResult<
  AuthenticatedUser,
  ApiError,
  RegisterInput
> {
  return useMutation<AuthenticatedUser, ApiError, RegisterInput>({
    mutationFn: (input) => register(input),
  });
}

/**
 * Logs out and drops every cached response.
 *
 * The server invalidating the session is what revokes access; this clears what that session put in
 * memory. `clear()` rather than removing one key, because anything fetched while signed in was fetched
 * as that user, and leaving it behind would show one person's data to whoever signs in next in the same
 * tab. The only other cached entry today is the public health status, so re-fetching it is the whole cost.
 *
 * Nothing is written to `localStorage` or `sessionStorage` on the way out, because nothing was ever kept
 * there.
 */
export function useLogout(): UseMutationResult<void, ApiError, void> {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, void>({
    mutationFn: () => logout(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
