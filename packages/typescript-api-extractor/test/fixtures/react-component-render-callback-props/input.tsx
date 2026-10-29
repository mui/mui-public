import * as React from 'react';

// Simulates a component render function type
type ComponentRenderFn<Props, State> = (props: Props, state: State) => React.ReactElement<unknown>;

// State types for different components
type AccordionItemState = {
	expanded: boolean;
};

// Namespace to simulate Base UI's export pattern
namespace Accordion {
	export namespace Item {
		export type State = AccordionItemState;
	}
}

// Props type with generic render function
type BaseUIComponentProps<State, RenderFunctionProps = React.HTMLProps<HTMLElement>> = {
	/**
	 * Render function or element
	 */
	render?: React.ReactElement | ComponentRenderFn<RenderFunctionProps, State>;
};

// Component that uses the generic props
export type AccordionHeaderProps = BaseUIComponentProps<Accordion.Item.State>;

// Also export directly to test the deduplication
export function AccordionHeader(props: AccordionHeaderProps): React.ReactElement {
	return <div>{typeof props.render === 'function' ? null : props.render}</div>;
}
