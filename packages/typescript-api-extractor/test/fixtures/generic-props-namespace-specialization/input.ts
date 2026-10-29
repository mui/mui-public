import type * as React from 'react';

type ComponentProps<TState, RenderFunctionProps = GenericHTMLProps> = {
	className?: string | ((state: TState) => string);
	render?: ComponentRenderFn<RenderFunctionProps, TState>;
};

export function namespacedProps(props: MyComponent.Props) {}

type ComponentRenderFn<Props, State> = (props: Props, state: State) => React.ReactElement<unknown>;

export type GenericHTMLProps = React.HTMLAttributes<any> & { ref?: React.Ref<any> | undefined };

namespace MyComponent {
	export interface State {
		disabled: boolean;
	}

	export interface Props extends ComponentProps<State, GenericHTMLProps> {}
}
