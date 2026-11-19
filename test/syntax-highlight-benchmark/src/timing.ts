import { loadCorpus } from './corpus';
import { ENGINE_LOADERS } from './engines';
import { measure } from './measure';

/**
 * Child-process entry, so engines do not share a heap or JIT state. Measures a
 * fresh import + init + first highlight, the peak RSS after highlighting the
 * whole corpus once, then the warm time per sample.
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
const peakRssMiB = process.resourceUsage().maxRSS / 1024;

const warm = Object.fromEntries(
  corpus.map((sample) => [
    sample.id,
    measure(() => engine.highlight(sample.source, sample.language)).medianMs,
  ]),
);

process.stdout.write(
  JSON.stringify({
    initMs,
    firstHighlightMs,
    rssGrowthMiB: peakRssMiB - rssBefore / 2 ** 20,
    warm,
  }),
);
