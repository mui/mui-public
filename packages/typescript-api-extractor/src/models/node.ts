import type { TypeName } from './typeName';
import type { ArrayNode } from './types/array';
import type { ClassNode } from './types/class';
import type { ComponentNode } from './types/component';
import type { EnumNode } from './types/enum';
import type { ExternalTypeNode } from './types/external';
import type { FunctionNode } from './types/function';
import type { IntersectionNode } from './types/intersection';
import type { IntrinsicNode } from './types/intrinsic';
import type { LiteralNode } from './types/literal';
import type { ObjectNode } from './types/object';
import type { TemplateLiteralNode } from './types/templateLiteral';
import type { TupleNode } from './types/tuple';
import type { TypeOperatorNode } from './types/typeOperator';
import type { TypeParameterNode } from './types/typeParameter';
import type { TypeQueryNode } from './types/typeQuery';
import type { UnionNode } from './types/union';

export interface TypeNode {
  readonly kind: string;
  typeName: TypeName | undefined;
}

export type AnyType =
  | ArrayNode
  | ClassNode
  | ComponentNode
  | EnumNode
  | ExternalTypeNode
  | FunctionNode
  | IntersectionNode
  | IntrinsicNode
  | LiteralNode
  | ObjectNode
  | TemplateLiteralNode
  | TupleNode
  | TypeOperatorNode
  | TypeParameterNode
  | TypeQueryNode
  | UnionNode;

/**
 * Returns a copy of a type node with a different typeName. Cloning through the
 * prototype preserves the node's already-resolved (and canonicalized) shape,
 * which calling the constructor again would recompute. This lives in the model
 * layer so parser code can re-label a node without reaching into its internals.
 */
export function withTypeName<T extends AnyType>(node: T, typeName: TypeName): T {
  return Object.assign(Object.create(Object.getPrototypeOf(node) as object), node, {
    typeName,
  }) as T;
}
