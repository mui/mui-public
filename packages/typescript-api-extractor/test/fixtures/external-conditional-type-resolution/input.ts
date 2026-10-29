// Tests the pattern where a locally-defined conditional type alias resolves to
// an external type (from lib.dom.d.ts). When TypeScript resolves `ReasonToEvent<'none'>`
// to `Event`, the parser should output `Event` (the resolved type) instead of
// `ReasonToEvent` (the authored alias name).
//
// The ReasonToEvent type pattern from base-ui is a real-world example of this.

import { ReasonToEvent } from './external-types';

export interface Props {
	/**
	 * The event associated with the change.
	 */
	event: ReasonToEvent<'none'>;
	/**
	 * The keyboard event.
	 */
	keyboardEvent: ReasonToEvent<'keyboard'>;
	/**
	 * Unknown reason falls back to generic Event.
	 */
	unknownEvent: ReasonToEvent<'unknown'>;
}
