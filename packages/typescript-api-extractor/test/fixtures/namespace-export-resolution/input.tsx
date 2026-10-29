export namespace Root {
	export namespace Sub {
		export function nestedParams(params: Params) {}

		export interface Params {
			s: Grade;
			a: NamespacedType;
			os?: Grade;
			oa?: NamespacedType;
		}

		export enum Grade {
			good,
			bad,
		}

		export function NestedComponent() {
			return <div />;
		}

		export function useHook() {
			const active = true;
			const count = 0;
			return { active, count };
		}
	}

	export function rootFunction() {}

	export type NamespacedType = OutsideType;
}

export namespace Other {
	export type Orientation = 'horizontal' | 'vertical';
}

export function acceptsNestedParams(params: Root.Sub.Params) {}

export function acceptsNamespacedType(a: Root.NamespacedType) {}

type OutsideType = 'one' | 'two';
