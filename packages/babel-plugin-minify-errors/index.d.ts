import type { PluginObject, PluginPass, types as BabelTypes } from '@babel/core';

export interface Options {
  errorCodesPath?: string;
  runtimeModule?: string;
  detection?: 'opt-in' | 'opt-out';
  outExtension?: string;
  collectErrors?: Set<string | Error>;
}

declare function plugin(
  babel: { types: typeof BabelTypes },
  options: Options,
): PluginObject<PluginPass>;

export default plugin;
