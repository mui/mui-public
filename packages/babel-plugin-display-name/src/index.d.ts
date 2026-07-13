import type { PluginTarget } from '@babel/core';

interface AllowedCallees {
  [moduleName: string]: string[];
}

export interface PluginOptions {
  allowedCallees?: AllowedCallees;
}

declare const plugin: PluginTarget<PluginOptions>;

export default plugin;
