import { QueryClient } from '@tanstack/react-query';

/**
 * The app's query cache. A module rather than a value created inside Providers
 * so that code running outside React — the GitHub transport, when it refreshes
 * the session — updates the same cache the components read.
 */
export const queryClient = new QueryClient();
