import { describe, expect, it } from 'vitest';
import { majorVersionOf, withBrowserDefaults } from './browser.mjs';

describe('majorVersionOf', () => {
  it('reads the major from Chrome for Testing output', () => {
    expect(majorVersionOf('Google Chrome for Testing 151.0.7922.34')).toBe(151);
  });

  it('reads the major from plain Chrome output', () => {
    expect(majorVersionOf('Google Chrome 152.0.6367.60')).toBe(152);
  });

  it('reads the major from a bare package version', () => {
    // chromedriver's package.json version, which is what the driver side is read from.
    expect(majorVersionOf('151.0.5')).toBe(151);
  });

  it('returns undefined when there is no version to read', () => {
    expect(majorVersionOf('')).toBeUndefined();
    expect(majorVersionOf('no version here')).toBeUndefined();
  });

  it('ignores a leading number that is not part of a version', () => {
    // Requires three dot-separated components, so a stray count cannot be mistaken for a version.
    expect(majorVersionOf('2 browsers found: Chrome 151.0.7922.34')).toBe(151);
  });
});

describe('withBrowserDefaults', () => {
  const BINARY = '/path/to/Chrome for Testing';

  it('fills in the binary for a case that does not pin one', () => {
    expect(withBrowserDefaults({ name: 'chrome', headless: true }, BINARY, false)).toEqual({
      name: 'chrome',
      headless: true,
      binary: BINARY,
    });
  });

  it('leaves a case that pins its own binary alone', () => {
    const pinned = withBrowserDefaults({ binary: '/opt/chrome' }, BINARY, false);

    expect(pinned.binary).toBe('/opt/chrome');
  });

  it('keeps the sandbox when the run is not root', () => {
    // The sandbox is a real protection for the pages a benchmark loads; only root cannot have it.
    expect(withBrowserDefaults({ name: 'chrome' }, BINARY, false)).not.toHaveProperty(
      'addArguments',
    );
  });

  it('disables the sandbox when the run is root', () => {
    expect(withBrowserDefaults({ name: 'chrome' }, BINARY, true).addArguments).toEqual([
      '--no-sandbox',
    ]);
  });

  it("keeps a case's own arguments when it disables the sandbox", () => {
    // Cases pass flags that hold their measurements still; dropping them would move the numbers.
    const merged = withBrowserDefaults(
      { addArguments: ['--disable-renderer-backgrounding'] },
      BINARY,
      true,
    );

    expect(merged.addArguments).toEqual(['--disable-renderer-backgrounding', '--no-sandbox']);
  });

  it('does not repeat an argument a case already passes', () => {
    const merged = withBrowserDefaults({ addArguments: ['--no-sandbox'] }, BINARY, true);

    expect(merged.addArguments).toEqual(['--no-sandbox']);
  });

  it('names the browser for a case that declares none', () => {
    // Tachometer defaults an absent `browser` to chrome, but validates the config against a schema
    // where every browser variant requires `name` — so injecting the binary alone is rejected
    // before a single sample is taken.
    expect(withBrowserDefaults(undefined, BINARY, true)).toEqual({
      name: 'chrome',
      binary: BINARY,
      addArguments: ['--no-sandbox'],
    });
  });

  it('expands the string shorthand instead of spreading it into characters', () => {
    expect(withBrowserDefaults('chrome-headless', BINARY, false)).toEqual({
      name: 'chrome',
      headless: true,
      binary: BINARY,
    });
  });

  it('keeps the remote url out of the browser name', () => {
    expect(withBrowserDefaults('firefox@http://localhost:4444', BINARY, false)).toEqual({
      name: 'firefox',
      headless: false,
      remoteUrl: 'http://localhost:4444',
      binary: BINARY,
    });
  });

  it('names the browser for a case whose object leaves it out', () => {
    expect(withBrowserDefaults({ headless: true }, BINARY, false).name).toBe('chrome');
  });
});
