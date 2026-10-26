export class ParserError extends Error {
	parsedSymbolStack: string[];
	innerError: Error | unknown;

	constructor(
		innerError: Error | unknown,
		parsedSymbolStack: string[],
		message?: string,
		options?: ErrorOptions,
	) {
		super(message, options);

		this.stack = (innerError as Error).stack;

		this.name = 'ParserError';
		this.parsedSymbolStack = [...parsedSymbolStack];
		this.innerError = innerError;

		this.message = `Failed to parse ${[...parsedSymbolStack].join(' > ')}\n${this.message}`;
	}
}
