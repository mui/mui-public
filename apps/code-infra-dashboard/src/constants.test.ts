import { vi, describe, it, expect, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** DASHBOARD_ORIGIN is computed once at load, so each case loads a fresh copy. */
async function loadDashboardOrigin(env: Record<string, string | undefined>): Promise<string> {
  for (const [name, value] of Object.entries(env)) {
    vi.stubEnv(name, value);
  }
  vi.resetModules();
  const { DASHBOARD_ORIGIN } = await import('./constants');
  return DASHBOARD_ORIGIN;
}

describe('DASHBOARD_ORIGIN', () => {
  it('uses the configured origin in production', async () => {
    const origin = await loadDashboardOrigin({
      IS_PULL_REQUEST: 'false',
      DASHBOARD_ORIGIN: 'https://dashboard.example.com',
      RENDER_EXTERNAL_URL: 'https://dashboard.onrender.example',
    });

    expect(origin).toBe('https://dashboard.example.com');
  });

  // A preview inherits production's DASHBOARD_ORIGIN, but its links and signed QR
  // codes have to point back at the preview itself.
  it("uses a preview's own URL even when the production origin is inherited", async () => {
    const origin = await loadDashboardOrigin({
      IS_PULL_REQUEST: 'true',
      DASHBOARD_ORIGIN: 'https://dashboard.example.com',
      RENDER_EXTERNAL_URL: 'https://dashboard-pr-1.onrender.example',
    });

    expect(origin).toBe('https://dashboard-pr-1.onrender.example');
  });

  it('falls back to the Render URL when no origin is configured', async () => {
    const origin = await loadDashboardOrigin({
      IS_PULL_REQUEST: 'false',
      DASHBOARD_ORIGIN: undefined,
      RENDER_EXTERNAL_URL: 'https://dashboard.onrender.example',
    });

    expect(origin).toBe('https://dashboard.onrender.example');
  });
});
