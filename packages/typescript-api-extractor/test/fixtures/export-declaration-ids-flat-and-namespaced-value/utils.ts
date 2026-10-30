/**
 * Restricts a value to a range.
 */
export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * Rounds a value to a step.
 */
export function snap(value: number, step: number): number {
	return Math.round(value / step) * step;
}

export interface Range {
	min: number;
	max: number;
}
