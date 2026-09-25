import { compare } from '@mui/internal-benchmark';

/**
 * Two implementations of the same list, compared with each other rather than across builds — the
 * shape a comparison between libraries takes. Each variant is a module of plain `benchmark()` cases;
 * cases with the same name are paired, and the first variant is the reference.
 *
 * Every variant gets a page of its own that loads only its own module, so neither implementation's
 * code or styles are present while the other is measured.
 */
compare('lists', {
  ul: () => import('./lists.ul'),
  table: () => import('./lists.table'),
});
