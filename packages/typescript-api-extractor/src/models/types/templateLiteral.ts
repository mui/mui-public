import { type AnyType, type TypeNode } from '../node';
import { type TypeName } from '../typeName';

/** Template literal type, such as `` `${number}px` ``, with its placeholders resolved. */
export class TemplateLiteralNode implements TypeNode {
	/** Stable model discriminator. */
	readonly kind = 'templateLiteral';
	/** Optional public alias name for the complete template literal. */
	readonly typeName: TypeName | undefined;
	/** Literal text around the placeholders; always one entry longer than `types`. */
	readonly texts: readonly string[];
	/** Placeholder types in source order. */
	readonly types: readonly AnyType[];

	/**
	 * Creates an extracted template literal type.
	 *
	 * @param typeName - Optional public alias name for the complete template literal.
	 * @param texts - Literal text before, between, and after the placeholders.
	 * @param types - Placeholder types in source order.
	 */
	constructor(typeName: TypeName | undefined, texts: readonly string[], types: readonly AnyType[]) {
		if (texts.length !== types.length + 1) {
			throw new TypeError('A template literal needs exactly one more text than placeholder types');
		}

		this.typeName = typeName?.name ? typeName : undefined;
		this.texts = texts;
		this.types = types;
	}

	/** @returns The public alias or the rendered template literal syntax. */
	toString(): string {
		if (this.typeName) {
			return this.typeName.toString();
		}

		const placeholdersWithFollowingText = this.types
			.map((type, index) => `\${${type.toString()}}${escapeTemplateText(this.texts[index + 1])}`)
			.join('');
		return `\`${escapeTemplateText(this.texts[0])}${placeholdersWithFollowingText}\``;
	}
}

// Escapes the characters that would otherwise end the template, start a placeholder or an escape,
// or be read back as a line feed, matching how TypeScript prints template literal types.
function escapeTemplateText(text: string): string {
	return text.replace(/\\|`|\$\{|\r/g, (match) => (match === '\r' ? '\\r' : `\\${match}`));
}
