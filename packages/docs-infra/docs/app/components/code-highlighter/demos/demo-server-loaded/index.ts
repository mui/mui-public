import { createDemo } from '../createDemo';
import Default from './ServerLoadedDemo';

export const ServerSideLoading = createDemo(
  import.meta.url,
  { Default },
  {
    name: 'Server-Side Loading',
    slug: 'server-side-loading',
  },
);
