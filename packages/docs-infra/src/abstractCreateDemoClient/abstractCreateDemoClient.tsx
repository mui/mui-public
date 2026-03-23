import * as React from 'react';
import type { Externals } from '../CodeHighlighter/types';
import { CodeExternalsContext } from '../CodeExternalsContext';

export type CreateDemoClientMeta = {
  name?: string;
  slug?: string;
  displayName?: string;
  variantType?: string;
  skipPrecompute?: boolean;
  precompute?: { externals?: Externals; [key: string]: any };
  [key: string]: any;
};

type AbstractCreateDemoClientOptions = {
  live?: boolean;
  [key: string]: any;
};

/**
 * Abstract factory function for creating demo client providers.
 * This creates a provider component that supplies externals to child components.
 *
 * @param options Configuration options for the demo client factory
 * @returns A function that creates demo client providers
 */
export function abstractCreateDemoClient(
  options: AbstractCreateDemoClientOptions,
  url: string,
  meta?: CreateDemoClientMeta,
): React.ComponentType<{ children: React.ReactNode }> {
  // Extract externals from precomputed data
  const externals = meta?.precompute?.externals || {};
  const context = { externals };

  // Create a provider component that makes externals available to children
  function ClientProvider({ children }: { children: React.ReactNode }) {
    // In a real implementation, this would provide the externals via context
    // For now, just render children - the externals are already injected as imports
    return (
      <CodeExternalsContext.Provider value={context}>{children}</CodeExternalsContext.Provider>
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    ClientProvider.displayName = `ClientProvider(${meta?.name || 'Demo'})`;
  }

  // Attach metadata to the provider for debugging/inspection
  (ClientProvider as any).clientMeta = {
    url,
    options,
    meta,
    externals,
  };

  return ClientProvider;
}

export function createDemoClientFactory(options: AbstractCreateDemoClientOptions) {
  /**
   * Creates a demo client provider for live editing with precomputed externals.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param meta Additional meta and configuration for the demo client.
   */
  const createDemoClient = (url: string, meta?: CreateDemoClientMeta) => {
    return abstractCreateDemoClient(options, url, meta);
  };

  return createDemoClient;
}
