import type { Plugin } from 'unified';
import type { Root } from 'mdast';

export interface TransformMarkdownDemosOptions {
  /** Number of demos per page whose deferred sources should be preloaded. */
  preloadSources?: number;
}

const DEMO_IMPORT_PATTERN = /(^|\/)demos\/[^/]+$/;

interface JsxAttribute {
  type: string;
  name?: string;
  value?: unknown;
}

interface JsxElementNode {
  type: string;
  name?: string | null;
  attributes?: JsxAttribute[];
  children?: JsxElementNode[];
  data?: {
    estree?: {
      body?: Array<{
        type: string;
        source?: { value?: unknown };
        specifiers?: Array<{ local?: { name?: string } }>;
      }>;
    };
  };
}

function collectDemoImportNames(tree: Root): Set<string> {
  const names = new Set<string>();
  for (const node of tree.children as unknown as JsxElementNode[]) {
    if (node.type !== 'mdxjsEsm') {
      continue;
    }
    for (const statement of node.data?.estree?.body ?? []) {
      if (
        statement.type !== 'ImportDeclaration' ||
        !DEMO_IMPORT_PATTERN.test(String(statement.source?.value ?? ''))
      ) {
        continue;
      }
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.local?.name) {
          names.add(specifier.local.name);
        }
      }
    }
  }
  return names;
}

function visitJsxElements(
  node: JsxElementNode,
  onElement: (element: JsxElementNode) => void,
): void {
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    onElement(node);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      visitJsxElements(child, onElement);
    }
  }
}

/** Marks the first N imported demo elements with `preloadSources`. */
const transformMarkdownDemos: Plugin<[TransformMarkdownDemosOptions?], Root> = (options = {}) => {
  const { preloadSources = 0 } = options;
  return function transform(tree) {
    if (preloadSources <= 0) {
      return;
    }
    const demoNames = collectDemoImportNames(tree);
    if (demoNames.size === 0) {
      return;
    }
    let remaining = preloadSources;
    visitJsxElements(tree as unknown as JsxElementNode, (element) => {
      if (remaining <= 0 || !element.name || !demoNames.has(element.name)) {
        return;
      }
      remaining -= 1;
      const attributes = element.attributes ?? (element.attributes = []);
      if (attributes.some((attribute) => attribute.name === 'preloadSources')) {
        return;
      }
      attributes.push({ type: 'mdxJsxAttribute', name: 'preloadSources', value: null });
    });
  };
};

export default transformMarkdownDemos;
