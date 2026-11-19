import { loadCorpus } from './corpus';
import { BASELINE_ENGINE, ENGINE_LOADERS } from './engines';
import { categorizeChars } from './hast';

/**
 * Lists the text runs where an engine's categories differ from the baseline's,
 * largest first: `pnpm benchmark:disagreements <engine> <language> [limit]`.
 */
const [engineKey, language, limit = '30'] = process.argv.slice(2);
const [baseline, engine] = await Promise.all([
  ENGINE_LOADERS[BASELINE_ENGINE](),
  ENGINE_LOADERS[engineKey](),
]);
await Promise.all([baseline.init(), engine.init()]);

const isWhitespace = (char: string) => char.trim() === '';
const counts = new Map<string, number>();
for (const sample of loadCorpus().filter((candidate) => candidate.language === language)) {
  const expected = categorizeChars(
    baseline.highlight(sample.source, sample.language),
    baseline.categorize,
    sample.language,
  );
  const actual = categorizeChars(
    engine.highlight(sample.source, sample.language),
    engine.categorize,
    sample.language,
  );
  let start = 0;
  while (start < sample.source.length) {
    if (expected[start] === actual[start] || isWhitespace(sample.source[start])) {
      start += 1;
      continue;
    }
    let end = start;
    while (
      end < sample.source.length &&
      expected[end] === expected[start] &&
      actual[end] === actual[start] &&
      !isWhitespace(sample.source[end])
    ) {
      end += 1;
    }
    const key = `${expected[start]} → ${actual[start]}  ${JSON.stringify(sample.source.slice(start, end).slice(0, 40))}`;
    counts.set(key, (counts.get(key) ?? 0) + end - start);
    start = end;
  }
}
const lines = [...counts]
  .sort((left, right) => right[1] - left[1])
  .slice(0, Number(limit))
  .map(([key, count]) => `${String(count).padStart(6)}  ${key}`);
process.stdout.write(`${lines.join('\n')}\n`);
