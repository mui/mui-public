// Defines a conditional type that maps reason strings to DOM event types.
// This file is LOCAL (not in node_modules), but the resolved types (Event, KeyboardEvent, etc.)
// ARE external (from lib.dom.d.ts). This tests the scenario where a local type alias
// resolves to an external type.

interface ReasonToEventMap {
	none: Event;
	keyboard: KeyboardEvent;
	mouse: MouseEvent;
}

/**
 * Maps a reason string to its corresponding event type.
 * Falls back to Event for unknown reasons.
 */
export type ReasonToEvent<Reason extends string> = Reason extends keyof ReasonToEventMap
	? ReasonToEventMap[Reason]
	: Event;
