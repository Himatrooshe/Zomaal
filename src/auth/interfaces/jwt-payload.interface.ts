export interface JwtPayload {
  userId: string;
  phone: string;
}

export interface JwtTokenPayload {
  sub: string;
  phone: string;
  type: 'access' | 'refresh';
}
