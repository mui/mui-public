import { postToDashboard } from './ciApi';

interface SyncPrCommentResult {
  success: boolean;
  skipped?: boolean;
}

/** Asks the dashboard to regenerate the pull request comment for `repo`. */
export async function syncPrComment(repo: string): Promise<SyncPrCommentResult> {
  const responseText = await postToDashboard(
    '/api/ci-reports/sync-pr-comment',
    { repo },
    'The pull request comment sync',
  );
  return JSON.parse(responseText);
}
