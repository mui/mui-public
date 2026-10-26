import * as React from 'react';

export const BaseUIComponent1 = React.forwardRef(function BaseUIComponent(
	props: BaseUIComponent1.Props,
	ref: React.ForwardedRef<HTMLDivElement>,
) {
	return <div ref={ref} />;
});

export namespace BaseUIComponent1 {
	export interface Props extends BaseUIComponentProps<'div', State> {
		value?: Value;
		onValueChange?: (value: Value) => void;
		actionsRef?: React.RefObject<Actions>;
	}

	export interface State {
		state: string;
	}

	export interface Actions {
		ping: () => void;
	}

	export type Value = BaseUIComponent1Value;
}

export type BaseUIComponent1Value = any | null;

export const BaseUIComponent2 = React.forwardRef(function BaseUIComponent(
	props: BaseUIComponent2.Props,
	ref: React.ForwardedRef<HTMLDivElement>,
) {
	return <div ref={ref} />;
});

export namespace BaseUIComponent2 {
	export interface Props extends BaseUIComponentProps<'div', State> {}

	export interface State {}
}

type BaseUIComponentProps<
	ElementType extends React.ElementType,
	State,
	RenderFunctionProps = HTMLProps,
> = Omit<
	WithBaseUIEvent<React.ComponentPropsWithRef<ElementType>>,
	'className' | 'color' | 'defaultValue' | 'defaultChecked'
> & {
	className?: string | ((state: State) => string);
	render?:
		React.ReactElement<Record<string, unknown>> | ComponentRenderFn<RenderFunctionProps, State>;
};

export type ComponentRenderFn<Props, State> = (
	props: Props,
	state: State,
) => React.ReactElement<unknown>;

type WithBaseUIEvent<T> = {
	[K in keyof T]: WithPreventBaseUIHandler<T[K]>;
};

type HTMLProps<T = any> = React.HTMLAttributes<T> & {
	ref?: React.Ref<T> | undefined;
};

type BaseUIEvent<E extends React.SyntheticEvent<Element, Event>> = E & {
	preventBaseUIHandler: () => void;
	readonly baseUIHandlerPrevented?: boolean;
};

type WithPreventBaseUIHandler<T> = T extends (event: infer E) => any
	? E extends React.SyntheticEvent<Element, Event>
		? (event: BaseUIEvent<E>) => ReturnType<T>
		: T
	: T extends undefined
		? undefined
		: T;
