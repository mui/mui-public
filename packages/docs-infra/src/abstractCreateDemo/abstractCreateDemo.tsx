import * as React from 'react';
import { CodeHighlighter } from '../CodeHighlighter';
import {
  applyUrlPrefixToCode,
  applyUrlPrefixToGlobalsCode,
  replaceUrlPrefix,
} from '../pipeline/loaderUtils/applyUrlPrefix';
import type { UrlPrefix } from '../pipeline/loaderUtils/applyUrlPrefix';
import type {
  Code,
  CodeHighlighterProps,
  Components,
  ContentLoadingProps,
  ContentProps,
  LoadCodeMeta,
  LoadSource,
  LoadVariantMeta,
  ParseSource,
  SourceEnhancers,
} from '../CodeHighlighter/types';
import { createDemoDataWithVariants } from '../createDemoData';
import type { DemoGlobalData } from '../createDemoData/types';
import { resolveDemoFlag } from './resolveDemoFlag';

/**
 * Render-time display controls accepted on a generated demo component and in
 * `createDemo(..., meta)`. Each pair cascades instance → meta → factory, with
 * the "off" flag overriding the "on" flag at its layer.
 */
type DemoControlProps = {
  /** Collapse the code block to an empty window (hidden until expanded). */
  collapseToEmpty?: boolean;
  /** Opt out of a `collapseToEmpty` default, collapsing to the focus window. */
  showCollapsedFocus?: boolean;
  /** Start the (collapsible) code block expanded. */
  initialExpanded?: boolean;
  /** Opt out of an `initialExpanded` default, starting collapsed. */
  initialCollapsed?: boolean;
};

type CreateDemoMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  variantType?: string;
  skipPrecompute?: boolean;
  highlightAfter?: CodeHighlighterProps<{}>['highlightAfter'];
  enhanceAfter?: CodeHighlighterProps<{}>['enhanceAfter'];
  editActivation?: CodeHighlighterProps<{}>['editActivation'];
  precompute?: Code;
  ClientProvider?: React.ComponentType<{ children: React.ReactNode }>;
  /**
   * Render this demo "collapse to empty": the code block collapses to an empty
   * window (whole block hidden until expanded). Mirrors the demo component's
   * `collapseToEmpty` prop, and sets the default for `<Demo>` renders.
   */
  collapseToEmpty?: boolean;
  /**
   * Opt this demo out of a factory `collapseToEmpty` default, collapsing to the
   * focus window instead. Mirrors the demo component's `showCollapsedFocus` prop.
   */
  showCollapsedFocus?: boolean;
  /**
   * Whether this demo's (collapsible) code block starts expanded. Mirrors the
   * demo component's `initialExpanded` prop, and sets the default for `<Demo>`
   * renders.
   */
  initialExpanded?: boolean;
  /**
   * Opt this demo out of a factory `initialExpanded` default, starting
   * collapsed instead. Mirrors the demo component's `initialCollapsed` prop.
   */
  initialCollapsed?: boolean;
};

type AbstractCreateDemoOptions<T extends {}> = {
  DemoContent: React.ComponentType<ContentProps<T>>;
  DemoContentLoading?: React.ComponentType<ContentLoadingProps<T>>;
  DemoTitle?: React.ComponentType<{ slug?: string; children?: string }>;
  controlled?: boolean;
  demoGlobalData?: DemoGlobalData[];
  variantTypes?: Record<string, string>;
  highlightAfter?: CodeHighlighterProps<{}>['highlightAfter'];
  enhanceAfter?: CodeHighlighterProps<{}>['enhanceAfter'];
  editActivation?: CodeHighlighterProps<{}>['editActivation'];
  fallbackUsesExtraFiles?: boolean;
  fallbackUsesAllVariants?: boolean;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
  sourceParser?: Promise<ParseSource>;
  sourceEnhancers?: SourceEnhancers;
  /**
   * Default every demo from this factory to "collapse to empty": the code block
   * collapses to an empty window (hidden until expanded). Individual demos opt
   * out with `meta.showCollapsedFocus` / `meta.collapseToEmpty: false`, or per
   * render with `<Demo showCollapsedFocus />`.
   */
  collapseToEmpty?: boolean;
  /**
   * Default every demo from this factory to start expanded. Individual demos
   * override with `meta.initialExpanded: false` or `<Demo initialExpanded={false} />`.
   */
  initialExpanded?: boolean;
  /**
   * `file://` URL of the project root used to resolve `url`s gathered from
   * `import.meta.url`. Combined with `projectUrl` to rewrite local `file://`
   * URLs into hosted Git URLs (e.g.
   * `https://github.com/owner/repo/tree/<branch>/`) before they reach the
   * `CodeHighlighter`.
   *
   * Typically read from an environment variable populated by the build
   * pipeline (e.g. `process.env.SOURCE_CODE_ROOT_DIR` from
   * `withDeploymentConfig`). When either `projectDir` or `projectUrl` is
   * missing, URLs are left untouched.
   */
  projectDir?: string;
  /**
   * Public URL prefix that maps to `projectDir`. See `projectDir` for
   * details.
   */
  projectUrl?: string;
};

export function abstractCreateDemo<T extends {}>(
  options: AbstractCreateDemoOptions<T>,
  url: string,
  variants: { [key: string]: React.ComponentType },
  meta: CreateDemoMeta | undefined,
): React.ComponentType<
  T & {
    collapseToEmpty?: boolean;
    showCollapsedFocus?: boolean;
    initialExpanded?: boolean;
    initialCollapsed?: boolean;
  }
> & {
  Title: React.ComponentType;
} {
  const demoData = createDemoDataWithVariants(url, variants, meta);

  const variantType =
    options.variantTypes && options.variantTypes[Object.keys(variants).sort().join(':')];

  const globalCode: Array<Code | string> = [];
  if (options.demoGlobalData) {
    options.demoGlobalData.forEach((data) => {
      globalCode.push(data.precompute || data.url);
    });
  }

  // Apply urlPrefix once at factory build time so the rewritten values are
  // captured by the closures below (and shared across renders) instead of
  // being recomputed on every render inside `DemoComponent`.
  //
  // The top-level `url` is only rewritten when the variant is fully loaded
  // (i.e. a `precompute` is present). Without a precompute, this `url` is
  // forwarded to `loadSource` at runtime, which expects the original
  // `file://` URL it can read from disk — rewriting here would turn it into
  // a hosted `https://` URL and cause `loadSource` to fail. In that case
  // the `urlPrefix` prop on `<CodeHighlighter>` (forwarded into
  // `loadIsomorphicCodeVariant`) takes care of rewriting the loaded variant after the
  // file is read.
  const urlPrefix = resolveUrlPrefix(options.projectDir, options.projectUrl);
  const resolvedUrl =
    urlPrefix && demoData.precompute
      ? (replaceUrlPrefix(demoData.url, urlPrefix) ?? demoData.url)
      : demoData.url;
  const resolvedPrecompute =
    urlPrefix && demoData.precompute
      ? applyUrlPrefixToCode(demoData.precompute, urlPrefix)
      : demoData.precompute;
  const resolvedGlobalCode =
    urlPrefix && globalCode.length > 0
      ? applyUrlPrefixToGlobalsCode(globalCode, urlPrefix)
      : globalCode;

  function DemoComponent(props: T & DemoControlProps) {
    const renderedComponents = Object.entries(demoData.components).reduce(
      (acc, [key, Component]) => {
        acc[key] = React.createElement(Component);
        return acc;
      },
      {} as Components,
    );

    // Pull the render-time display controls off the demo props so they don't
    // leak into the demo component's own props, then resolve their effective
    // values (instance → meta → factory). Each pair is an on/off cascade.
    const {
      collapseToEmpty: instanceCollapseToEmpty,
      showCollapsedFocus: instanceShowCollapsedFocus,
      initialExpanded: instanceInitialExpanded,
      initialCollapsed: instanceInitialCollapsed,
      ...restProps
    } = props;
    const collapseToEmpty = resolveDemoFlag(
      [
        { on: instanceCollapseToEmpty, off: instanceShowCollapsedFocus },
        { on: meta?.collapseToEmpty, off: meta?.showCollapsedFocus },
      ],
      options.collapseToEmpty,
    );
    const initialExpanded = resolveDemoFlag(
      [
        { on: instanceInitialExpanded, off: instanceInitialCollapsed },
        { on: meta?.initialExpanded, off: meta?.initialCollapsed },
      ],
      options.initialExpanded,
    );

    const highlighter = (
      <CodeHighlighter
        url={resolvedUrl}
        name={demoData.name}
        slug={demoData.slug}
        variantType={meta?.variantType || variantType}
        precompute={resolvedPrecompute}
        globalsCode={resolvedGlobalCode}
        components={renderedComponents}
        contentProps={restProps as T}
        collapseToEmpty={collapseToEmpty}
        initialExpanded={initialExpanded}
        Content={options.DemoContent}
        ContentLoading={options.DemoContentLoading}
        loadCodeMeta={options.loadCodeMeta}
        loadVariantMeta={options.loadVariantMeta}
        loadSource={options.loadSource}
        sourceParser={options.sourceParser}
        sourceEnhancers={options.sourceEnhancers}
        urlPrefix={urlPrefix}
        highlightAfter={meta?.highlightAfter || options.highlightAfter}
        enhanceAfter={meta?.enhanceAfter || options.enhanceAfter}
        editActivation={meta?.editActivation || options.editActivation}
        controlled={options.controlled}
        fallbackUsesExtraFiles={options.fallbackUsesExtraFiles}
        fallbackUsesAllVariants={options.fallbackUsesAllVariants}
      />
    );

    // Use client provider if available
    const ClientProvider = meta?.ClientProvider;
    const rendered = ClientProvider ? <ClientProvider>{highlighter}</ClientProvider> : highlighter;

    // Tag every demo's rendered root with the `demo` class so tooling (e2e
    // tests, screenshots) can target a demo in isolation from page chrome,
    // without each standalone demo `page.tsx` having to add the wrapper.
    return <div className="demo">{rendered}</div>;
  }

  function Title() {
    if (options.DemoTitle) {
      return <options.DemoTitle slug={demoData.slug}>{demoData.name}</options.DemoTitle>;
    }

    return <h3 id={demoData.slug}>{demoData.name}</h3>;
  }
  DemoComponent.Title = Title as React.ComponentType;

  if (process.env.NODE_ENV !== 'production') {
    DemoComponent.displayName = demoData.displayName;
    DemoComponent.Title.displayName = `${demoData.displayName}Title`;
  }

  return DemoComponent;
}

function resolveUrlPrefix(
  projectDir: string | undefined,
  projectUrl: string | undefined,
): UrlPrefix | undefined {
  if (!projectDir || !projectUrl) {
    return undefined;
  }
  const from = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
  const to = projectUrl.endsWith('/') ? projectUrl : `${projectUrl}/`;
  return { from, to };
}

export function createDemoFactory<T extends {}>(options: AbstractCreateDemoOptions<T>) {
  /**
   * Creates a demo component for displaying code examples with syntax highlighting.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param component The component to be rendered in the demo.
   * @param meta Additional meta for the demo.
   */
  const createDemo = (url: string, component: React.ComponentType, meta?: CreateDemoMeta) => {
    return abstractCreateDemo(
      options,
      url,
      { Default: component }, // precomputed code will use the 'Default' key
      meta,
    );
  };

  return createDemo;
}

export function createDemoWithVariantsFactory<T extends {}>(options: AbstractCreateDemoOptions<T>) {
  /**
   * Creates a demo component for displaying code examples with syntax highlighting.
   * A variant is a different implementation style of the same component.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param variants The variants of the component to be rendered in the demo.
   * @param meta Additional meta for the demo.
   */
  const createDemoWithVariants = (
    url: string,
    variants: Record<string, React.ComponentType>,
    meta?: CreateDemoMeta,
  ) => {
    return abstractCreateDemo(options, url, variants, meta);
  };

  return createDemoWithVariants;
}
