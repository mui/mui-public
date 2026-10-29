/**
 * A class defined in another module, re-exported via import + export type.
 */
export class ImportedClass {
	/**
	 * The value held by the instance.
	 */
	value: string;

	/**
	 * Creates a new ImportedClass.
	 * @param value - The initial value.
	 */
	constructor(value: string) {
		this.value = value;
	}

	/**
	 * Returns the current value.
	 */
	getValue(): string {
		return this.value;
	}
}
