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
 * @param {string} prefix
 * @returns {Transform}
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
 * Maps pageUrl to ids of known targets on that page
 * @typedef {Map<string, Set<string>>} LinkStructure
 */

/**
 * @typedef {Object} SerializedLinkStructure
 * @property {Record<string, string[]>} targets
 */

/**
 * @param {string | URL} url
 * @returns {Promise<Response>}
 */
async function fetchUrl(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: [${res.status}] ${res.statusText}`);
  }
  return res;
}

/**
 * @param {string} url
 * @param {number} timeout
 * @returns {Promise<void>}
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
 * @param {SerializedLinkStructure} data
 * @returns {LinkStructure}
 */
function deserializeLinkStructure(data) {
  const linkStructure = new Map();
  for (const url of Object.keys(data.targets)) {
    linkStructure.set(url, new Set(data.targets[url]));
  }
  return linkStructure;
}

/**
 * @typedef {Object} LinkTarget
 */

/**
 * @typedef {Object} PageData
 * @property {string} url
 * @property {number} status
 * @property {Map<string, LinkTarget>} targets
 */

/**
 * @param {Map<string, PageData>} pages
 * @param {string} outPath
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
 * Polyfill for `node.computedName` available only in chrome v112+
 * @param {import('node-html-parser').HTMLElement | null} elm
 * @param {import('node-html-parser').HTMLElement} ownerDocument
 * @returns {string}
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
 * @template T
 */
class Queue {
  /** @type {T[]} */
  tasks = [];

  /** @type {Set<Promise<void>>} */
  pending = new Set();

  /**
   * @param {(task: T) => Promise<void>} worker
   * @param {number} concurrency
   */
  constructor(worker, concurrency) {
    this.worker = worker;
    this.concurrency = concurrency;
  }

  /**
   * @param {T} task
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

  async waitAll() {
    while (this.pending.size > 0) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(this.pending);
    }
  }
}

/**
 * @typedef {Object} Link
 * @property {string | null} src
 * @property {string | null} text
 * @property {string} href
 */

/**
 * @param {string} href
 * @param {RegExp[]} ignoredPaths
 * @returns {string | null}
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
 * @typedef {Object} CrawlOptions
 * @property {string | null} [startCommand]
 * @property {string} host
 * @property {string | null} [outPath]
 * @property {RegExp[]} [ignoredPaths]
 * @property {string[]} [ignoredContent]
 * @property {Set<string>} [ignoredTargets]
 * @property {Map<string, Set<string>>} [knownTargets]
 * @property {string[]} [knownTargetsDownloadUrl]
 * @property {number} [concurrency]
 * @property {string[]} [seedUrls]
 */

/**
 * @typedef {Required<CrawlOptions>} ResolvedCrawlOptions
 */

/**
 * @param {CrawlOptions} rawOptions
 * @returns {ResolvedCrawlOptions}
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
 * Merge multiple maps, similar to `Object.assign`
 * @template K, V
 * @param {Map<K, V>} target
 * @param {...Map<K, V>} sources
 * @returns {Map<K, V>}
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
 * @param {string[]} urls
 * @returns {Promise<LinkStructure[]>}
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
 * @param {ResolvedCrawlOptions} options
 * @returns {Promise<LinkStructure>}
 */
async function resolveKnownTargets(options) {
  const downloaded = await downloadKnownTargets(options.knownTargetsDownloadUrl);
  // Merge downloaded with user-provided, user-provided takes priority
  return mergeMaps(new Map(), ...downloaded, options.knownTargets);
}

/**
 * @typedef {Object} Issue
 * @property {'broken-link' | 'broken-target'} type
 * @property {string} message
 * @property {Link} link
 */

/**
 * @typedef {Object} CrawlResult
 * @property {Set<Link>} links
 * @property {Map<string, PageData>} pages
 * @property {Issue[]} issues
 */

/**
 * Report broken links grouped by source page
 * @param {Issue[]} issuesList
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
 * @param {CrawlOptions} rawOptions
 * @returns {Promise<CrawlResult>}
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

      const urlData = { url: pageUrl, status: res.status };

      if (urlData.status < 200 || urlData.status >= 400) {
        console.warn(chalk.yellow(`Warning: ${pageUrl} returned status ${urlData.status}`));

        return {
          url: pageUrl,
          status: res.status,
          targets: new Map(),
        };
      }

      // Check if the response is HTML
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
        return {
          url: pageUrl,
          status: res.status,
          targets: new Map(),
        };
      }

      if (type !== 'text/html') {
        console.warn(chalk.yellow(`Warning: ${pageUrl} returned non-HTML content-type: ${type}`));

        // TODO: Handle text/markdown. Parse content as markdown and extract links/targets.

        return {
          url: pageUrl,
          status: res.status,
          targets: new Map(),
        };
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

      const pageTargets = new Map(
        dom
          .querySelectorAll('*[id]')
          .filter((elm) => !options.ignoredTargets.has(elm.id))
          .map((elm) => [`#${elm.id}`, {}]),
      );

      for (const pageLink of pageLinks) {
        queue.add(pageLink);
      }

      return {
        url: pageUrl,
        status: res.status,
        targets: pageTargets,
      };
    });

    crawledPages.set(pageUrl, pagePromise);

    await pagePromise;
  }, options.concurrency);

  for (const seedUrl of options.seedUrls) {
    queue.add({ src: null, text: null, href: seedUrl });
  }

  await queue.waitAll();

  if (appProcess) {
    appProcess.kill();
    await appProcess.catch(() => {});
  }

  const results = new Map(
    await Promise.all(
      Array.from(crawledPages.entries(), async ([a, b]) => /** @type {const} */ ([a, await b])),
    ),
  );

  if (options.outPath) {
    await writePagesToFile(results, options.outPath);
  }

  /**
   * @typedef {Object} BrokenLinkError
   * @property {Link} link
   * @property {string} reason
   */

  /** @type {Issue[]} */
  const issues = [];

  /**
   * @param {Link} link
   * @param {'broken-target' | 'broken-link'} type
   * @param {string} message
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
