/** Fetch Netlify JSON without exposing credentials or response bodies in errors. */
async function readNetlifyJson(url, token, label) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error(`Netlify ${label} failed: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Netlify ${label} returned invalid JSON`);
  }
}

/** Retrieve a finished deployment's logs after verifying the inspected PR head. */
export async function fetchNetlifyLogs(deployId, head) {
  const token = process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_CONTROL_TOKEN;
  const deploy = await readNetlifyJson(
    `https://api.netlify.com/api/v1/deploys/${deployId}`,
    token,
    'deployment metadata request',
  );
  if (deploy.id !== deployId || !deploy.site_id || deploy.commit_ref !== head) {
    throw new Error('Netlify deployment does not match the inspected head or lacks site metadata');
  }
  if (!['error', 'ready', 'rejected'].includes(deploy.state)) {
    throw new Error(`Netlify deployment is not finished (state: ${deploy.state})`);
  }
  const url = new URL('https://app.netlify.com/access-control/generate-access-control-token');
  url.search = new URLSearchParams({ deploy_id: deployId, site_id: deploy.site_id }).toString();
  // Public deploys allow an anonymous bearer value, but omitting the header returns HTTP 400.
  // Match the upstream example's interpolation when its credential variable is unset.
  const { accessControlToken } = await readNetlifyJson(
    url,
    token || 'undefined',
    'access-control token request',
  );
  if (typeof accessControlToken !== 'string' || !accessControlToken) {
    throw new Error('Netlify access-control token response lacks a token');
  }
  const result = await readDeploySocket({
    deploy_id: deployId,
    site_id: deploy.site_id,
    access_token: accessControlToken,
  });
  return {
    log: result.log,
    evidence: {
      deployId,
      siteId: deploy.site_id,
      head: deploy.commit_ref,
      state: deploy.state,
      endedBy: result.endedBy,
    },
  };
}

/** Read the external log stream, bounded by total time and inactivity after log messages. */
export function readDeploySocket(payload) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket('wss://socketeer.services.netlify.com/build/logs');
    const lines = [];
    let idleTimer;
    let settled = false;
    const deadline = setTimeout(() => finish(new Error('Netlify log stream timed out')), 30_000);

    /** Close once and never report an empty or failed stream as successful. */
    function finish(error, endedBy) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(idleTimer);
      socket.close();
      const log = lines.join('\n');
      if (error || !log.trim()) {
        reject(error ?? new Error('Netlify log stream returned no log content'));
      } else {
        resolve({ log, endedBy });
      }
    }

    socket.addEventListener('open', () => socket.send(JSON.stringify(payload)));
    socket.addEventListener('error', () =>
      finish(new Error('Netlify log WebSocket connection failed')),
    );
    socket.addEventListener('close', (event) => {
      finish(
        event.code === 1000 ? undefined : new Error(`Netlify log WebSocket closed: ${event.code}`),
        'socket-close',
      );
    });
    socket.addEventListener('message', (event) => {
      if (settled) {
        return;
      }
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        finish(new Error('Netlify log stream returned invalid JSON'));
        return;
      }
      if (!data || typeof data !== 'object' || data.type === 'error') {
        finish(new Error('Netlify log stream returned an error response'));
        return;
      }
      if (typeof data.message !== 'string' || !data.message.trim()) {
        return;
      }
      lines.push(data.message);
      // Netlify may drop the socket without a close frame after this final build record.
      if (data.message.startsWith('Finished processing build request in ')) {
        finish(undefined, 'build-finished');
        return;
      }
      // The example defines no end marker. Finished deploys are read until a quiet period.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(undefined, 'idle-timeout'), 5_000);
    });
  });
}
