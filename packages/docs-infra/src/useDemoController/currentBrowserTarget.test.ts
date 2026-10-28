import { describe, it, expect, afterEach, vi } from 'vitest';
import { currentBrowserTarget } from './currentBrowserTarget';

/** Representative user-agent strings for the engines the detector recognizes. */
const USER_AGENTS = {
  chrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  iosChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Version/17.2 Safari/604.1',
  unknown: 'Mozilla/5.0 (compatible; SomeNewBrowser/1.0)',
};

function setUserAgent(userAgent: string | undefined) {
  vi.stubGlobal('navigator', userAgent === undefined ? undefined : { userAgent });
}

describe('currentBrowserTarget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('targets the exact Chrome version', () => {
    setUserAgent(USER_AGENTS.chrome);
    expect(currentBrowserTarget()).toEqual(['chrome 131']);
  });

  it('targets Edge before Chrome (its UA contains both)', () => {
    setUserAgent(USER_AGENTS.edge);
    expect(currentBrowserTarget()).toEqual(['edge 131']);
  });

  it('targets the exact Firefox version', () => {
    setUserAgent(USER_AGENTS.firefox);
    expect(currentBrowserTarget()).toEqual(['firefox 133']);
  });

  it('targets Safari with its minor version', () => {
    setUserAgent(USER_AGENTS.safari);
    expect(currentBrowserTarget()).toEqual(['safari 17.2']);
  });

  it('targets Safari for an iOS browser (all iOS engines are WebKit)', () => {
    setUserAgent(USER_AGENTS.iosChrome);
    expect(currentBrowserTarget()).toEqual(['safari 17.2']);
  });

  it('falls back to baseline for an unrecognized browser', () => {
    setUserAgent(USER_AGENTS.unknown);
    expect(currentBrowserTarget()).toEqual(['baseline widely available']);
  });

  it('falls back to baseline when there is no navigator (SSR/Node)', () => {
    setUserAgent(undefined);
    expect(currentBrowserTarget()).toEqual(['baseline widely available']);
  });
});
