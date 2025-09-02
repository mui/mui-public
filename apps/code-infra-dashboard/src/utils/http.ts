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
