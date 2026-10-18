/** Marks a token as a super admin token, so it is never mistaken for a merchant one. */
export const SUPER_ADMIN_TOKEN_SCOPE = 'super_admin';

export interface SuperAdminJwtPayload {
  adminId: string;
  username: string;
}

export interface SuperAdminJwtTokenPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
  scope: typeof SUPER_ADMIN_TOKEN_SCOPE;
}
