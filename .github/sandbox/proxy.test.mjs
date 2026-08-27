// Offline test for the credential sidecar. Stands up fake GitHub-OIDC, fake Anthropic exchange,
// and fake upstream servers, points proxy.mjs at them, and asserts the security-relevant
// behavior: client auth is stripped and replaced, only allowlisted paths pass, credentials are
// minted once and cached, and the request cap is enforced. No real credentials, no network.
//
// Run: node --test .github/sandbox/proxy.test.mjs

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const PROXY = new URL('./proxy.mjs', import.meta.url).pathname;

const listen = async (handler) => {
  const server = createServer(handler);
  server.listen(0);
  await once(server, 'listening');
  return { server, port: server.address().port };
};

const readJson = (request) =>
  new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch {
        resolve({});
      }
    });
  });

// Shared fixtures across the suite.
const state = { lastUpstreamHeaders: null, mintCount: 0, exchangeCount: 0 };
let oidc;
let upstream;
let child;
let base;

before(async () => {
  oidc = await listen((request, response) => {
    state.mintCount += 1;
    if (request.headers.authorization !== 'Bearer runtime-request-token') {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ value: 'fake.identity.jwt', count: 1 }));
  });

  upstream = await listen(async (request, response) => {
    if (request.url === '/v1/oauth/token') {
      state.exchangeCount += 1;
      const body = await readJson(request);
      const valid =
        body.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer' &&
        body.assertion === 'fake.identity.jwt' &&
        body.federation_rule_id === 'fdrl_test';
      if (!valid) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'bad exchange request' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          access_token: 'secret-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
      );
      return;
    }
    if (request.url === '/v1/messages') {
      state.lastUpstreamHeaders = request.headers;
      await readJson(request);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n',
      );
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      return;
    }
    response.writeHead(404).end();
  });

  const proxyPort = 8199;
  child = spawn(process.execPath, [PROXY], {
    env: {
      ...process.env,
      PORT: String(proxyPort),
      UPSTREAM_BASE_URL: `http://127.0.0.1:${upstream.port}`,
      ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${oidc.port}/token?api-version=2.0`,
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runtime-request-token',
      ANTHROPIC_FEDERATION_RULE_ID: 'fdrl_test',
      ANTHROPIC_ORGANIZATION_ID: 'org_test',
      ANTHROPIC_SERVICE_ACCOUNT_ID: 'svac_test',
      ANTHROPIC_WORKSPACE_ID: 'wrkspc_test',
      MAX_REQUESTS: '3',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 400);
  });
  base = `http://127.0.0.1:${proxyPort}`;
});

after(() => {
  child?.kill();
  oidc?.server.close();
  upstream?.server.close();
});

test('strips client auth, injects the bearer, merges the oauth beta, passes SSE back', async () => {
  const response = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer client-supplied-should-be-dropped',
      'x-api-key': 'client-key-should-be-dropped',
      'anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
    },
    body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 16, messages: [] }),
  });
  const text = await response.text();
  const seen = state.lastUpstreamHeaders;
  assert.equal(response.status, 200);
  assert.equal(seen.authorization, 'Bearer secret-access-token');
  assert.equal(seen['x-api-key'], undefined);
  assert.match(seen['anthropic-beta'], /oauth-2025-04-20/);
  assert.match(seen['anthropic-beta'], /fine-grained-tool-streaming-2025-05-14/);
  assert.match(text, /message_delta/);
  assert.equal(state.mintCount, 1, 'token minted once');
  assert.equal(state.exchangeCount, 1, 'token exchanged once');
});

test('blocks a disallowed path before touching credentials', async () => {
  const mintBefore = state.mintCount;
  const response = await fetch(`${base}/v1/models`, { method: 'POST', body: '{}' });
  assert.equal(response.status, 403);
  assert.equal(state.mintCount, mintBefore, 'blocked path must not mint');
});

test('blocks a GET on an allowed path', async () => {
  const response = await fetch(`${base}/v1/messages`);
  assert.equal(response.status, 403);
});

test('enforces the request cap', async () => {
  // One request already spent above; MAX_REQUESTS=3, so two more pass then the next 429s.
  await fetch(`${base}/v1/messages`, { method: 'POST', body: '{}' });
  await fetch(`${base}/v1/messages`, { method: 'POST', body: '{}' });
  const capped = await fetch(`${base}/v1/messages`, { method: 'POST', body: '{}' });
  assert.equal(capped.status, 429);
});
