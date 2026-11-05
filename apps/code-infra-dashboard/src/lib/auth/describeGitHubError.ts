/**
 * A loggable summary of a failed GitHub call. Never log the error itself:
 * Octokit's RequestError keeps the request it made, and for the OAuth endpoints
 * that includes the client secret.
 */
export function describeGitHubError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return 'status' in error ? `${error.message} (HTTP ${String(error.status)})` : error.message;
}
