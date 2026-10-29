import type { Foo as AliasedFoo } from './types';

export namespace Root {
	export type Foo = AliasedFoo;

	export namespace Nested {
		export type Foo = AliasedFoo;
	}

	export interface Props {
		foo: Foo;
		nestedFoo: Nested.Foo;
	}
}

export function NamespacedAliasComponent(props: Root.Props) {
	return <div />;
}
