import { Documentation } from './documentation';
import { AnyType } from './node';

/**
 * Information about an extended type.
 */
export interface ExtendsTypeInfo {
	/** The name as written in the source code, e.g., "Dialog.Props" */
	name: string;
	/** The resolved symbol name if different from the written name, e.g., "DialogProps" */
	resolvedName?: string;
}

/**
 * Which of TypeScript's declaration spaces an export occupies.
 */
export interface DeclarationSpaces {
	/**
	 * Whether the export occupies the value declaration space.
	 *
	 * For example, `export const x = 'x'`, functions, classes, and enums are
	 * values, while `export type X = 'x'` and lone interfaces are not. Merged
	 * declarations such as `interface X {}` + `const X: X` are values. A
	 * type-only re-export (`export type { X }`, `export type * from '...'`)
	 * never occupies the value space, whatever it refers to. Note that `const
	 * enum` members are inlined by default (`preserveConstEnums: false`), so a
	 * value export does not guarantee a runtime binding in the emitted output.
	 */
	readonly isValue: boolean;
	/**
	 * Whether the export occupies the type declaration space, i.e. names a type.
	 *
	 * For example, type aliases, interfaces, classes, and enums are types,
	 * while `export const x = 'x'` and plain functions are not.
	 */
	readonly isType: boolean;
	/**
	 * Whether the export declares a namespace or module.
	 *
	 * For example, `export namespace N {}`, possibly merged with a function or
	 * class of the same name. A namespace containing only types is neither a
	 * value nor a type, only a namespace. Expando assignments
	 * (`fn.extra = ...`) do not make an export a namespace.
	 */
	readonly isNamespace: boolean;
}

export class ExportNode implements DeclarationSpaces {
	/** See {@link DeclarationSpaces.isValue}. */
	public readonly isValue: boolean;
	/** See {@link DeclarationSpaces.isType}. */
	public readonly isType: boolean;
	/** See {@link DeclarationSpaces.isNamespace}. */
	public readonly isNamespace: boolean;

	constructor(
		public name: string,
		public type: AnyType,
		public documentation: Documentation | undefined,
		declarationSpaces: DeclarationSpaces,
		/**
		 * The full original name when this export is a re-export with a different name.
		 *
		 * For example, `export { DialogTrigger as Trigger }` would have
		 * `reexportedFrom: "DialogTrigger"`. This allows consumers to build
		 * a map of re-exports for type compatibility tracking.
		 */
		public reexportedFrom?: string,
		/**
		 * The type(s) this export explicitly extends.
		 *
		 * For example, `interface AlertDialogRootProps extends Dialog.Props`
		 * would have `extendsTypes: [{ name: "Dialog.Props", resolvedName: "DialogProps" }]`.
		 * This allows consumers to track type compatibility for inherited components.
		 */
		public extendsTypes?: ExtendsTypeInfo[],
	) {
		this.isValue = declarationSpaces.isValue;
		this.isType = declarationSpaces.isType;
		this.isNamespace = declarationSpaces.isNamespace;
	}

	withType(type: AnyType): ExportNode {
		return new ExportNode(
			this.name,
			type,
			this.documentation,
			this,
			this.reexportedFrom,
			this.extendsTypes,
		);
	}

	/**
	 * Whether the export is public.
	 * Exports are considered public if they are not explicitly marked as private or internal.
	 *
	 * @param requireExplicitAnnotation Whether the export must have an explicit visibility annotation to be considered public.
	 */
	isPublic(requireExplicitAnnotation = false): boolean {
		if (requireExplicitAnnotation) {
			return this.documentation?.visibility === 'public';
		}

		return (
			this.documentation?.visibility !== 'private' && this.documentation?.visibility !== 'internal'
		);
	}
}
