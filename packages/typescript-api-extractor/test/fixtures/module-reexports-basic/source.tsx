import * as React from 'react';

export interface RootProps {
	value: string;
	onChange: (value: string) => void;
}

export type RootState = 'idle' | 'loading' | 'error';

export function RootComponent(props: RootProps) {
	return <div>{props.value}</div>;
}

export namespace RootComponent {
	export type Props = RootProps;
	export type State = RootState;
}
