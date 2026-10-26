// Test: authored alias with explicit type arguments where
// outer and inner aliases have DIFFERENT defaults.
// Ensures equalToDefault is evaluated against the authored (outer) alias.

interface Inner<T = string, U = number> {
	value: T;
	count: U;
}

// Outer has different defaults than Inner
type Outer<A = boolean, B = bigint> = Inner<A, B>;

// Uses Outer's default for A (boolean), but overrides B
type UsesOuterDefault = Outer<boolean, string>;

// Overrides both of Outer's defaults
type OverridesBoth = Outer<number, string>;

// Uses both Outer defaults (no angle brackets)
type UsesBothDefaults = Outer;

export interface AliasDefaults {
	withOuterDefault: UsesOuterDefault;
	overridesBoth: OverridesBoth;
	usesBothDefaults: UsesBothDefaults;
	// Direct usage with explicit args matching Outer defaults
	directDefault: Outer<boolean, bigint>;
	// Direct usage with non-default args
	directOverride: Outer<string, number>;
	// Partially explicit: first arg overridden, second uses Outer default (bigint)
	partialOverride: Outer<string>;
	// Partially explicit: first arg matches Outer default, second uses Outer default
	partialDefault: Outer<boolean>;
}
