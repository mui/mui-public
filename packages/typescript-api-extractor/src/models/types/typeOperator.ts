import { type AnyType, type TypeNode } from '../node';
import { type TypeName } from '../typeName';

/** TypeScript operators whose authored syntax is preserved in the output model. */
export type TypeOperator = 'keyof';

/** Provenance of a checker-resolved type-operator result. */
export type TypeOperatorResolutionKind = 'exact' | 'baseConstraint' | 'fallback';

/** Authored type-operator syntax with an optional checker-resolved result. */
export class TypeOperatorNode implements TypeNode {
	/** Stable model discriminator. */
	readonly kind = 'typeOperator';
	/** Optional public alias name for the complete operator. */
	readonly typeName: TypeName | undefined;
	/** Authored TypeScript operator. */
	readonly operator: TypeOperator;
	/** Authored operand of the operator. */
	readonly type: AnyType;
	/** Checker-resolved result, omitted from syntax-only output. */
	declare readonly resolvedType?: AnyType;
	/** Provenance of `resolvedType`, omitted from syntax-only output. */
	declare readonly resolutionKind?: TypeOperatorResolutionKind;

	/**
	 * Creates a preserved type operator.
	 *
	 * @param typeName - Optional public alias name for the complete operator.
	 * @param operator - Authored TypeScript operator.
	 * @param type - Authored operator operand.
	 * @param resolvedType - Checker-resolved operator result, omitted in syntax-only output.
	 * @param resolutionKind - Provenance of `resolvedType`; defaults to `exact` for compatibility.
	 */
	constructor(typeName: TypeName | undefined, operator: TypeOperator, type: AnyType);
	constructor(
		typeName: TypeName | undefined,
		operator: TypeOperator,
		type: AnyType,
		resolvedType: AnyType,
	);
	constructor(
		typeName: TypeName | undefined,
		operator: TypeOperator,
		type: AnyType,
		resolvedType: AnyType,
		resolutionKind: TypeOperatorResolutionKind,
	);
	constructor(
		typeName: TypeName | undefined,
		operator: TypeOperator,
		type: AnyType,
		resolvedType?: AnyType,
		resolutionKind?: TypeOperatorResolutionKind,
	) {
		if (resolvedType === undefined && resolutionKind !== undefined) {
			throw new TypeError('resolutionKind requires resolvedType');
		}

		this.typeName = typeName?.name ? typeName : undefined;
		this.operator = operator;
		this.type = type;
		if (resolvedType) {
			this.resolvedType = resolvedType;
			this.resolutionKind = resolutionKind ?? 'exact';
		}
	}

	/** @returns The authored operator expression or its public alias name. */
	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		const renderedType = this.type.toString();
		const operand = this.type.kind === 'function' ? `(${renderedType})` : renderedType;
		return `${this.operator} ${operand}`;
	}
}
