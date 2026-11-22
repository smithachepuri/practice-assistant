import { ProviderError } from "../core/errors";

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** POSTs JSON and returns the parsed body, turning every failure into a ProviderError. */
export async function postJson(
  fetchImpl: FetchLike,
  providerLabel: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ProviderError(`${providerLabel} request could not be sent: ${String(error)}`);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new ProviderError(
      `${providerLabel} returned HTTP ${response.status}: ${raw.slice(0, 500)}`,
      response.status,
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new ProviderError(`${providerLabel} returned a response that is not JSON.`);
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
