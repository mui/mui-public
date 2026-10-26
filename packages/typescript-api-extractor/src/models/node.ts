import { TypeName } from './typeName';
import { ArrayNode } from './types/array';
import { ClassNode } from './types/class';
import { ComponentNode } from './types/component';
import { EnumNode } from './types/enum';
import { ExternalTypeNode } from './types/external';
import { FunctionNode } from './types/function';
import { IntersectionNode } from './types/intersection';
import { IntrinsicNode } from './types/intrinsic';
import { LiteralNode } from './types/literal';
import { ObjectNode } from './types/object';
import { TemplateLiteralNode } from './types/templateLiteral';
import { TupleNode } from './types/tuple';
import { TypeOperatorNode } from './types/typeOperator';
import { TypeParameterNode } from './types/typeParameter';
import { TypeQueryNode } from './types/typeQuery';
import { UnionNode } from './types/union';

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
