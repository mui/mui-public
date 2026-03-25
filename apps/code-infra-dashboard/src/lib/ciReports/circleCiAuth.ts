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

export type CircleCiTokenClaims = z.infer<typeof circleCiClaimsSchema>;

/**
 * Verifies a CircleCI OIDC token and returns the parsed claims.
 * Throws if the token is invalid or the claims don't match the expected schema.
 */
export async function verifyCircleCiToken(token: string): Promise<CircleCiTokenClaims> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `https://oidc.circleci.com/org/${CIRCLECI_ORG_ID}`,
  });

  const claims = circleCiClaimsSchema.parse(payload);

  if (claims['oidc.circleci.com/org-id'] !== CIRCLECI_ORG_ID) {
    throw new Error(`Unexpected CircleCI org ID: ${claims['oidc.circleci.com/org-id']}`);
  }

  return claims;
}
