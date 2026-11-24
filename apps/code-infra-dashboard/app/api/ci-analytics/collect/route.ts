import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { collectCiSnapshot, isPublicProject } from '../../../../src/lib/collectCiMetrics';
import { listViewablePrivateRepositories } from '../../../../src/lib/privateRepositories';

const getCachedSnapshot = unstable_cache(collectCiSnapshot, ['ci-analytics-snapshot'], {
  revalidate: 3600, // 1 hour
});

// Private projects are only included for visitors GitHub lets read their repository. The weekly
// snapshot that the CI analytics workflow commits to the public `ci-data` branch is collected
// signed out, so it holds the public projects only.
export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === 'true';
  const [snapshot, viewablePrivate] = await Promise.all([
    fresh ? collectCiSnapshot() : getCachedSnapshot(),
    listViewablePrivateRepositories(),
  ]);
  const viewable = new Set(viewablePrivate.map((repo) => `gh/${repo.owner}/${repo.name}`));
  const projects = snapshot.projects.filter(
    (project) => isPublicProject(project.slug) || viewable.has(project.slug),
  );
  return NextResponse.json(
    { ...snapshot, projects },
    viewable.size > 0 ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined,
  );
}
