import type * as React from 'react';

// Material UI's OverridableComponent

declare const Component: OverridableComponent<ComponentTypeMap> & { muiName: string };

export default Component;

interface ComponentOwnProps {
	variant?: 'default' | 'small' | 'large';
}

interface ComponentTypeMap<AdditionalProps = {}, RootComponent extends React.ElementType = 'span'> {
	props: AdditionalProps & ComponentOwnProps;
	defaultComponent: RootComponent;
}

interface OverridableComponent<TypeMap extends OverridableTypeMap> {
	// If you make any changes to this interface, please make sure to update the
	// `OverridableComponent` type in `mui-types/index.d.ts` as well.
	// Also, there are types in Base UI that have a similar shape to this interface
	// (for example SelectType, OptionType, etc.).
	<RootComponent extends React.ElementType>(
		props: {
			/**
			 * The component used for the root node.
			 */
			component: RootComponent;
		} & OverrideProps<TypeMap, RootComponent>,
	): React.JSX.Element | null;
	(props: DefaultComponentProps<TypeMap>): React.JSX.Element | null;
}

type OverrideProps<
	TypeMap extends OverridableTypeMap,
	RootComponent extends React.ElementType,
> = BaseProps<TypeMap> &
	DistributiveOmit<React.ComponentPropsWithRef<RootComponent>, keyof BaseProps<TypeMap>>;

type DefaultComponentProps<TypeMap extends OverridableTypeMap> = BaseProps<TypeMap> &
	DistributiveOmit<
		React.ComponentPropsWithRef<TypeMap['defaultComponent']>,
		keyof BaseProps<TypeMap>
	>;

interface OverridableTypeMap {
	props: {};
	defaultComponent: React.ElementType;
}

type BaseProps<TypeMap extends OverridableTypeMap> = TypeMap['props'] & CommonProps;

interface CommonProps {
	className?: string;
	style?: React.CSSProperties;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;
