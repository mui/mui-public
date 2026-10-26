export interface FormattedProperty {
	type: string;
	description?: string;
}

export interface FormattedParameter {
	name: string;
	type: string;
	optional?: boolean;
}

/**
 * A generic container type to test generic re-exports.
 */
export interface Container<T> {
	value: T;
	metadata?: Record<string, unknown>;
}

/**
 * Enum representing processing status.
 */
export declare const ProcessingStatus: {
	readonly Pending: 'pending';
	readonly Complete: 'complete';
	readonly Failed: 'failed';
};
export type ProcessingStatus = (typeof ProcessingStatus)[keyof typeof ProcessingStatus];

export function formatType(type: string): FormattedProperty;

export function parseParameters(input: string): FormattedParameter[];
