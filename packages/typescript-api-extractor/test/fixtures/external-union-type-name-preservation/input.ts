/**
 * Tests that external type names are preserved when used in unions.
 *
 * The Rect type from 'external-lib' is defined as:
 *   type Rect = Prettify<Coords & Dimensions>
 *
 * TypeScript resolves Rect to Prettify<...>, but we want to preserve
 * the original name "Rect" in the output.
 */
import { type Rect, type Point, type Padding } from 'external-lib';
import { type Rect as NestedRect } from 'external-lib-wrapper';

/**
 * A boundary can be the clipping ancestors, an element, or a Rect.
 * The Rect type should be preserved as "Rect" not expanded to its underlying type.
 */
export type Boundary = 'clipping-ancestors' | Element | Element[] | Rect;

/**
 * An anchor can be an element or a Point.
 */
export type Anchor = Element | Point;

/**
 * Re-export of Padding type.
 * External types are preserved as external type nodes with their original name.
 */
export type { Padding } from 'external-lib';

/**
 * Re-export through a wrapper package (nested re-export).
 * Tests that type names are preserved through multiple levels of re-exports.
 * external-lib-wrapper re-exports Rect from external-lib.
 */
export type { Rect as NestedRect } from 'external-lib-wrapper';

/**
 * Props that use external types in unions.
 */
export interface PositioningProps {
	/**
	 * The collision boundary.
	 */
	collisionBoundary?: Boundary;

	/**
	 * The anchor point or element.
	 */
	anchor?: Anchor;

	/**
	 * The collision padding.
	 * External types like Padding are preserved with their name.
	 */
	collisionPadding?: Padding;

	/**
	 * A nested re-exported type used in a union.
	 * Tests that nested re-exports preserve type names.
	 */
	nestedRect?: NestedRect | null;
}
