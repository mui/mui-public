/**
 * A generic container for managing items of type T.
 *
 * @typeParam T - The type of items in the container.
 */
export class Container<T> {
	/**
	 * The items in the container.
	 */
	readonly items: T[] = [];

	/**
	 * The maximum capacity of the container.
	 */
	capacity: number;

	/**
	 * An optional label for the container.
	 */
	label?: string;

	/**
	 * Internal counter - should not appear in docs.
	 * @private
	 */
	private _counter: number = 0;

	/**
	 * Protected state - should not appear in docs.
	 */
	protected state: string = 'idle';

	/**
	 * Creates a new Container.
	 * @param capacity - Maximum number of items.
	 * @param label - Optional label for identification.
	 */
	constructor(capacity: number, label?: string) {
		this.capacity = capacity;
		this.label = label;
	}

	/**
	 * Adds an item to the container.
	 * @param item - The item to add.
	 * @returns Whether the item was added successfully.
	 */
	add(item: T): boolean {
		if (this.items.length >= this.capacity) {
			return false;
		}
		this.items.push(item);
		this._counter++;
		return true;
	}

	/**
	 * Removes an item at the specified index.
	 * @param index - The index of the item to remove.
	 * @returns The removed item, or undefined if index is out of bounds.
	 */
	remove(index: number): T | undefined {
		if (index < 0 || index >= this.items.length) {
			return undefined;
		}
		return this.items.splice(index, 1)[0];
	}

	/**
	 * Finds items matching a predicate.
	 * @param predicate - Function to test each item.
	 * @returns Array of matching items.
	 */
	find(predicate: (item: T) => boolean): T[] {
		return this.items.filter(predicate);
	}

	/**
	 * Clears all items from the container.
	 */
	clear(): void {
		this.items.length = 0;
	}

	/**
	 * Private helper - should not appear in docs.
	 * @private
	 */
	private reset(): void {
		this._counter = 0;
	}
}

/**
 * A class with constructor parameter properties.
 */
export class ParameterPropertyClass {
	/**
	 * Creates a new instance.
	 * @param id - The unique identifier (readonly).
	 * @param name - The name (mutable).
	 */
	constructor(
		public readonly id: string,
		public name: string,
	) {}
}

/**
 * A class with getter-only accessors (readonly by virtue of no setter).
 */
export class GetterOnlyClass {
	private _value: number = 0;

	/**
	 * The computed value (readonly - getter only, no setter).
	 */
	get computedValue(): number {
		return this._value * 2;
	}

	/**
	 * A read-write property (has both getter and setter).
	 */
	get mutableValue(): number {
		return this._value;
	}
	set mutableValue(v: number) {
		this._value = v;
	}
}

/**
 * A class with method overloads.
 */
export class OverloadedMethods {
	/**
	 * Process data with different input types.
	 * @param input - String or number to process.
	 */
	process(input: string): string;
	process(input: number): number;
	process(input: string | number): string | number {
		if (typeof input === 'string') {
			return input.toUpperCase();
		}
		return input * 2;
	}

	/**
	 * Get a value by key or index.
	 */
	get(key: string): string | undefined;
	get(index: number): string | undefined;
	get(keyOrIndex: string | number): string | undefined {
		return String(keyOrIndex);
	}
}

/**
 * A class with function-typed properties (should be properties, not methods).
 */
export class FunctionPropertyClass {
	/**
	 * A callback function property.
	 */
	onClick: () => void;

	/**
	 * A callback with parameters.
	 */
	onData: (data: string) => boolean;

	/**
	 * An actual method for comparison.
	 */
	handleClick(): void {
		this.onClick();
	}

	constructor() {
		this.onClick = () => {};
		this.onData = () => true;
	}
}

/**
 * A class with static members (should not appear in instance docs).
 */
export class StaticMembersClass {
	/**
	 * Static property.
	 */
	static version: string = '1.0.0';

	/**
	 * Static method.
	 */
	static create(name: string): StaticMembersClass {
		return new StaticMembersClass(name);
	}

	/**
	 * Instance property.
	 */
	name: string;

	constructor(name: string) {
		this.name = name;
	}
}

/**
 * A class with @internal and @ignore members.
 */
export class VisibilityTagsClass {
	/**
	 * Public property.
	 */
	publicProp: string = '';

	/**
	 * Internal property - should not appear.
	 * @internal
	 */
	internalProp: string = '';

	/**
	 * Ignored property - should not appear.
	 * @ignore
	 */
	ignoredProp: string = '';

	/**
	 * Public method.
	 */
	publicMethod(): void {}

	/**
	 * Internal method - should not appear.
	 * @internal
	 */
	internalMethod(): void {}
}

/**
 * A class with ECMAScript private names (#field, #method).
 * These should NOT appear in the output since they are always private.
 */
export class EcmaPrivateClass {
	/**
	 * A public property.
	 */
	publicField: string = 'hello';

	/**
	 * An ECMAScript private field - should not appear in docs.
	 */
	#secret: number = 42;

	/**
	 * Another ECMAScript private field - should not appear in docs.
	 */
	#internalState: boolean = false;

	/**
	 * A public method.
	 */
	getPublicInfo(): string {
		return this.publicField;
	}

	/**
	 * An ECMAScript private method - should not appear in docs.
	 */
	#computeSecret(): number {
		return this.#secret * 2;
	}
}

/**
 * This should NOT be parsed as a class - it's an interface with a construct signature.
 */
export interface Constructable {
	new (value: string): { value: string };
}

/**
 * This should NOT be parsed as a class - it's a type alias with a construct signature.
 */
export type ConstructableType = {
	new (value: number): { value: number };
};
