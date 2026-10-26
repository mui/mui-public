import * as React from 'react';

/**
 * Component with overloads where one overload results in `any` for ItemValue
 * and the other results in a concrete type.
 * Tests that callbacks with `any` params are deduplicated in favor of concrete types.
 */
export function GenericComponent<Items extends readonly { items: readonly any[] }[]>(
	props: Omit<GenericComponentProps<Items[number]['items'][number]>, 'items'> & {
		items: Items;
	},
): React.JSX.Element;
export function GenericComponent<ItemValue>(
	props: Omit<GenericComponentProps<ItemValue>, 'items'> & {
		items?: readonly ItemValue[];
	},
): React.JSX.Element;
export function GenericComponent<ItemValue>(
	props: GenericComponentProps<ItemValue>,
): React.JSX.Element {
	return <div />;
}

interface GenericComponentProps<ItemValue> {
	items?: readonly ItemValue[];
	/**
	 * Callback that receives the item value.
	 * Should be deduplicated when one overload has `any` and another has concrete type.
	 */
	onItemSelect?: (itemValue: ItemValue) => void;
	/**
	 * Filter function with nested callback.
	 * Both outer and inner callbacks should be deduplicated.
	 */
	filter?:
		| ((
				itemValue: ItemValue,
				query: string,
				itemToString: ((value: ItemValue) => string) | undefined,
		  ) => boolean)
		| null;
	/**
	 * Callback with union type parameter.
	 */
	onItemHighlighted?: (highlightedValue: ItemValue | undefined) => void;
}
