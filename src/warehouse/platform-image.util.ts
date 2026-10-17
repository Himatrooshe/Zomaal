import { validateImage, type WarehouseMediaUploadFile } from './media.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Only platform CDNs are fetched, so merchant-controlled URLs cannot reach internal hosts. */
export function isAllowedPlatformImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.port) return false;
  const host = parsed.hostname.toLowerCase();
  return (
    host === 'cdn.shopify.com' ||
    host === 'youcan.shop' ||
    host.endsWith('.youcan.shop')
  );
}

/** Returns null instead of throwing: a missing image never blocks an import. */
export async function downloadPlatformImage(
  url: string,
): Promise<WarehouseMediaUploadFile | null> {
  if (!isAllowedPlatformImageUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return null;
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!CONTENT_TYPES.has(contentType)) return null;
    const declared = Number(response.headers.get('content-length'));
    if (declared > MAX_IMAGE_BYTES) return null;

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        controller.abort();
        return null;
      }
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const file: WarehouseMediaUploadFile = {
      buffer,
      originalname: new URL(url).pathname.split('/').pop() || 'platform-image',
      mimetype: contentType,
      size: buffer.length,
    };
    validateImage(file);
    return file;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
