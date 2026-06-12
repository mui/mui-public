/**
 * Per-scope grammar loaders. Each entry dynamically imports a single
 * `@wooorm/starry-night` grammar module, so the bundler emits one chunk per
 * grammar instead of the all-in-one `./grammars` barrel. `ensureGrammars`
 * (in `./parseSource`) resolves only the scopes a block needs, keeping the
 * unused grammar payloads (~146&nbsp;KB gzip for all 10) out of the download.
 *
 * Keys are starry-night scope names — the same values `./grammarMaps` resolves
 * file extensions and language props to, so every detectable language has a
 * loader (asserted in the tests).
 */
import type { Grammar } from '@wooorm/starry-night';

export type GrammarLoader = () => Promise<Grammar>;

export const grammarLoaders: Record<string, GrammarLoader> = {
  'source.js': () => import('@wooorm/starry-night/source.js').then((mod) => mod.default),
  'source.ts': () => import('@wooorm/starry-night/source.ts').then((mod) => mod.default),
  'source.tsx': () => import('@wooorm/starry-night/source.tsx').then((mod) => mod.default),
  'source.json': () => import('@wooorm/starry-night/source.json').then((mod) => mod.default),
  'text.md': () => import('@wooorm/starry-night/text.md').then((mod) => mod.default),
  'source.mdx': () => import('@wooorm/starry-night/source.mdx').then((mod) => mod.default),
  'text.html.basic': () =>
    import('@wooorm/starry-night/text.html.basic').then((mod) => mod.default),
  'source.css': () => import('@wooorm/starry-night/source.css').then((mod) => mod.default),
  'source.shell': () => import('@wooorm/starry-night/source.shell').then((mod) => mod.default),
  'source.yaml': () => import('@wooorm/starry-night/source.yaml').then((mod) => mod.default),
};
