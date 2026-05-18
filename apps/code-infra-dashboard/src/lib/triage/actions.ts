'use server';

import type { TriageRow, TriageView } from './types';
import { getTriageView, TRIAGE_VIEWS } from './views';

export async function fetchTriageData(viewId: TriageView): Promise<TriageRow[]> {
  const view = getTriageView(viewId) ?? TRIAGE_VIEWS[0];
  return view.fetch();
}
