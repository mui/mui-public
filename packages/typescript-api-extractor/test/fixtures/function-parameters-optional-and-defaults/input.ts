const DEFAULT_VALUE = 'default';

/**
 * Function with optional parameters
 *
 * @param optional The optional parameter.
 * @param withInlineDefault The parameter with a default value.
 * @param withReferencedDefault The parameter with a default value from a constant.
 */
export function optionalParameters(
	required: number,
	optional?: number,
	withInlineDefault = 42,
	withReferencedDefault = DEFAULT_VALUE,
) {}
