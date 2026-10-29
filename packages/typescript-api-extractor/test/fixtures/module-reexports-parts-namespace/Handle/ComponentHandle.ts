/**
 * A handle to control a Component imperatively.
 */
export class ComponentHandle<Payload = unknown> {
	/**
	 * Internal store holding state.
	 * @internal
	 */
	public readonly store: { open: boolean; payload?: Payload };

	constructor() {
		this.store = { open: false };
	}

	/**
	 * Opens the component with the given trigger ID.
	 * @param triggerId - ID of the trigger to associate with the component.
	 */
	open(triggerId: string | null): void {
		this.store.open = true;
	}

	/**
	 * Opens the component and sets the payload.
	 * @param payload - Payload to set when opening.
	 */
	openWithPayload(payload: Payload): void {
		this.store.payload = payload;
		this.store.open = true;
	}

	/**
	 * Closes the component.
	 */
	close(): void {
		this.store.open = false;
	}

	/**
	 * Indicates whether the component is currently open.
	 */
	get isOpen(): boolean {
		return this.store.open;
	}
}

/**
 * Creates a new handle to connect a Component.Root with detached triggers.
 */
export function createComponentHandle<Payload = unknown>(): ComponentHandle<Payload> {
	return new ComponentHandle<Payload>();
}
