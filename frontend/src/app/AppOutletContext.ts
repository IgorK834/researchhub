import type { AuthenticatedUser } from '../features/auth/api/authApi';

/** Resolved session metadata already held by the shell; pages need no additional identity request. */
export interface AppOutletContext {
  readonly user: AuthenticatedUser;
  /** Stable editor-owned chrome mounted into the existing application top bar. */
  readonly documentTopbarHost?: HTMLElement;
}
