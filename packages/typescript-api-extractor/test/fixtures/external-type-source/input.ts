/**
 * Tests that external types record where they are declared, so a type from
 * TypeScript's default library can be told apart from a package type with the
 * same name.
 */
import 'augmenting-lib';
import {
	type Range as ShadowRange,
	type Intl as ShadowIntl,
	type Locale,
	type Locale as RenamedLocale,
	type PackageRange,
} from 'shadow-lib';
import { type Widget } from '@scope/widgets';

export interface SourceProps {
	/**
	 * Declared in one of the `lib.es*.d.ts` files.
	 */
	locale?: Intl.LocalesArgument;

	/**
	 * Declared across several `lib.es*.d.ts` files.
	 */
	numberFormat?: Intl.NumberFormat;

	/**
	 * Declared in a package, with the same name as the DOM `Range`.
	 * Attributed to the declaring package, not to `augmenting-lib` that augments it.
	 */
	range?: ShadowRange;

	/**
	 * Declared in a package, with the same name as the built-in `Intl.NumberFormat`.
	 */
	shadowNumberFormat?: ShadowIntl.NumberFormat;

	/**
	 * A package alias of a built-in type is attributed to the package.
	 */
	packageLocale?: Locale;

	/**
	 * The same alias imported under another name is still attributed to the package.
	 */
	renamedLocale?: RenamedLocale;

	/**
	 * A package alias of a built-in interface.
	 */
	packageRange?: PackageRange;

	/**
	 * The same alias referenced through an inline `import()` type.
	 */
	importedPackageRange?: import('shadow-lib').PackageRange;

	/**
	 * Declared in a scoped package.
	 */
	widget?: Widget;

	/**
	 * The DOM `Range` (declared in `lib.dom.d.ts`) and the package `Range` stay distinct members.
	 */
	anyRange?: Range | ShadowRange;

	/**
	 * Callbacks that differ only in which `Range` they receive stay distinct members.
	 */
	onRange?: ((range: Range) => void) | ((range: ShadowRange) => void);
}

/**
 * A re-exported package alias keeps its name on the export, and its type is the
 * built-in interface it aliases.
 */
export type { PackageRange } from 'shadow-lib';
