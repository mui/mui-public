import { TypeNode } from '../node';
import { TypeName } from '../typeName';

/**
 * Where an external type is declared.
 *
 * - `lib`: TypeScript's default library, with the library files that declare
 *   the type (for example `['lib.dom.d.ts']`).
 * - `package`: an npm package, named after its directory under `node_modules`
 *   (for example `'@types/react'`).
 */
export type ExternalTypeSource =
	{ kind: 'lib'; files: readonly string[] } | { kind: 'package'; name: string };

export class ExternalTypeNode implements TypeNode {
	readonly kind = 'external';
	typeName: TypeName;
	source: ExternalTypeSource | undefined;

	constructor(typeName: TypeName, source?: ExternalTypeSource) {
		this.typeName = typeName;
		this.source = source;
	}

	toString(): string {
		return this.typeName.toString();
	}
}
