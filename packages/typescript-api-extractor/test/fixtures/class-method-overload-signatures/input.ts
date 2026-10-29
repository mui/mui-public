export class Formatter {
	format<T extends string>(value: T): string;
	format<T extends number>(value: T, precision: number): string;
	format<T extends string | number>(value: T, precision?: number): string {
		return String(value);
	}

	parse<T extends object = Record<string, unknown>>(input: string): T;
	parse<T extends string[] = string[]>(input: string, delimiter: string): T;
	parse<T extends object | string[] = Record<string, unknown>>(
		input: string,
		delimiter?: string,
	): T {
		return undefined as any;
	}
}
