type Percentage = `${number}%`;

export type Fraction = `${number}fr`;

export type DataAttribute = `data-${string}`;

export type TrackMinimum = number | Percentage | 'auto';

// TypeScript distributes finite placeholders into a union of template literals.
export type Placement = `${'top' | 'bottom'}-${number}`;

// TypeScript flattens nested template literals into one.
export type Nested = `a-${`b-${number}`}`;

export type Multiple = `${number}-to-${number}`;

export interface Props {
	width?: `${number}px`;
	minimum: TrackMinimum;
}

export function listen<T extends string>(event: `on${T}`): void {}
