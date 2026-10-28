import { readdir } from 'node:fs/promises';
import path from 'node:path';

const INDEX_FILE_NAME = 'index.ts';

/**
 * Converts a Turbopack-style glob (e.g. `./app/**\/demos/*\/index.ts`) to a
 * RegExp that matches absolute filesystem paths. Mirrors the logic used by
 * `withDocsInfra` for webpack rule generation. Pass-through when the input is
 * already a RegExp (webpack-rule `test` regexes).
 */
export function patternToRegExp(pattern: string | RegExp): RegExp {
  if (pattern instanceof RegExp) {
    return pattern;
  }
  // Sentinels are wrapped in NUL bytes, which cannot occur in a file path or
  // glob. That makes them un-forgeable: the two-pass token substitution below
  // can never synthesize a sentinel by concatenating literal input with inserted
  // replacement output (e.g. an input segment ending in "NOT_" fusing with a
  // freshly-inserted separator). Built via fromCharCode so the source carries no
  // literal NUL bytes.
  const NUL = String.fromCharCode(0);
  const SEP = `${NUL}SEP${NUL}`;
  const NOT_SEP = `${NUL}NOT_SEP${NUL}`;
  const DOUBLE_STAR = `${NUL}DOUBLE_STAR${NUL}`;
  const body = pattern
    .replace(/^\.\//, '') // drop leading ./
    .replace(/\*\*\//g, DOUBLE_STAR)
    .replace(/\*/g, NOT_SEP)
    .replace(/\./g, '\\.')
    .replace(new RegExp(DOUBLE_STAR, 'g'), `(?:${NOT_SEP}${SEP})*`)
    .replace(/\//g, SEP)
    .replace(new RegExp(NOT_SEP, 'g'), '[^/\\\\]+')
    .replace(new RegExp(SEP, 'g'), '[/\\\\]');
  return new RegExp(`(?:^|[/\\\\])${body}$`);
}

/**
 * Finds the longest fixed-prefix directory in a glob pattern so we can avoid
 * walking the entire workspace. Webpack `test` regexes have no extractable
 * prefix, so we fall back to walking from `baseDir`.
 */
function patternBaseDir(pattern: string | RegExp, baseDir: string): string {
  if (pattern instanceof RegExp) {
    return baseDir;
  }
  const stripped = pattern.replace(/^\.\//, '');
  const segments = stripped.split('/');
  const fixed: string[] = [];
  for (const segment of segments) {
    if (segment.includes('*')) {
      break;
    }
    fixed.push(segment);
  }
  return path.join(baseDir, ...fixed);
}

async function collectIndexFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return out;
    }
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await collectIndexFiles(full);
        out.push(...sub);
      } else if (entry.isFile() && entry.name === INDEX_FILE_NAME) {
        out.push(full);
      }
    }),
  );
  return out;
}

/**
 * Walks the workspace once per fixed glob prefix and returns a map from each
 * matched demo `index.ts` absolute path to the first pattern that matched it.
 *
 * Shared by `ensureDemoClients` and `ensureDemoPages` so demo discovery stays
 * consistent between the `requireClient` and `requirePage` validate passes.
 */
export async function findDemoIndexFiles(
  baseDir: string,
  patterns: (string | RegExp)[],
): Promise<Map<string, string | RegExp>> {
  // Map from absolute index.ts path → matching pattern (first wins).
  const results = new Map<string, string | RegExp>();
  // Group patterns by their fixed prefix to share filesystem walks.
  const prefixes = new Map<string, (string | RegExp)[]>();
  for (const pattern of patterns) {
    const prefix = patternBaseDir(pattern, baseDir);
    const existing = prefixes.get(prefix);
    if (existing) {
      existing.push(pattern);
    } else {
      prefixes.set(prefix, [pattern]);
    }
  }

  const compiledPatterns = patterns.map((pattern) => ({
    pattern,
    regex: patternToRegExp(pattern),
  }));

  await Promise.all(
    Array.from(prefixes.keys()).map(async (prefix) => {
      const indexFiles = await collectIndexFiles(prefix);
      for (const filePath of indexFiles) {
        if (results.has(filePath)) {
          continue;
        }
        for (const { pattern, regex } of compiledPatterns) {
          if (regex.test(filePath)) {
            results.set(filePath, pattern);
            break;
          }
        }
      }
    }),
  );

  return results;
}
