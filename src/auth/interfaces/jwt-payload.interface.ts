export interface JwtPayload {
  userId: string;
  phone: string;
}

export interface JwtTokenPayload {
  sub: string;
  phone: string;
  type: 'access' | 'refresh' | 'password_reset';
  /** Refresh tokens only: issued with "Remember me". */
  rm?: boolean;
  /** Password-reset tokens only: fingerprint of the password at issue time. */
  pwv?: string;
}
