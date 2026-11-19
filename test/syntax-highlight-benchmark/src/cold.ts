import { loadCorpus } from './corpus';
import { ENGINE_LOADERS } from './engines';

/**
 * Child-process entry: measures a fresh process's import + init + first
 * highlight, then the peak RSS after highlighting the whole corpus.
 */
const engineKey = process.argv[2];
const corpus = loadCorpus();
const snippet = corpus[0];
const rssBefore = process.memoryUsage().rss;

const start = performance.now();
const engine = await ENGINE_LOADERS[engineKey]();
await engine.init();
const initMs = performance.now() - start;
engine.highlight(snippet.source, snippet.language);
const firstHighlightMs = performance.now() - start - initMs;

for (const sample of corpus) {
  engine.highlight(sample.source, sample.language);
}

process.stdout.write(
  JSON.stringify({
    initMs,
    firstHighlightMs,
    baselineRssMiB: rssBefore / 2 ** 20,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
  }),
);
