// Babel 8 is ESM-only, so a CommonJS file has to request its types under the `import`
// condition. Do it once here so the JSDoc annotations elsewhere can stay short.
import type {
  NodePath as BabelNodePath,
  PluginAPI,
  PluginObject,
  PluginPass,
  types,
} from '@babel/core' with { 'resolution-mode': 'import' };

export type { PluginAPI, PluginObject, PluginPass };
export type BabelTypes = typeof types;
export type NodePath<T = types.Node> = BabelNodePath<T>;
export type Node = types.Node;
export type Expression = types.Expression;
export type BinaryExpression = types.BinaryExpression;
export type NewExpression = types.NewExpression;
export type ArgumentPlaceholder = types.ArgumentPlaceholder;
export type SpreadElement = types.SpreadElement;
