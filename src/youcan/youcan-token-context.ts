export function youCanAccessTokenContext(externalStoreId: string): string {
  return `youcan:${externalStoreId}:access-token`;
}

export function youCanRefreshTokenContext(externalStoreId: string): string {
  return `youcan:${externalStoreId}:refresh-token`;
}
