/**
 * A hook defined as a function.
 *
 * @param value - The value.
 * @param onChange - The change handler.
 * @param severity - The severity.
 *
 * @internal
 */
export function useHook(
	value: string,
	onChange: (newValue: string) => void,
	severity: Severity = 'low',
): number {
	return 42;
}

type Severity = 'low' | 'high';
