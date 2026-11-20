/// <reference path="./globals.d.ts" />

/** Forwards to a conditional declared in a global script. */
export type Cell<Columns extends readonly { id: string }[]> =
  ConditionalSubstitutionGlobalCell<Columns>;
