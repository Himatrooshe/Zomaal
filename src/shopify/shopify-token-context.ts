export function accessTokenContext(shopDomain: string): string {
  return `shopify:${shopDomain}:access-token`;
}

export function refreshTokenContext(shopDomain: string): string {
  return `shopify:${shopDomain}:refresh-token`;
}
