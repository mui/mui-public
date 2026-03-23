import * as React from 'react';
import type { Externals } from '../CodeHighlighter/types';
import { CodeExternalsContext } from '../CodeExternalsContext';

type DefaultController = React.ComponentType<{ children: React.ReactNode }>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type ControllerProps<C extends DefaultController> = Simplify<
  Omit<React.ComponentProps<C>, 'children'>
>;

export type CreateDemoClientMeta<C extends DefaultController> = {
  name?: string;
  slug?: string;
  displayName?: string;
  variantType?: string;
  skipPrecompute?: boolean;
  precompute?: { externals?: Externals; [key: string]: any };
  controllerProps?: ControllerProps<C>;
  [key: string]: any;
};

type AbstractCreateDemoClientOptions<C extends DefaultController> = {
  DemoController: C;
  [key: string]: any;
};

/**
 * Abstract factory function for creating demo client providers.
 * This creates a provider component that supplies externals to child components.
 *
 * @param options Configuration options for the demo client factory
 * @returns A function that creates demo client providers
 */
export function abstractCreateDemoClient<C extends DefaultController>(
  options: AbstractCreateDemoClientOptions<C>,
  url: string,
  meta?: CreateDemoClientMeta<C>,
): React.ComponentType<{ children: React.ReactNode }> {
  // Extract externals from precomputed data
  const externals = meta?.precompute?.externals || {};
  const context = { externals };
  const { DemoController } = options;
  const controllerProps = meta?.controllerProps;

  function ClientProvider({ children }: { children: React.ReactNode }) {
    if (controllerProps != null) {
      return (
        <CodeExternalsContext.Provider value={context}>
          {React.createElement(DemoController, Object.assign({}, controllerProps, { children }))}
        </CodeExternalsContext.Provider>
      );
    }
    return (
      <CodeExternalsContext.Provider value={context}>
        {React.createElement(DemoController, Object.assign({}, { children }))}
      </CodeExternalsContext.Provider>
    );
  }

  if (process.env.NODE_ENV !== 'production') {
    ClientProvider.displayName = `ClientProvider(${meta?.name || 'Demo'})`;
  }

  return Object.assign(ClientProvider, {
    clientMeta: {
      url,
      options,
      meta,
      externals,
    },
  });
}

export function createDemoClientFactory<C extends DefaultController>(
  options: AbstractCreateDemoClientOptions<C>,
) {
  /**
   * Creates a demo client provider with precomputed externals.
   * @param url Depends on `import.meta.url` to determine the source file location.
   * @param meta Additional meta and configuration for the demo client.
   */
  const createDemoClient = (url: string, meta?: CreateDemoClientMeta<C>) => {
    return abstractCreateDemoClient(options, url, meta);
  };

  return createDemoClient;
}
