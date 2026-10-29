interface Config {
	container: HTMLElement | ShadowRoot | null;
}

export interface Props {
	/**
	 * The container for the portal.
	 */
	container?: Config['container'] | undefined;
}

export function useConfig(): Config['container'] {
	return null;
}
