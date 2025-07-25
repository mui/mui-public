import type { PluginObj } from '@babel/core';

declare const plugin: (...args: any[]) => PluginObj<any>;
export default plugin;
