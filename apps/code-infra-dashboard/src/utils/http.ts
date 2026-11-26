export interface FetchJsonOptions {
  ignoreHttpErrors?: boolean;
}

export async function fetchJson<T = unknown>(
  url: string,
  { ignoreHttpErrors = false }: FetchJsonOptions = {},
): Promise<T> {
  const response = await fetch(url);
  if (!ignoreHttpErrors && !response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} while fetching ${url}`);
  }
  return response.json();
}

/** The HTTP status a failed request's error carries, as Octokit's errors do. */
export function httpStatus(error: unknown): number | undefined {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}
