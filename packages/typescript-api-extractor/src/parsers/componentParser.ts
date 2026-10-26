import {
	CallSignature,
	ComponentNode,
	ExportNode,
	FunctionNode,
	IntrinsicNode,
	PropertyNode,
	ObjectNode,
	UnionNode,
	IntersectionNode,
	TypeParameterNode,
	typeEquivalenceChecker,
	type AnyType,
} from '../models';
import { TypeName } from '../models/typeName';
import { ParserContext } from '../parser';

// The names React uses for what a component renders. Detection goes by name
// rather than by node kind: the same return type surfaces as an ExternalTypeNode
// when external types are summarized and as an object or union when
// `includeExternalTypes` expands them, so the kind says nothing about whether
// the type is React's. Names match exactly, which keeps unrelated types that
// merely end in `Element` - a local `ListElement`, or the DOM's `HTMLElement` -
// from turning every function returning one into a component.
const componentReturnTypeNames = new Set(['Element', 'ReactElement', 'ReactNode']);

type ComponentExportNode = ExportNode & { type: FunctionNode | UnionNode };

function isReactReturnType(type: AnyType): boolean {
	const typeName = 'typeName' in type ? type.typeName : undefined;
	if (typeName && componentReturnTypeNames.has(typeName.name)) {
		return true;
	}

	// Return types like `JSX.Element | null` describe a component through one of
	// their members.
	return type instanceof UnionNode && type.types.some(isReactReturnType);
}

/**
 * Rewrites an export into a ComponentNode when it looks like a React component
 * (see `isComponentExport`), squashing the props parameter of every call
 * signature into one merged prop list. Non-component exports pass through.
 */
export function transformComponentExport(node: ExportNode, context: ParserContext): ExportNode {
	const componentFunctions = getComponentFunctions(node);
	if (!componentFunctions) {
		return node;
	}

	return node.withType(createComponentNode(node.type, componentFunctions, context));
}

/**
 * Heuristic for whether an export is a React component: its name is capitalized
 * (or `default`) and its type is a function returning something React-node-like,
 * or a union of such functions.
 */
export function isComponentExport(node: ExportNode): node is ComponentExportNode {
	return getComponentFunctions(node) !== undefined;
}

function isComponentExportName(name: string): boolean {
	return /^[A-Z]/.test(name) || name === 'default';
}

/**
 * Collects the function nodes holding a component's call signatures, or returns
 * undefined when the export is not a component.
 */
function getComponentFunctions(node: ExportNode): FunctionNode[] | undefined {
	if (!isComponentExportName(node.name)) {
		return undefined;
	}

	return collectComponentFunctions(node.type);
}

function collectComponentFunctions(type: AnyType): FunctionNode[] | undefined {
	if (type instanceof FunctionNode) {
		return hasReactNodeLikeReturnType(type) ? [type] : undefined;
	}

	// A component can surface as a union of function types rather than a single
	// one - for instance when a polymorphic component declares a separate arm per
	// `render` prop form. Treat it as one component only when every arm is itself
	// component-like, so unions that merely happen to contain a component (say
	// `Button | undefined`) keep their union shape.
	if (type instanceof UnionNode) {
		const componentFunctions: FunctionNode[] = [];
		for (const member of type.types) {
			const memberFunctions = collectComponentFunctions(member);
			if (!memberFunctions) {
				return undefined;
			}

			componentFunctions.push(...memberFunctions);
		}

		return componentFunctions.length > 0 ? componentFunctions : undefined;
	}

	return undefined;
}

function createComponentNode(
	type: AnyType,
	componentFunctions: FunctionNode[],
	context: ParserContext,
): ComponentNode {
	// Arms of a union describe the same component under different prop forms, so
	// their signatures squash together into one prop list. Props missing from some
	// arms come out optional, which is what `squashComponentProps` already does
	// for overloads.
	const callSignatures = componentFunctions.flatMap((fn) => fn.callSignatures);

	return new ComponentNode(
		cloneTypeName(getComponentTypeName(type, componentFunctions)),
		squashComponentProps(callSignatures, context),
		getSharedTypeParameters(callSignatures),
	);
}

/**
 * The props of every signature are merged into one list, so the type parameters
 * they refer to only describe the component when every signature declares the
 * same ones. When signatures disagree, no single list is correct for the merged
 * props and none is reported.
 */
function getSharedTypeParameters(callSignatures: CallSignature[]): TypeParameterNode[] | undefined {
	const typeParameters = callSignatures[0]?.typeParameters;
	if (!typeParameters) {
		return undefined;
	}

	const allSignaturesAgree = callSignatures.every((signature) => {
		const signatureTypeParameters = signature.typeParameters ?? [];
		return (
			typeParameters.every(
				(typeParameter, index) => typeParameter.name === signatureTypeParameters[index]?.name,
			) &&
			typeEquivalenceChecker.areTypeParameterListsEquivalentStrictly(
				typeParameters,
				signatureTypeParameters,
			)
		);
	});

	return allSignaturesAgree ? typeParameters : undefined;
}

/**
 * An aliased union names the component directly. An unaliased one only gets a
 * name when every arm agrees on it, because no single arm's name describes the
 * merged result.
 */
function getComponentTypeName(
	type: AnyType,
	componentFunctions: FunctionNode[],
): TypeName | undefined {
	const ownTypeName = 'typeName' in type ? type.typeName : undefined;
	if (ownTypeName) {
		return ownTypeName;
	}

	const [firstFunction, ...remainingFunctions] = componentFunctions;
	const firstTypeName = firstFunction?.typeName;
	if (!firstTypeName) {
		return undefined;
	}

	return remainingFunctions.every((fn) => fn.typeName?.toString() === firstTypeName.toString())
		? firstTypeName
		: undefined;
}

function cloneTypeName(typeName: TypeName | undefined): TypeName | undefined {
	if (!typeName) {
		return undefined;
	}

	return new TypeName(typeName.name, typeName.namespaces, typeName.typeArguments);
}

function hasReactNodeLikeReturnType(type: FunctionNode) {
	return type.callSignatures.some((signature) => isReactReturnType(signature.returnValueType));
}

function squashComponentProps(callSignatures: CallSignature[], context: ParserContext) {
	// squash props
	// { variant: 'a', href: string } | { variant: 'b' }
	// to
	// { variant: 'a' | 'b', href?: string }
	const props: Map<string, PropertyNode> = new Map<string, PropertyNode>();
	const usedPropsPerSignature: Set<string>[] = [];

	const propsFromCallSignatures = callSignatures
		.map((signature) => {
			const propsParameter = signature.parameters[0];
			if (!propsParameter) {
				return undefined;
			}

			if (propsParameter.type instanceof ObjectNode) {
				return propsParameter.type;
			}

			if (propsParameter.type instanceof UnionNode) {
				const ut = unwrapUnionType(propsParameter.type);
				return ut;
			}

			if (propsParameter.type instanceof IntersectionNode) {
				return propsParameter.type.types.filter((type) => type instanceof ObjectNode);
			}
		})
		.flat()
		.filter((t) => !!t);

	propsFromCallSignatures.forEach((propsObject) => {
		const usedProps: Set<string> = new Set();

		propsObject.properties.forEach((propNode) => {
			usedProps.add(propNode.name);

			// Check if a prop with a given name has already been encountered.
			const existingPropNode = props.get(propNode.name);
			if (existingPropNode === undefined) {
				// If not, we can just add it.
				props.set(propNode.name, propNode);
			} else {
				// If it has, we need to merge the types in a union.
				// If both prop objects define the prop with the same type, the UnionNode constructor will deduplicate them.
				const mergedPropType = new UnionNode(undefined, [existingPropNode.type, propNode.type]);

				// If the current prop is optional, the whole union will be optional.
				const mergedPropNode = new PropertyNode(
					existingPropNode.name,
					mergedPropType.types.length === 1 ? mergedPropType.types[0] : mergedPropType,
					existingPropNode.documentation,
					existingPropNode.optional || propNode.optional,
				);

				props.set(propNode.name, mergedPropNode);
			}
		});

		usedPropsPerSignature.push(usedProps);
	});

	// A signature that takes no props at all uses none of the props gathered above, so it
	// contributes an empty set. It is dropped from `propsFromCallSignatures` (there is no
	// props parameter to read a shape from), and without this the props of the remaining
	// signatures would stay required even though one form of the component rejects them.
	for (const signature of callSignatures) {
		if (signature.parameters.length === 0) {
			usedPropsPerSignature.push(new Set());
		}
	}

	// If a prop is used in some signatures, but not in others, we need to mark it as optional.
	return [...props.entries()].map(([name, property]) => {
		const onlyUsedInSomeSignatures = usedPropsPerSignature.some((props) => !props.has(name));
		if (onlyUsedInSomeSignatures) {
			return markPropertyAsOptional(property, context);
		}

		return property;
	});
}

function unwrapUnionType(type: UnionNode): (ObjectNode | IntersectionNode)[] {
	return type.types
		.map((type) => {
			if (type instanceof ObjectNode || type instanceof IntersectionNode) {
				return type;
			} else if (type instanceof UnionNode) {
				return unwrapUnionType(type);
			}
		})
		.flat()
		.filter((t) => !!t);
}

function markPropertyAsOptional(property: PropertyNode, context: ParserContext) {
	const canBeUndefined =
		property.type instanceof UnionNode &&
		property.type.types.some(
			(type) => type instanceof IntrinsicNode && type.intrinsic === 'undefined',
		);

	const { compilerOptions } = context;
	if (!canBeUndefined && !compilerOptions.exactOptionalPropertyTypes) {
		const newType = new UnionNode(undefined, [property.type, new IntrinsicNode('undefined')]);
		return new PropertyNode(property.name, newType, property.documentation, true);
	}

	return new PropertyNode(property.name, property.type, property.documentation, true);
}
