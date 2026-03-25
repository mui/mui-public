import { workerData, parentPort } from 'node:worker_threads';
import { parse } from 'node-html-parser';
import contentType from 'content-type';
import { HtmlValidate, StaticConfigLoader, staticResolver } from 'html-validate';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';

/** @type {import('./index.mjs').CrawlWorkerInput} */
const { pageUrl, options } = workerData;

/**
 * Posts the crawl result back to the parent thread.
 * @param {import('./index.mjs').CrawlWorkerOutput} output
 */
function postResult(output) {
  if (!parentPort) {
    throw new Error('crawlWorker must be run as a worker thread');
  }
  parentPort.postMessage(output);
}

/**
 * Computes the accessible name of an element according to ARIA rules.
 * @param {import('node-html-parser').HTMLElement | null} elm
 * @param {import('node-html-parser').HTMLElement} ownerDocument
 * @returns {string}
 */
function getAccessibleName(elm, ownerDocument) {
  if (!elm) {
    return '';
  }

  const ariaLabel = elm.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledby = elm.getAttribute('aria-labelledby');
  if (labelledby) {
    const labels = [];
    for (const id of labelledby.split(/\s+/)) {
      const label = getAccessibleName(ownerDocument.getElementById(id), ownerDocument);
      if (label) {
        labels.push(label);
      }
    }
    const label = labels.join(' ').trim();
    if (label) {
      return label;
    }
  }

  if (elm.id) {
    const label = ownerDocument.querySelector(`label[for="${elm.id}"]`);
    if (label) {
      return getAccessibleName(label, ownerDocument);
    }
  }

  if (elm.tagName === 'IMG') {
    const alt = elm.getAttribute('alt')?.trim();
    if (alt) {
      return alt;
    }
  }

  return elm.innerText.trim();
}

/**
 * Converts markdown content to HTML using unified pipeline.
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function markdownToHtml(markdown) {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeStringify)
    .process(markdown);
  return String(result);
}

const res = await fetch(new URL(pageUrl, options.host));

const contentTypeHeader = res.headers.get('content-type');
let type = 'text/html';

if (contentTypeHeader) {
  try {
    const parsed = contentType.parse(contentTypeHeader);
    type = parsed.type;
  } catch {
    // invalid content-type, default to text/html
  }
}

/** @type {import('./index.mjs').CrawlWorkerPageData} */
const pageData = {
  url: pageUrl,
  status: res.status,
  targets: [],
  contentType: type,
};

if (pageData.status < 200 || pageData.status >= 400) {
  postResult({ pageData, links: [], htmlValidateResults: null });
} else if (type.startsWith('image/') || (type !== 'text/html' && type !== 'text/markdown')) {
  postResult({ pageData, links: [], htmlValidateResults: null });
} else {
  const rawContent = await res.text();

  const content = type === 'text/markdown' ? await markdownToHtml(rawContent) : rawContent;

  const dom = parse(content, { parseNoneClosedTags: true });

  // Extract targets
  for (const target of dom.querySelectorAll('*[id]')) {
    if (!options.ignoredTargets.has(target.id)) {
      pageData.targets.push(`#${target.id}`);
    }
  }

  // Extract links
  let ignoredSelector = ':not(*)';
  if (options.ignoredContent.length > 0) {
    ignoredSelector = Array.from(options.ignoredContent)
      .flatMap((selector) => [selector, `${selector} *`])
      .join(',');
  }
  const linksSelector = `a[href]:not(${ignoredSelector})`;

  const links = dom.querySelectorAll(linksSelector).map((a) => ({
    src: pageUrl,
    text: getAccessibleName(a, dom),
    href: a.getAttribute('href') ?? '',
    contentType: type,
  }));

  // HTML validation
  let htmlValidateResults = null;
  if (options.htmlValidate && type === 'text/html') {
    const muiHtmlValidateResolver = staticResolver({
      configs: {
        'mui:recommended': {
          extends: ['html-validate:standard', 'html-validate:document', 'html-validate:browser'],
        },
      },
    });

    const htmlValidator = new HtmlValidate(
      new StaticConfigLoader([muiHtmlValidateResolver], options.htmlValidate),
    );

    const report = await htmlValidator.validateString(rawContent, pageUrl);
    if (!report.valid) {
      htmlValidateResults = { pageUrl, results: report.results };
    }
  }

  postResult({ pageData, links, htmlValidateResults });
}
