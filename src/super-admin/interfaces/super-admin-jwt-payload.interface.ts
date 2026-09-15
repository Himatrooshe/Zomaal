export interface SuperAdminJwtPayload {
  adminId: string;
  username: string;
}

export interface SuperAdminJwtTokenPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
}
