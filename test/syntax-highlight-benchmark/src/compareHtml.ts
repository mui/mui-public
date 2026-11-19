import { toHtml } from 'hast-util-to-html';
import type { Engine } from './engine';
import type { Sample } from './corpus';
import { toCategoryHast } from './hast';

const PREVIEW_LINES = 120;

const STYLE = `
body { font-family: system-ui, sans-serif; margin: 16px; background: #fff; color: #24292f; }
h2 { font-size: 16px; margin-top: 32px; }
.row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 12px; }
.row h3 { font-size: 13px; margin: 0 0 4px; }
pre { font-size: 12px; line-height: 1.45; border: 1px solid #d0d7de; border-radius: 6px; padding: 8px; overflow: auto; max-height: 640px; margin: 0; }
.legend span { display: inline-block; margin-right: 12px; font-family: monospace; font-size: 12px; }
.c-comment { color: #6e7781; font-style: italic; }
.c-string { color: #0a3069; }
.c-keyword { color: #cf222e; }
.c-number { color: #0550ae; font-weight: 600; }
.c-constant { color: #0550ae; }
.c-function { color: #8250df; }
.c-type { color: #953800; }
.c-tag { color: #116329; font-weight: 600; }
.c-attribute { color: #6639ba; }
.c-property { color: #0969da; }
.c-variable { color: #953800; font-style: italic; }
.c-punctuation { color: #57606a; }
.c-markup { color: #1f6feb; font-weight: 600; }
.c-inserted { background: #dafbe1; color: #116329; }
.c-deleted { background: #ffebe9; color: #82071e; }
.c-other { text-decoration: underline dotted; }
`;

const LEGEND = [
  'comment',
  'string',
  'keyword',
  'number',
  'constant',
  'function',
  'type',
  'tag',
  'attribute',
  'property',
  'variable',
  'punctuation',
  'markup',
  'inserted',
  'deleted',
  'other',
];

function escape(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
}

/**
 * Renders every sample once per engine with one shared palette, keyed by
 * category rather than by engine-specific class, so highlighting quality can be
 * compared by eye. Hover a token to see the engine's own class.
 */
export function renderComparison(engines: Engine[], samples: Sample[]): string {
  const sections = samples.map((sample) => {
    const source = sample.source.split('\n').slice(0, PREVIEW_LINES).join('\n');
    const columns = engines.map((engine) => {
      const html = toHtml(
        toCategoryHast(
          engine.highlight(source, sample.language),
          engine.categorize,
          sample.language,
        ),
      );
      return `<div><h3>${escape(engine.name)} ${escape(engine.version)}</h3><pre><code>${html}</code></pre></div>`;
    });
    return `<h2>${escape(sample.id)} <small>${escape(sample.path)}</small></h2><div class="row">${columns.join('')}</div>`;
  });
  const legend = LEGEND.map((category) => `<span class="c-${category}">${category}</span>`).join(
    '',
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Syntax highlighting comparison</title><style>${STYLE}</style></head><body><h1>Syntax highlighting comparison</h1><p>First ${PREVIEW_LINES} lines of each sample. Colors show the shared category each engine's token maps to; hover for the engine's own class.</p><p class="legend">${legend}</p>${sections.join('')}</body></html>`;
}
