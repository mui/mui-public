/**
 * Returns the input string.
 * @param s - The string
 */
export function useHook(s: string): string;
/**
 * Returns the input number.
 * @param n - The number
 */
export function useHook(n: number): number;
export function useHook(x: string | number): string | number {
	return x;
}
