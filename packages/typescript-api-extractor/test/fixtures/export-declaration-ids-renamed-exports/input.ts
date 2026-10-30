/**
 * Formats a value.
 */
function formatValue(value: number): string {
	return value.toFixed(2);
}

// A rename emitted before the export named like the declaration shares its id.
export { formatValue as format };
export { formatValue };

/**
 * Parses a value.
 */
export default function parseValue(text: string): number {
	return Number(text);
}

export { parseValue };

export type Status = 'idle' | 'busy';

export type { Status as State };
