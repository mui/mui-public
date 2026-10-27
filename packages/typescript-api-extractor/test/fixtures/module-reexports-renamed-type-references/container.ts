import type { State as ImportedToggleState } from './toggle';

interface State {
  open: boolean;
}

export interface Container {
  state: State;
  toggle: ImportedToggleState;
}
