import { compare } from '@mui/internal-benchmark';

/**
 * Three sorts compared with each other rather than across builds — the shape a comparison between
 * libraries takes. This repository has no competitor libraries to install, so the "libraries" here
 * are three sorts with genuinely different constant factors. `ours` is the reference.
 */
compare('libs-sort', {
  ours: () => import('./sort.ours'),
  alpha: () => import('./sort.alpha'),
  beta: () => import('./sort.beta'),
});
