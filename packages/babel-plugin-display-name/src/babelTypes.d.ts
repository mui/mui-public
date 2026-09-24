// Aliased once so the JSDoc annotations elsewhere can stay short.
import type {
  NodePath as BabelNodePath,
  PluginAPI,
  PluginObject,
  PluginPass,
  types,
} from '@babel/core';

export type { PluginAPI, PluginObject, PluginPass };
export type BabelTypes = typeof types;
export type NodePath<T = types.Node> = BabelNodePath<T>;
export type Node = types.Node;
export type Expression = types.Expression;
export type Statement = types.Statement;
export type CallExpression = types.CallExpression;
export type FunctionExpression = types.FunctionExpression;
export type ArrowFunctionExpression = types.ArrowFunctionExpression;
export type ObjectMethod = types.ObjectMethod;
export type ExpressionStatement = types.ExpressionStatement;
