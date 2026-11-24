'use server';

import type { TriageRow, TriageView } from './types';
import { getTriageView, TRIAGE_VIEWS } from './views';
import { MUI_KPI_REPOS } from '../../constants';
import { listViewablePrivateRepositories } from '../privateRepositories';

export async function fetchTriageData(viewId: TriageView): Promise<TriageRow[]> {
  const view = getTriageView(viewId) ?? TRIAGE_VIEWS[0];
  const viewablePrivate = await listViewablePrivateRepositories(MUI_KPI_REPOS);
  return view.fetch(
    MUI_KPI_REPOS.filter((repo) => repo.isPublic || viewablePrivate.includes(repo)),
  );
}
