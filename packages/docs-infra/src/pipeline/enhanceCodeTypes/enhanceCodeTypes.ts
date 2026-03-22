import type { Root as HastRoot, Element } from 'hast';
import { visit } from 'unist-util-visit';
import type { EnhanceOptions } from './enhanceChildren';
import { getLanguageCapabilities } from './getLanguageCapabilities';
import type { LanguageCapabilities } from './getLanguageCapabilities';
import { createScanState } from './scanState';
import type { ModuleLinkMapEntry } from './scanState';
import { enhanceChildren, wrapExpressionNodes } from './enhanceChildren';
import { flushLiteralCandidate, flushPendingExpression } from './processTextNode';

/**
 * Options for the enhanceCodeTypes plugin.
 */
export interface EnhanceCodeTypesOptions {
  /**
   * Platform-scoped anchor maps. Each code element resolves its anchor map based
   * on its language class: JS-family languages use `js`, CSS-family use `css`.
   *
   * Each map maps export names (both flat and dotted) to their anchor hrefs.
   * Examples (within `js`):
   * - `"AccordionTrigger"` → `"#trigger"`
   * - `"Accordion.Trigger"` → `"#trigger"`
   */
  linkMap: {
    /** Anchors for JS-family languages (js, jsx, ts, tsx). */
    js?: Record<string, string>;
    /** Anchors for CSS-family languages (css, scss, less, sass). */
    css?: Record<string, string>;
  };
  /**
   * When set, the plugin emits a custom component element instead of an `<a>` tag
   * for type/export name references.
   * The custom element receives `href` and `name` (the matched identifier) as properties.
   * This is used to render interactive type popovers via a `TypeRef` component.
   */
  typeRefComponent?: string;
  /**
   * When set, the plugin emits a custom component element instead of a plain HTML element
   * for property references within type definitions, object literals, function calls, and JSX.
   *
   * For definition sites (type definitions), the element receives `id` (anchor target).
   * For reference sites (annotations, function calls, JSX), the element receives `href` (link).
   * Both also receive `name` (the owner identifier) and `prop` (kebab-case property path).
   */
  typePropRefComponent?: string;
  /**
   * Opt-in property linking mode.
   * - `'shallow'`: Link only top-level properties of known owners.
   * - `'deep'`: Link nested properties with dotted paths (e.g., `address.street-name`).
   * - `undefined` (default): No property linking (backward compatible).
   */
  linkProps?: 'shallow' | 'deep';
  /**
   * Opt-in function parameter linking.
   * When `true`, links function parameter names (`pl-v` spans inside parentheses)
   * to documentation anchors.
   *
   * At definition sites (type definitions), params produce positional `id` anchors
   * (e.g., `id="callback[0]"`). Named anchors can be provided via `linkMap`
   * (e.g., `linkMap["Callback[0]"]`) to override the positional id.
   * At reference sites (annotations, function calls), params produce positional
   * `href` anchors resolved through `linkMap["Owner[N]"]` named anchors.
   */
  linkParams?: boolean;
  /**
   * When set, the plugin emits a custom component element instead of a plain HTML element
   * for function parameter references.
   *
   * For definition sites, the element receives `id` (anchor target).
   * For reference sites, the element receives `href` (link).
   * Both also receive `name` (the owner identifier) and `param` (parameter name).
   */
  typeParamRefComponent?: string;
  /**
   * Links later uses of identifiers whose type provenance was proven during parse.
   * Conservative and single-pass: only syntactically explicit bindings (`param: Type`,
   * `const x: Type`, `{ a }: Type`) are tracked. Uncertain cases stay unlinked.
   *
   * Variable references (`pl-smi` spans) are resolved against a scope stack and linked
   * to the appropriate type, property, or parameter anchor depending on how the variable
   * was declared. `let`/`const` are block-scoped; `var` and function params are
   * function-scoped (no hoisting — linked only after their declaration).
   */
  linkScope?: boolean;
  /**
   * Opt-in literal value tracking for `const` declarations.
   * When `true`, tracks the literal value of `const x = 'hello'` or
   * `const obj = { key: 'val' }` and annotates later `pl-smi` references
   * with the tracked value.
   *
   * For object shapes, dot-access resolution is supported:
   * `const obj = { a: 'one' }; use(obj.a)` annotates `obj.a` with `'one'`.
   *
   * Requires `linkScope` to be enabled.
   */
  linkValues?: boolean;
  /**
   * Opt-in array literal tracking for `const` declarations.
   * When `true`, tracks the elements of `const arr = ['a', 'b']` and annotates
   * later `pl-smi` references with the tracked array value.
   *
   * Array elements can reference previously tracked variables:
   * `const a = 'x'; const arr = [a, 'y']` annotates `arr` as `['x', 'y']`.
   *
   * Requires `linkScope` to be enabled.
   */
  linkArrays?: boolean;
  /**
   * When set, the plugin emits a custom component element instead of a plain HTML element
   * for literal value references (tracked `const` values).
   *
   * The custom element receives `value` (the literal value string) and `name`
   * (the variable or expression name) as properties.
   */
  typeValueRefComponent?: string;
  /**
   * Platform-scoped module link maps. Each code element resolves its module link
   * map based on its language class, mirroring the `linkMap` scoping.
   *
   * Maps module specifier strings to documentation page links and export metadata.
   * When an import statement references a module in this map, the module specifier
   * string is linked and imported identifiers are registered for downstream linking.
   *
   * Example:
   * ```ts
   * moduleLinkMap: {
   *   js: {
   *     '@mui/internal-docs-infra/pipeline/enhanceCodeTypes': {
   *       href: '/docs-infra/pipeline/enhanceCodeTypes',
   *       exports: {
   *         enhanceCodeTypes: { slug: '#enhance-code-types' },
   *       },
   *     },
   *   },
   * }
   * ```
   */
  moduleLinkMap?: {
    /** Module links for JS-family languages (js, jsx, ts, tsx). */
    js?: Record<string, ModuleLinkMapEntry>;
    /** Module links for CSS-family languages (css, scss, less, sass). */
    css?: Record<string, ModuleLinkMapEntry>;
  };
  /**
   * Global fallback anchor slug for default and namespace imports.
   * Used when the module entry in `moduleLinkMap` does not specify a `defaultSlug`.
   * Example: `'#api-reference'`
   */
  defaultImportSlug?: string;
}

function resolveModuleLinkMap(
  lang: LanguageCapabilities,
  options: EnhanceCodeTypesOptions,
): Record<string, ModuleLinkMapEntry> | undefined {
  if (lang.semantics === 'js') {
    return options.moduleLinkMap?.js;
  }
  if (lang.semantics === 'css') {
    return options.moduleLinkMap?.css;
  }
  return undefined;
}

/**
 * A rehype plugin that links code identifiers and their properties to
 * corresponding type documentation anchors.
 *
 * **Type/export linking** (existing behavior):
 * Transforms `<span class="pl-en">Trigger</span>` → `<a href="#trigger">Trigger</a>`
 * and chains like `Accordion.Trigger` into single anchors.
 *
 * **Property linking** (new, opt-in via `linkProps`):
 * Inside type definitions, object literals, function calls, and JSX components,
 * wraps property names with prop ref elements linked to `#anchor:prop-name`.
 *
 * @param options - Configuration options
 * @returns A unified transformer function
 */
export default function enhanceCodeTypes(options: EnhanceCodeTypesOptions) {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'code') {
        return;
      }
      if (!node.children || node.children.length === 0) {
        return;
      }

      const lang = getLanguageCapabilities(node);
      let linkMap: Record<string, string> = {};
      if (lang.semantics === 'js') {
        linkMap = { ...(options.linkMap.js ?? {}) };
      } else if (lang.semantics === 'css') {
        linkMap = { ...(options.linkMap.css ?? {}) };
      }
      const enhanceOptions: EnhanceOptions = {
        linkMap,
        typeRefComponent: options.typeRefComponent,
        typePropRefComponent: options.typePropRefComponent,
        typeParamRefComponent: options.typeParamRefComponent,
        typeValueRefComponent: options.typeValueRefComponent,
        linkProps: options.linkProps,
        linkParams: options.linkParams,
        linkScope: options.linkScope,
        linkValues: options.linkValues,
        linkArrays: options.linkArrays,
        moduleLinkMap: resolveModuleLinkMap(lang, options),
        defaultImportSlug: options.defaultImportSlug,
        lang,
      };

      const state = createScanState();

      // Initialize top-level function scope for scope tracking
      if (options.linkScope) {
        state.scopeStack.push({ bindings: new Map(), kind: 'function' });
      }

      node.children = enhanceChildren(node.children, enhanceOptions, state);

      // Flush any pending literal candidate or expression at the end of the
      // entire code block. This is done here (not inside processTextNode) so
      // that multiline expressions split across separate text nodes aren't
      // committed early.
      if (options.linkScope) {
        flushLiteralCandidate(state);
        const exprResult = flushPendingExpression(state);
        if (exprResult) {
          state.lastFlushedExpression = exprResult;
          wrapExpressionNodes(node.children, state, enhanceOptions);
        }
      }
    });
  };
}
