type ConditionalSubstitutionGlobalCell<Columns extends readonly { id: string }[]> =
  0 extends 1 & Columns ? { columnId: any } : { columnId: string };
