/**
 * YouCan's GET /orders/{id} endpoint returns the order object directly.
 * Accept the common wrapper forms as well so the integration stays tolerant
 * if an API gateway wraps the resource.
 */
export function unwrapYouCanOrder<T extends { id?: unknown }>(
  response: unknown,
): T | null {
  if (!isRecord(response)) return null;

  for (const candidate of [response, response.order, response.data]) {
    if (
      isRecord(candidate) &&
      candidate.id !== undefined &&
      candidate.id !== null
    ) {
      return candidate as T;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
