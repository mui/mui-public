import * as React from 'react';
import type { LazyContentProps } from './types';

/**
 * Server variant of {@link LazyContent}: an async server component that awaits
 * the dynamic import and renders the component. Render it under a Suspense
 * boundary so React streams the `fallback` until the import resolves, then
 * streams the resolved component in. It is a plain async render function (no
 * Node-only imports), so it bundles harmlessly with the client surface - it
 * just never runs there.
 *
 * Readiness is a client-side concern (the swap and gate live on the client), so
 * there is no gate here - `fallback`/`gate` on the shared props are ignored by
 * the server path (the parent Suspense owns the fallback).
 */
export async function LazyContentServer<T extends {} = {}>({
  content,
  props,
}: LazyContentProps<T>): Promise<React.ReactElement> {
  const loaded = await content();
  const Component = loaded.default;
  const componentProps = (props ?? {}) as T;
  return <Component {...componentProps} />;
}
