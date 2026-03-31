import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod/v4';

const CIRCLECI_ORG_ID = '8268f1d5-9e76-4077-bf49-2c2007b7d71f';

const jwks = createRemoteJWKSet(
  new URL(`https://oidc.circleci.com/org/${CIRCLECI_ORG_ID}/.well-known/jwks-pub.json`),
);

// Note on fork builds: org-id is always the upstream org's ID, even for fork PRs.
// However, vcs-origin will be the fork (e.g. "github.com/user/repo" instead of
// "github.com/mui/repo") and vcs-ref will be "refs/heads/pull/<number>" rather than
// the actual branch name. This means these claims can't be used for repo/branch
// validation — we rely on GitHub API checks for that.
const circleCiClaimsSchema = z.object({
  'oidc.circleci.com/vcs-origin': z.string(),
  'oidc.circleci.com/vcs-ref': z.string(),
  'oidc.circleci.com/org-id': z.string(),
});

export interface OidcVerificationResult {
  /** The CI provider name */
  provider: string;
  /** The source repository in "owner/repo" format — the repo the build runs from */
  sourceRepo: string;
  /** Whether the source repo belongs to the mui org (fully trusted) */
  isTrusted: boolean;
  /** All verified JWT claims (provider-specific) */
  rawClaims: Record<string, unknown>;
}

/**
 * Verifies a CI OIDC token and returns normalized verification result.
 * Currently only supports CircleCI. When adding GitHub Actions support,
 * decode the JWT issuer first and branch to provider-specific verification.
 */
export async function verifyOidcToken(token: string): Promise<OidcVerificationResult> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://oidc.circleci.com/org/${CIRCLECI_ORG_ID}`,
  });

  const claims = circleCiClaimsSchema.parse(payload);

  if (claims['oidc.circleci.com/org-id'] !== CIRCLECI_ORG_ID) {
    throw new Error(`Unexpected CircleCI org ID: ${claims['oidc.circleci.com/org-id']}`);
  }

  const vcsOrigin = claims['oidc.circleci.com/vcs-origin'];
  const sourceRepo = vcsOrigin.replace(/^github\.com\//, '');

  return {
    provider: 'circleci',
    sourceRepo,
    isTrusted: sourceRepo.startsWith('mui/'),
    rawClaims: claims as unknown as Record<string, unknown>,
  };
}
