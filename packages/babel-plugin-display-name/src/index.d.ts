import type { PluginAPI, PluginObject } from '@babel/core';

interface AllowedCallees {
  [moduleName: string]: string[];
}

export interface PluginOptions {
  allowedCallees?: AllowedCallees;
}

declare const plugin: (api: PluginAPI, options: PluginOptions, dirname: string) => PluginObject;

export default plugin;
