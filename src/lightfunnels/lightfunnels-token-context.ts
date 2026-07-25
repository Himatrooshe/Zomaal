export function lightfunnelsAccessTokenContext(
  externalAccountId: string,
): string {
  return `lightfunnels:account:${externalAccountId}:access-token`;
}
