import { BadGatewayException } from '@nestjs/common';

export async function parseProviderJson<T>(
  response: Response,
  provider: string,
): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadGatewayException(`${provider} returned a non-JSON response`);
  }
}
