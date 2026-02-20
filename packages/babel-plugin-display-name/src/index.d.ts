import type { PluginObj } from '@babel/core';

interface AllowedCallees {
  [moduleName: string]: string[];
}

export interface PluginOptions {
  allowedCallees?: AllowedCallees;
}

declare const plugin: (options?: PluginOptions) => PluginObj;

export default plugin;
