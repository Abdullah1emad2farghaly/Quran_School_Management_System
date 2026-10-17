import type { AuthorizationDoc } from './types';

/** A public endpoint: no authentication and no authorization apply. */
export const publicEndpoint = (enforcement = 'Public endpoint: no authentication or authorization applies.'): AuthorizationDoc => ({
  authentication: 'none',
  roles: [],
  scope: 'None',
  enforcement,
  permissionId: null,
  decision: 'NOT_APPLICABLE',
});

/** Any authenticated user acting on their own session/account: authentication is the only requirement. */
export const authenticatedOnly = (scope: string, enforcement: string): AuthorizationDoc => ({
  authentication: 'required',
  roles: [],
  scope,
  enforcement,
  permissionId: null,
  decision: 'NOT_APPLICABLE',
});
