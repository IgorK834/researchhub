import type { AuthenticatedUser } from '../features/auth/api/authApi';

/** Resolved session metadata already held by the shell; pages need no additional identity request. */
export interface AppOutletContext {
  readonly user: AuthenticatedUser;
}
