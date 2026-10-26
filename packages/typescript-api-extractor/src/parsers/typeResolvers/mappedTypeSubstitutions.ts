import ts from 'typescript';

// Instantiated mapped types carry their type-parameter bindings on a private
// `mapper` field that TypeScript does not expose publicly. This module isolates
// the defensive probing of that internal shape so the object resolver can ask
// for "what is T bound to here?" without depending on the mapper layout itself.
// If the internal shape changes, callers simply observe no substitutions.

type TypeMapperLike = {
	source?: ts.Type;
	target?: ts.Type;
	sources?: readonly ts.Type[];
	targets?: readonly ts.Type[];
	mapper1?: unknown;
	mapper2?: unknown;
};

/**
 * Collects the type-parameter bindings of an instantiated mapped type by walking
 * its (internal) mapper. Returns an empty map when no bindings can be recovered.
 */
export function getMappedTypeParameterSubstitutions(type: ts.Type): Map<ts.Symbol, ts.Type> {
	const substitutions = new Map<ts.Symbol, ts.Type>();
	const seen = new WeakSet<object>();
	collectTypeParameterSubstitutions((type as { mapper?: unknown }).mapper, substitutions, seen);
	return substitutions;
}

/**
 * Reads the original mapped key retained on a generated property's internal
 * symbol links. Remapped properties have no declaration and expose only their
 * public name through stable APIs, so this optional probe is the sole way to
 * distinguish `getLeft` from the authored key `left`. Callers fall back when
 * TypeScript changes or omits this private metadata.
 *
 * @param property - Generated mapped property whose original key is needed.
 * @returns The retained semantic key type, or `undefined` when unavailable.
 */
export function getMappedPropertyKeyType(property: ts.Symbol): ts.Type | undefined {
	const keyType = (property as { links?: { keyType?: unknown } }).links?.keyType;
	return isType(keyType) ? keyType : undefined;
}

/**
 * Resolves a type parameter through the collected substitutions, following
 * chains while guarding against self-references and cycles.
 */
export function substituteTypeParameter(
	type: ts.Type,
	substitutions: Map<ts.Symbol, ts.Type>,
	seen: Set<ts.Symbol> = new Set(),
): ts.Type {
	if (!(type.flags & ts.TypeFlags.TypeParameter)) {
		return type;
	}

	const substitution = type.symbol ? substitutions.get(type.symbol) : undefined;
	if (
		!substitution ||
		substitution === type ||
		(substitution.flags & ts.TypeFlags.TypeParameter && substitution.symbol === type.symbol)
	) {
		return type;
	}
	if (type.symbol && seen.has(type.symbol)) {
		return type;
	}
	if (type.symbol) {
		seen.add(type.symbol);
	}

	return substituteTypeParameter(substitution, substitutions, seen);
}

function collectTypeParameterSubstitutions(
	mapper: unknown,
	substitutions: Map<ts.Symbol, ts.Type>,
	seen: WeakSet<object>,
): void {
	if (!mapper || typeof mapper !== 'object' || seen.has(mapper)) {
		return;
	}
	seen.add(mapper);

	const mapperLike = mapper as TypeMapperLike;
	if (isType(mapperLike.source) && isType(mapperLike.target)) {
		addTypeParameterSubstitution(mapperLike.source, mapperLike.target, substitutions);
	}

	if (mapperLike.sources && mapperLike.targets) {
		for (let index = 0; index < mapperLike.sources.length; index += 1) {
			const source = mapperLike.sources[index];
			const target = mapperLike.targets[index];
			if (isType(source) && isType(target)) {
				addTypeParameterSubstitution(source, target, substitutions);
			}
		}
	}

	collectTypeParameterSubstitutions(mapperLike.mapper1, substitutions, seen);
	collectTypeParameterSubstitutions(mapperLike.mapper2, substitutions, seen);
}

function isType(value: unknown): value is ts.Type {
	return Boolean(value && typeof value === 'object' && 'flags' in value);
}

function addTypeParameterSubstitution(
	source: ts.Type,
	target: ts.Type,
	substitutions: Map<ts.Symbol, ts.Type>,
): void {
	if (!(source.flags & ts.TypeFlags.TypeParameter) || !source.symbol) {
		return;
	}
	substitutions.set(source.symbol, target);
}
