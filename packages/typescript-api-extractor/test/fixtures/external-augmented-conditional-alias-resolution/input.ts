// Tests that an alias declared in a package resolves to the type it computes. The package
// declares `SupportedObject` as a conditional over an interface its adapters augment, as
// Base UI declares `TemporalSupportedObject`. With the adapter loaded the alias is `Date`,
// and its name means nothing to readers, so the parser should output `Date`.

import type { SupportedObject } from 'date-lib';
import 'date-lib/adapter';

export interface Props {
  /**
   * The selected date.
   */
  value: SupportedObject | null;
  /**
   * The date to show when there is no value.
   */
  referenceDate?: SupportedObject;
}
