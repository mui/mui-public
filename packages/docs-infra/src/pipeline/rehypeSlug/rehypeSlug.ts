/**
 * Custom rehype-slug plugin that handles ID deduplication with demo Title components.
 *
 * Standard `rehype-slug` only sees native heading elements in the HAST at compile time.
 * Demo Title components (from `abstractCreateDemo`) render `<h3 id={slug}>` at React
 * runtime, which `rehype-slug` can't see. This causes duplicate IDs when an MDX heading
 * has the same text as a demo title.
 *
 * This plugin extends `rehype-slug` by:
 * 1. Scanning MDX import declarations for demo imports (`./demos/*`)
 * 2. Extracting demo slugs from the import paths
 * 3. Pre-seeding GithubSlugger with those slugs
 * 4. Processing headings with the seeded slugger (producing `-1` suffixes for duplicates)
 */

import type { Root, Element, ElementContent } from 'hast';
import GithubSlugger from 'github-slugger';
import { headingRank } from 'hast-util-heading-rank';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';

interface Options {
  prefix?: string;
}

// Matches: import { ... } from './demos/some-name'  or  './demos/some-name/...'
const DEMO_IMPORT_RE = /from\s+['"]\.\/demos\/([^/'"\s]+)/g;

/**
 * Extracts demo directory slugs from MDX ESM import declarations.
 * Demo imports follow the pattern: `import { Demo... } from './demos/<slug>'`
 */
function extractDemoSlugs(tree: Root): string[] {
  const slugs: string[] = [];

  visit(tree, (node: any) => {
    if (node.type === 'mdxjsEsm' && typeof node.value === 'string') {
      let match: RegExpExecArray | null;
      DEMO_IMPORT_RE.lastIndex = 0;
      while ((match = DEMO_IMPORT_RE.exec(node.value)) !== null) {
        slugs.push(match[1]);
      }
    }
  });

  return slugs;
}

export default function rehypeSlug(options?: Options | null) {
  const prefix = options?.prefix ?? '';

  return function (tree: Root) {
    const slugger = new GithubSlugger();

    // Pre-seed the slugger with demo slugs so that MDX headings with the
    // same text get deduplicated (e.g. "tab-navigation" → "tab-navigation-1")
    const demoSlugs = extractDemoSlugs(tree);
    for (const slug of demoSlugs) {
      slugger.slug(slug);
    }

    visit(tree, 'element', function (node: Element) {
      if (headingRank(node) && !node.properties.id) {
        node.properties.id = prefix + slugger.slug(toString(node));
      }
    });
  };
}
