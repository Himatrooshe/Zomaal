export interface JwtPayload {
  userId: string;
  phone: string;
  /** Session was started with "Remember me". */
  rememberMe?: boolean;
}

export interface JwtTokenPayload {
  sub: string;
  phone: string;
  type: 'access' | 'refresh' | 'password_reset';
  /** Access and refresh tokens: issued with "Remember me". */
  rm?: boolean;
  /** Password-reset tokens only: fingerprint of the password at issue time. */
  pwv?: string;
}
