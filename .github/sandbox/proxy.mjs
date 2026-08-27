// Credential sidecar for the sandboxed flake-fix agent.
//
// The agent container is given ANTHROPIC_BASE_URL=http://<this>:8080 and nothing
// else. This process is the only thing that ever holds an Anthropic credential:
// it mints a GitHub OIDC token from the Actions runtime, exchanges it for a
// short-lived Anthropic access token via Workload Identity Federation, and
// forwards a narrow allowlist of API paths with that token attached. The agent
// never sees the token, the identity JWT, or the WIF configuration.
//
// Runs on plain Node (global fetch, node:http) — no dependencies by design, so
// the image is stock `node:alpine` and the whole trust surface is this one file.
//
// DEBUG=1 logs lifecycle events (never secret values) to stderr.

import { createServer } from 'node:http';

const UPSTREAM = process.env.UPSTREAM_BASE_URL || 'https://api.anthropic.com';
const PORT = Number(process.env.PORT || 8080);
const OIDC_AUDIENCE = process.env.ANTHROPIC_OIDC_AUDIENCE || 'https://api.anthropic.com';

// The exchange body. These four identify the caller to Anthropic's federation
// rule; none of them is a secret the way the resulting access token is, but they
// stay on this side of the boundary regardless.
const FEDERATION = {
  federation_rule_id: process.env.ANTHROPIC_FEDERATION_RULE_ID,
  organization_id: process.env.ANTHROPIC_ORGANIZATION_ID,
  service_account_id: process.env.ANTHROPIC_SERVICE_ACCOUNT_ID,
  workspace_id: process.env.ANTHROPIC_WORKSPACE_ID,
};

// GitHub injects these two into any job with `id-token: write`. Their presence is
// what makes minting possible; keeping them in the sidecar is what keeps the
// agent unable to mint anything itself.
const OIDC_REQUEST_URL = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const OIDC_REQUEST_TOKEN = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

// Only these reach the upstream. Everything else gets a 403 — the agent cannot
// use this hole to reach arbitrary Anthropic endpoints, let alone the wider net.
const ALLOWED = new Set(['/v1/messages', '/v1/messages/count_tokens']);

// Caps. A runaway or injected agent can spend, but only up to here.
const MAX_REQUESTS = Number(process.env.MAX_REQUESTS || 200);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 5_000_000);

const debug = process.env.DEBUG === '1' ? (...args) => console.error('[proxy]', ...args) : () => {};

let requestCount = 0;
let outputTokensSeen = 0;

// --- credential lifecycle -------------------------------------------------

let cached = null; // { token, expiresAt }

async function mintIdentityToken() {
  if (!OIDC_REQUEST_URL || !OIDC_REQUEST_TOKEN) {
    throw new Error('missing ACTIONS_ID_TOKEN_REQUEST_URL/TOKEN — job needs `id-token: write`');
  }
  const url = `${OIDC_REQUEST_URL}&audience=${encodeURIComponent(OIDC_AUDIENCE)}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${OIDC_REQUEST_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`OIDC mint failed: ${response.status}`);
  }
  const body = await response.json();
  return body.value;
}

let loggedExchangeKeys = false;

async function exchange(assertion) {
  const response = await fetch(`${UPSTREAM}/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
      ...FEDERATION,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    // Surface the error shape, not the assertion — helps diagnose a bad
    // federation rule without leaking the JWT.
    throw new Error(
      `token exchange failed: ${response.status} ${JSON.stringify(body?.error ?? body)}`,
    );
  }
  // First success confirms the response shape in CI without printing the token.
  if (!loggedExchangeKeys) {
    debug('exchange response keys:', Object.keys(body).join(','));
    loggedExchangeKeys = true;
  }
  const token = body.access_token;
  if (!token) {
    throw new Error(`exchange response has no access_token (keys: ${Object.keys(body).join(',')})`);
  }
  const expiresInSec = Number(body.expires_in) || 3600;
  return { token, expiresAt: Date.now() + expiresInSec * 1000 };
}

// Refresh 60s before expiry so a long run never presents a stale token.
async function getToken() {
  if (cached && cached.expiresAt - Date.now() > 60_000) {
    return cached.token;
  }
  const assertion = await mintIdentityToken();
  cached = await exchange(assertion);
  debug('token refreshed, expires in', Math.round((cached.expiresAt - Date.now()) / 1000), 's');
  return cached.token;
}

// --- forwarding -----------------------------------------------------------

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

// Pull output-token counts out of the response so the spend cap can see streamed
// runs. Non-streaming: usage is in the JSON body. Streaming (what the CLI uses):
// the final tally rides in the `message_delta` SSE event.
function accountOutputTokens(contentType, text) {
  try {
    if (contentType.includes('text/event-stream')) {
      let total = 0;
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }
        const event = JSON.parse(payload);
        const output = event?.usage?.output_tokens ?? event?.message?.usage?.output_tokens;
        if (typeof output === 'number') {
          total = output;
        }
      }
      return total;
    }
    const parsed = JSON.parse(text);
    return parsed?.usage?.output_tokens ?? 0;
  } catch {
    return 0;
  }
}

function deny(response, status, message) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { type: 'proxy_denied', message } }));
}

async function handle(request, response) {
  const path = (request.url || '').split('?')[0];

  if (request.method !== 'POST' || !ALLOWED.has(path)) {
    debug('blocked', request.method, path);
    deny(response, 403, `path not permitted: ${request.method} ${path}`);
    return;
  }
  if (requestCount >= MAX_REQUESTS) {
    deny(response, 429, `request cap reached (${MAX_REQUESTS})`);
    return;
  }
  if (outputTokensSeen >= MAX_OUTPUT_TOKENS) {
    deny(response, 429, `output-token cap reached (${MAX_OUTPUT_TOKENS})`);
    return;
  }
  requestCount += 1;

  let token;
  try {
    token = await getToken();
  } catch (error) {
    debug('token error:', error.message);
    deny(response, 502, 'upstream authentication unavailable');
    return;
  }

  const body = await readBody(request);

  // Rebuild headers from scratch: forward only what the API needs, and never
  // whatever auth the client sent. anthropic-beta is preserved and the oauth
  // flag is merged in, since the access token authenticates as an OAuth grant.
  const forwardHeaders = {
    'content-type': request.headers['content-type'] || 'application/json',
    'anthropic-version': request.headers['anthropic-version'] || '2023-06-01',
    authorization: `Bearer ${token}`,
  };
  const betas = new Set(['oauth-2025-04-20']);
  const clientBeta = request.headers['anthropic-beta'];
  if (clientBeta) {
    for (const flag of clientBeta.split(',')) {
      const trimmed = flag.trim();
      if (trimmed) {
        betas.add(trimmed);
      }
    }
  }
  forwardHeaders['anthropic-beta'] = [...betas].join(',');

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}${path}`, {
      method: 'POST',
      headers: forwardHeaders,
      body,
    });
  } catch (error) {
    debug('upstream fetch error:', error.message);
    deny(response, 502, 'upstream request failed');
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  const text = await upstream.text();
  outputTokensSeen += accountOutputTokens(contentType, text);
  debug(
    'forwarded',
    path,
    '→',
    upstream.status,
    '| reqs',
    requestCount,
    '| out-tokens',
    outputTokensSeen,
  );

  response.writeHead(upstream.status, { 'content-type': contentType });
  response.end(text);
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    debug('handler crash:', error.message);
    if (!response.headersSent) {
      deny(response, 500, 'internal proxy error');
    } else {
      response.end();
    }
  });
});

server.listen(PORT, () => debug(`listening on ${PORT}, upstream ${UPSTREAM}`));
