import type { Pair } from './generic';

export type { State as ToggleState, Holder as ToggleHolder } from './toggle';
export type { State as SwitchState, Holder as SwitchHolder } from './switch';
export type { Container } from './container';
export type { PairHolder } from './generic';

// Passes its type parameters through, so it renames `Pair`
export type SamePair<First, Second> = Pair<First, Second>;
// Reorders them, so it is a different type
export type SwappedPair<First, Second> = Pair<Second, First>;
