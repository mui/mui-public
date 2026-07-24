import { describe, it, expect } from 'vitest';
import {
  resolveCodeFileCacheKey,
  buildCodeFileGlobalOptionsKey,
  CODE_FILE_CACHE_NAMESPACE,
  CODE_FILE_CACHE_VERSION,
} from './resolveCodeFileCacheKey';

const ROOT = '/project';

describe('resolveCodeFileCacheKey', () => {
  it('keys a file by its path relative to the root (stable, no variant suffix)', () => {
    const key = resolveCodeFileCacheKey(`${ROOT}/app/demos/Button.tsx`, ROOT);
    expect(key).toBe('app/demos/Button.tsx');
  });

  it('is stable per source file so a changed input overwrites the same entry', () => {
    // The key intentionally does NOT depend on options/variantKey — those live in
    // the validating hash — so an outdated entry is overwritten, never orphaned.
    const first = resolveCodeFileCacheKey(`${ROOT}/app/Button.tsx`, ROOT);
    const second = resolveCodeFileCacheKey(`${ROOT}/app/Button.tsx`, ROOT);
    expect(first).toBe(second);
    expect(first).toBe('app/Button.tsx');
  });

  it('returns undefined for a file outside the root (its key would escape the cache dir)', () => {
    expect(resolveCodeFileCacheKey('/elsewhere/Button.tsx', ROOT)).toBeUndefined();
  });

  it('returns undefined when the path equals the root', () => {
    expect(resolveCodeFileCacheKey(ROOT, ROOT)).toBeUndefined();
  });
});

describe('buildCodeFileGlobalOptionsKey', () => {
  const base = {
    output: 'hastCompressed',
    transformTypescriptToJavascript: true,
    emphasisOptions: { paddingFrameMaxSize: 2 },
    removeCommentsWithPrefix: ['@highlight'],
    notableCommentsPrefix: ['@focus'],
  };

  it('includes the cache version so a bump invalidates every entry', () => {
    expect(buildCodeFileGlobalOptionsKey(base)).toContain(`"version":${CODE_FILE_CACHE_VERSION}`);
  });

  it('is stable for identical options', () => {
    expect(buildCodeFileGlobalOptionsKey(base)).toBe(buildCodeFileGlobalOptionsKey({ ...base }));
  });

  it('is environment-independent so dev and prod builds share entries', () => {
    // The serialized output no longer depends on NODE_ENV, so the key must not either.
    expect(buildCodeFileGlobalOptionsKey(base)).not.toContain('isProduction');
    expect(buildCodeFileGlobalOptionsKey(base)).not.toContain('NODE_ENV');
  });

  it('changes when any output-affecting option changes', () => {
    const baseline = buildCodeFileGlobalOptionsKey(base);
    expect(buildCodeFileGlobalOptionsKey({ ...base, output: 'hastJson' })).not.toBe(baseline);
    expect(
      buildCodeFileGlobalOptionsKey({ ...base, transformTypescriptToJavascript: false }),
    ).not.toBe(baseline);
    expect(buildCodeFileGlobalOptionsKey({ ...base, emphasisOptions: {} })).not.toBe(baseline);
    expect(buildCodeFileGlobalOptionsKey({ ...base, removeCommentsWithPrefix: [] })).not.toBe(
      baseline,
    );
    expect(buildCodeFileGlobalOptionsKey({ ...base, notableCommentsPrefix: [] })).not.toBe(
      baseline,
    );
  });
});

describe('CODE_FILE_CACHE_NAMESPACE', () => {
  it('is the code-file namespace', () => {
    expect(CODE_FILE_CACHE_NAMESPACE).toBe('code-file');
  });
});
