/* eslint-disable no-console */
import { execaCommand } from 'execa';
import timers from 'node:timers/promises';
import { parse } from 'node-html-parser';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { Transform } from 'node:stream';
import contentType from 'content-type';

const DEFAULT_CONCURRENCY = 4;

/**
 * Creates a Transform stream that prefixes each line with a given string.
 * Useful for distinguishing server logs from other output.
 * @param {string} prefix - String to prepend to each line
 * @returns {Transform} Transform stream that adds the prefix to each line
 */
const prefixLines = (prefix) => {
  let leftover = '';
  return new Transform({
    transform(chunk, enc, cb) {
      const lines = (leftover + chunk.toString()).split(/\r?\n/);
      leftover = /** @type {string} */ (lines.pop());
      this.push(lines.map((l) => `${prefix + l}\n`).join(''));
      cb();
    },
    flush(cb) {
      if (leftover) {
        this.push(`${prefix + leftover}\n`);
      }
      cb();
    },
  });
};

/**
 * Maps page URLs to sets of known target IDs (anchors) on that page.
 * Used to track which link targets (e.g., #section-id) exist on each page.
 * @typedef {Map<string, Set<string>>} LinkStructure
 */

/**
 * Serialized representation of LinkStructure for JSON storage.
 * Converts Maps and Sets to plain objects and arrays for file persistence.
 * @typedef {Object} SerializedLinkStructure
 * @property {Record<string, string[]>} targets - Object mapping page URLs to arrays of target IDs
 */

/**
 * Fetches a URL and throws an error if the response is not OK.
 * @param {string | URL} url - URL to fetch
 * @returns {Promise<Response>} Fetch response if successful
 * @throws {Error} If the response status is not OK (not in 200-299 range)
 */
async function fetchUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: [${res.status}] ${res.statusText}`);
  }
  return res;
}

/**
 * Polls a URL until it responds successfully or times out.
 * Used to wait for a dev server to start.
 * @param {string} url - URL to poll
 * @param {number} timeout - Maximum milliseconds to wait before timing out
 * @returns {Promise<void>} Resolves when URL responds successfully
 * @throws {Error} If timeout is reached before URL responds
 */
async function pollUrl(url, timeout) {
  const start = Date.now();
  while (true) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fetchUrl(url);
      return;
    } catch (/** @type {any} */ error) {
      if (Date.now() - start > timeout) {
        throw new Error(`Timeout waiting for ${url}: ${error.message}`, { cause: error });
      }
      // eslint-disable-next-line no-await-in-loop
      await timers.setTimeout(1000);
    }
  }
}

/**
 * Converts serialized link structure (from JSON) back to Map/Set form.
 * @param {SerializedLinkStructure} data - Serialized structure with plain objects/arrays
 * @returns {LinkStructure} Deserialized structure using Map and Set
 */
function deserializeLinkStructure(data) {
  const linkStructure = new Map();
  for (const url of Object.keys(data.targets)) {
    linkStructure.set(url, new Set(data.targets[url]));
  }
  return linkStructure;
}

/**
 * Data about a crawled page including its URL, HTTP status, and available link targets.
 * @typedef {Object} PageData
 * @property {string} url - The normalized page URL (without trailing slash unless root)
 * @property {number} status - HTTP status code from the response (e.g., 200, 404, 500)
 * @property {Set<string>} targets - Set of available anchor targets on the page, keyed by hash (e.g., '#intro')
 */

/**
 * Serializes and writes discovered page targets to a JSON file.
 * @param {Map<string, PageData>} pages - Map of crawled pages with their targets
 * @param {string} outPath - File path to write the JSON output
 * @returns {Promise<void>}
 */
async function writePagesToFile(pages, outPath) {
  /** @type {SerializedLinkStructure} */
  const fileContent = { targets: {} };
  for (const [url, pageData] of pages.entries()) {
    fileContent.targets[url] = Array.from(pageData.targets.keys());
  }
  const dir = path.dirname(outPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(fileContent, null, 2), 'utf-8');
}

/**
 * Computes the accessible name of an element according to ARIA rules.
 * Polyfill for `node.computedName` available only in Chrome v112+.
 * Checks in order: aria-label, aria-labelledby, label[for], img alt, innerText.
 * @param {import('node-html-parser').HTMLElement | null} elm - Element to compute name for
 * @param {import('node-html-parser').HTMLElement} ownerDocument - Document containing the element
 * @returns {string} The computed accessible name, or empty string if none found
 */
function getAccessibleName(elm, ownerDocument) {
  if (!elm) {
    return '';
  }

  // 1. aria-label
  const ariaLabel = elm.getAttribute('aria-label')?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  // 2. aria-labelledby
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

  // 3. <label for="id">
  if (elm.id) {
    const label = ownerDocument.querySelector(`label[for="${elm.id}"]`);
    if (label) {
      return getAccessibleName(label, ownerDocument);
    }
  }

  // 4. <img alt="">
  if (elm.tagName === 'IMG') {
    const alt = elm.getAttribute('alt')?.trim();
    if (alt) {
      return alt;
    }
  }

  // 5. Fallback: visible text
  return elm.innerText.trim();
}

/**
 * Generic concurrent task queue with configurable concurrency limit.
 * Processes tasks in FIFO order with a maximum number of concurrent workers.
 * @template T
 */
class Queue {
  /** Array of pending tasks waiting to be processed */
  /** @type {T[]} */
  tasks = [];

  /** Set of currently running task promises */
  /** @type {Set<Promise<void>>} */
  pending = new Set();

  /**
   * Creates a new queue with a worker function and concurrency limit.
   * @param {(task: T) => Promise<void>} worker - Async function to process each task
   * @param {number} concurrency - Maximum number of tasks to run simultaneously
   */
  constructor(worker, concurrency) {
    this.worker = worker;
    this.concurrency = concurrency;
  }

  /**
   * Adds a task to the queue and starts processing if under concurrency limit.
   * @param {T} task - Task to add to the queue
   */
  add(task) {
    this.tasks.push(task);
    this.run();
  }

  async run() {
    while (this.pending.size < this.concurrency && this.tasks.length > 0) {
      const task = /** @type {T} */ (this.tasks.shift());
      const p = this.worker(task).finally(() => {
        this.pending.delete(p);
        this.run();
      });
      this.pending.add(p);
    }
  }

  /**
   * Waits for all pending and queued tasks to complete.
   * @returns {Promise<void>}
   */
  async waitAll() {
    while (this.pending.size > 0) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(this.pending);
    }
  }
}

/**
 * Represents a hyperlink found during crawling.
 * @typedef {Object} Link
 * @property {string | null} src - URL of the page where this link was found, or null for seed URLs
 * @property {string | null} text - Accessible name/text content of the link element, or null for seed URLs
 * @property {string} href - The href attribute value (may be relative or absolute, with or without hash)
 */

/**
 * Extracts and normalizes the page URL from a link href.
 * Returns null for external links, ignored paths, or non-standard URLs.
 * Normalizes by removing trailing slashes (except root) and preserving query params.
 * @param {string} href - Link href to process (e.g., '/docs/api#section?query=1')
 * @param {RegExp[]} ignoredPaths - Array of patterns to exclude
 * @returns {string | null} Normalized page URL with query but without hash, or null if external/ignored
 */
function getPageUrl(href, ignoredPaths = []) {
  if (!href.startsWith('/')) {
    return null;
  }
  const parsed = new URL(href, 'http://localhost');
  if (ignoredPaths.some((pattern) => pattern.test(parsed.pathname))) {
    return null;
  }
  // Normalize pathname by removing trailing slash (except for root)
  let pathname = parsed.pathname;
  if (pathname !== '/' && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  const link = pathname + parsed.search;
  return link;
}

/**
 * Configuration options for the broken links crawler.
 * @typedef {Object} CrawlOptions
 * @property {string | null} [startCommand] - Shell command to start the dev server (e.g., 'npm run dev'). If null, assumes server is already running
 * @property {string} host - Base URL of the site to crawl (e.g., 'http://localhost:3000')
 * @property {string | null} [outPath] - File path to write discovered link targets to. If null, targets are not persisted
 * @property {RegExp[]} [ignoredPaths] - Array of regex patterns to exclude from crawling (e.g., [/^\/api\//] to skip /api/* routes)
 * @property {string[]} [ignoredContent] - CSS selectors for elements whose nested links should be ignored (e.g., ['.sidebar', 'footer'])
 * @property {Set<string>} [ignoredTargets] - Set of element IDs to ignore as link targets (defaults to '__next', '__NEXT_DATA__')
 * @property {Map<string, Set<string>>} [knownTargets] - Pre-populated map of known valid targets to skip crawling (useful for external pages)
 * @property {string[]} [knownTargetsDownloadUrl] - URLs to fetch known targets from (fetched JSON will be merged with knownTargets)
 * @property {number} [concurrency] - Number of concurrent page fetches (defaults to 4)
 * @property {string[]} [seedUrls] - Starting URLs for the crawl (defaults to ['/'])
 */

/**
 * Fully resolved configuration with all optional fields filled with defaults.
 * @typedef {Required<CrawlOptions>} ResolvedCrawlOptions
 */

/**
 * Resolves partial crawl options by filling in defaults for all optional fields.
 * @param {CrawlOptions} rawOptions - Partial options from user
 * @returns {ResolvedCrawlOptions} Fully resolved options with all defaults applied
 */
function resolveOptions(rawOptions) {
  return {
    startCommand: rawOptions.startCommand ?? null,
    host: rawOptions.host,
    outPath: rawOptions.outPath ?? null,
    ignoredPaths: rawOptions.ignoredPaths ?? [],
    ignoredContent: rawOptions.ignoredContent ?? [],
    ignoredTargets: rawOptions.ignoredTargets ?? new Set(['__next', '__NEXT_DATA__']),
    knownTargets: rawOptions.knownTargets ?? new Map(),
    knownTargetsDownloadUrl: rawOptions.knownTargetsDownloadUrl ?? [],
    concurrency: rawOptions.concurrency ?? DEFAULT_CONCURRENCY,
    seedUrls: rawOptions.seedUrls ?? ['/'],
  };
}

/**
 * Merges multiple Maps, similar to Object.assign for objects.
 * Later sources override earlier ones for duplicate keys.
 * @template K, V
 * @param {Map<K, V>} target - Target map to merge into (will be mutated)
 * @param {...Map<K, V>} sources - Source maps to merge from
 * @returns {Map<K, V>} The mutated target map
 */
function mergeMaps(target, ...sources) {
  for (const source of sources) {
    for (const [key, value] of source.entries()) {
      target.set(key, value);
    }
  }
  return target;
}

/**
 * Downloads and deserializes known link targets from remote URLs.
 * Fetches JSON files containing serialized link structures in parallel.
 * @param {string[]} urls - Array of URLs to fetch known targets from
 * @returns {Promise<LinkStructure[]>} Array of deserialized link structures
 */
async function downloadKnownTargets(urls) {
  if (urls.length === 0) {
    return [];
  }

  console.log(chalk.blue(`Downloading known targets from ${urls.length} URL(s)...`));

  const results = await Promise.all(
    urls.map(async (url) => {
      console.log(`  Fetching ${chalk.underline(url)}`);
      const res = await fetchUrl(url);
      const data = await res.json();
      return deserializeLinkStructure(data);
    }),
  );

  return results;
}

/**
 * Resolves all known targets by downloading remote ones and merging with user-provided.
 * User-provided targets take priority over downloaded ones.
 * @param {ResolvedCrawlOptions} options - Resolved crawl options
 * @returns {Promise<LinkStructure>} Merged map of all known targets
 */
async function resolveKnownTargets(options) {
  const downloaded = await downloadKnownTargets(options.knownTargetsDownloadUrl);
  // Merge downloaded with user-provided, user-provided takes priority
  return mergeMaps(new Map(), ...downloaded, options.knownTargets);
}

/**
 * Represents a broken link or broken link target discovered during crawling.
 * @typedef {Object} Issue
 * @property {'broken-link' | 'broken-target'} type - Type of issue: 'broken-link' for 404 pages, 'broken-target' for missing anchors
 * @property {string} message - Human-readable description of the issue (e.g., 'Target not found', 'Page returned error 404')
 * @property {Link} link - The link object that has the issue
 */

/**
 * Results from a complete crawl operation.
 * @typedef {Object} CrawlResult
 * @property {Set<Link>} links - All links discovered during the crawl
 * @property {Map<string, PageData>} pages - All pages crawled, keyed by normalized URL
 * @property {Issue[]} issues - All broken links and broken targets found
 */

/**
 * Reports broken links to stderr, grouped by source page for better readability.
 * @param {Issue[]} issuesList - Array of issues to report
 */
function reportIssues(issuesList) {
  if (issuesList.length === 0) {
    return;
  }

  console.error('\nBroken links found:\n');

  // Group issues by source URL
  /** @type {Map<string, Issue[]>} */
  const issuesBySource = new Map();
  for (const issue of issuesList) {
    const sourceUrl = issue.link.src ?? '(unknown)';
    const sourceIssues = issuesBySource.get(sourceUrl) ?? [];
    if (sourceIssues.length === 0) {
      issuesBySource.set(sourceUrl, sourceIssues);
    }
    sourceIssues.push(issue);
  }

  // Report issues grouped by source
  for (const [sourceUrl, sourceIssues] of issuesBySource.entries()) {
    console.error(`Source ${chalk.cyan(sourceUrl)}:`);
    for (const issue of sourceIssues) {
      const reason = issue.type === 'broken-target' ? 'target not found' : 'returned status 404';
      console.error(`  [${issue.link.text}](${chalk.cyan(issue.link.href)}) (${reason})`);
    }
  }
}

/**
 * Crawls a website starting from seed URLs, discovering all internal links and checking for broken links/targets.
 * @param {CrawlOptions} rawOptions - Configuration options for the crawl
 * @returns {Promise<CrawlResult>} Crawl results including all links, pages, and issues found
 */
export async function crawl(rawOptions) {
  const options = resolveOptions(rawOptions);
  const startTime = Date.now();

  /** @type {import('execa').ResultPromise | undefined} */
  let appProcess;
  if (options.startCommand) {
    console.log(chalk.blue(`Starting server with "${options.startCommand}"...`));
    appProcess = execaCommand(options.startCommand, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        FORCE_COLOR: '1',
        ...process.env,
      },
    });

    // Prefix server logs
    const serverPrefix = chalk.gray('server: ');
    appProcess.stdout?.pipe(prefixLines(serverPrefix)).pipe(process.stdout);
    appProcess.stderr?.pipe(prefixLines(serverPrefix)).pipe(process.stderr);

    await pollUrl(options.host, 10000);

    console.log(`Server started on ${chalk.underline(options.host)}`);
  }

  const knownTargets = await resolveKnownTargets(options);

  /** @type {Map<string, Promise<PageData>>} */
  const crawledPages = new Map();
  /** @type {Set<Link>} */
  const crawledLinks = new Set();

  const queue = new Queue(async (/** @type {Link} */ link) => {
    crawledLinks.add(link);

    const pageUrl = getPageUrl(link.href, options.ignoredPaths);
    if (pageUrl === null) {
      return;
    }

    if (knownTargets.has(pageUrl)) {
      return;
    }

    if (crawledPages.has(pageUrl)) {
      return;
    }

    const pagePromise = Promise.resolve().then(async () => {
      console.log(`Crawling ${chalk.cyan(pageUrl)}...`);
      const res = await fetch(new URL(pageUrl, options.host));

      /** @type {PageData} */
      const pageData = {
        url: pageUrl,
        status: res.status,
        targets: new Set(),
      };

      if (pageData.status < 200 || pageData.status >= 400) {
        console.warn(chalk.yellow(`Warning: ${pageUrl} returned status ${pageData.status}`));
        return pageData;
      }

      const contentTypeHeader = res.headers.get('content-type');
      let type = 'text/html';

      if (contentTypeHeader) {
        try {
          const parsed = contentType.parse(contentTypeHeader);
          type = parsed.type;
        } catch {
          console.warn(
            chalk.yellow(`Warning: ${pageUrl} returned invalid content-type: ${contentTypeHeader}`),
          );
        }
      }

      if (type.startsWith('image/')) {
        // Skip images
        return pageData;
      }

      if (type !== 'text/html') {
        console.warn(chalk.yellow(`Warning: ${pageUrl} returned non-HTML content-type: ${type}`));
        // TODO: Handle text/markdown. Parse content as markdown and extract links/targets.
        return pageData;
      }

      const content = await res.text();

      const dom = parse(content);

      const ignoredSelector = Array.from(options.ignoredContent)
        .flatMap((selector) => [selector, `${selector} *`])
        .join(',');
      const linksSelector = `a[href]:not(${ignoredSelector})`;

      const pageLinks = dom.querySelectorAll(linksSelector).map((a) => ({
        src: pageUrl,
        text: getAccessibleName(a, dom),
        href: a.getAttribute('href') ?? '',
      }));

      for (const target of dom.querySelectorAll('*[id]')) {
        if (!options.ignoredTargets.has(target.id)) {
          pageData.targets.add(`#${target.id}`);
        }
      }

      for (const pageLink of pageLinks) {
        queue.add(pageLink);
      }

      return pageData;
    });

    crawledPages.set(pageUrl, pagePromise);

    await pagePromise;
  }, options.concurrency);

  for (const seedUrl of options.seedUrls) {
    queue.add({ src: null, text: null, href: seedUrl });
  }

  await queue.waitAll();

  if (appProcess) {
    console.log(chalk.blue('Stopping server...'));
    appProcess.kill('SIGKILL');
    await appProcess.catch(() => {});
    console.log(chalk.blue('Server stopped.'));
  }

  const results = new Map(
    await Promise.all(
      Array.from(crawledPages.entries(), async ([a, b]) => /** @type {const} */ ([a, await b])),
    ),
  );

  if (options.outPath) {
    await writePagesToFile(results, options.outPath);
  }

  /** Array to collect all issues found during validation */
  /** @type {Issue[]} */
  const issues = [];

  /**
   * Records a broken link or target issue.
   * @param {Link} link - The link with the issue
   * @param {'broken-target' | 'broken-link'} type - Type of issue
   * @param {string} message - Human-readable error message
   */
  function recordBrokenLink(link, type, message) {
    issues.push({
      type,
      message,
      link,
    });
  }

  for (const crawledLink of crawledLinks) {
    const pageUrl = getPageUrl(crawledLink.href, options.ignoredPaths);
    if (pageUrl !== null) {
      // Internal link
      const parsed = new URL(crawledLink.href, 'http://localhost');

      const knownPage = knownTargets.get(pageUrl);
      if (knownPage) {
        if (parsed.hash && !knownPage.has(parsed.hash)) {
          recordBrokenLink(crawledLink, 'broken-target', 'Target not found');
        } else {
          // all good
        }
      } else {
        const page = results.get(pageUrl);

        if (!page) {
          recordBrokenLink(crawledLink, 'broken-link', 'Page not crawled');
        } else if (page.status >= 400) {
          recordBrokenLink(crawledLink, 'broken-link', `Page returned error ${page.status}`);
        } else if (parsed.hash) {
          if (!page.targets.has(parsed.hash)) {
            recordBrokenLink(crawledLink, 'broken-target', 'Target not found');
          }
        } else {
          // all good
        }
      }
    }
  }

  reportIssues(issues);

  // Derive counts from issues
  const brokenLinks = issues.filter((issue) => issue.type === 'broken-link').length;
  const brokenLinkTargets = issues.filter((issue) => issue.type === 'broken-target').length;

  const endTime = Date.now();
  const durationSeconds = (endTime - startTime) / 1000;
  const duration = new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit: 'second',
    maximumFractionDigits: 2,
  }).format(durationSeconds);
  console.log(chalk.blue(`\nCrawl completed in ${duration}`));
  console.log(`  Total links found: ${chalk.cyan(crawledLinks.size)}`);
  console.log(`  Total broken links: ${chalk.cyan(brokenLinks)}`);
  console.log(`  Total broken link targets: ${chalk.cyan(brokenLinkTargets)}`);
  if (options.outPath) {
    console.log(chalk.blue(`Output written to: ${options.outPath}`));
  }

  return { links: crawledLinks, pages: results, issues };
}
