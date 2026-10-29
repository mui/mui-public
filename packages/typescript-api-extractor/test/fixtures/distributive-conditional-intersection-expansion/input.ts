// Simulates the BaseUIChangeEventDetails pattern:
// A distributive conditional type that resolves per-reason

type EventDetail<Reason extends string, Custom extends object = {}> = {
	reason: Reason;
	event: Event;
	cancel: () => void;
} & Custom;

// WITHOUT & {} (original)
type EventDetailsNoHack<Reason extends string, Custom extends object = {}> = Reason extends string
	? EventDetail<Reason, Custom>
	: never;

// WITH & {} (the hack to force expansion)
type EventDetailsWithHack<Reason extends string, Custom extends object = {}> = Reason extends string
	? EventDetail<Reason, Custom> & {}
	: never;

// Without & {}:
type TabsLikeNoHack = EventDetailsNoHack<'none', { direction: 'left' | 'right' }>;

// With & {}:
type TabsLikeWithHack = EventDetailsWithHack<'none', { direction: 'left' | 'right' }>;

export interface EventDetailsHandlers {
	onNoHack: (details: TabsLikeNoHack) => void;
	onWithHack: (details: TabsLikeWithHack) => void;
}
