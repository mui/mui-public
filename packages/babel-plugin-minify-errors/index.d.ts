import type { PluginObj, PluginPass } from '@babel/core';

export interface Options {
  errorCodesPath?: string;
  runtimeModule?: string;
  detection?: 'opt-in' | 'opt-out';
  outExtension?: string;
  collectErrors?: Set<string | Error>;
}

declare function plugin(
  babel: { types: typeof import('@babel/core').types },
  options: Options,
): PluginObj<PluginPass>;

export default plugin;
