import { NextRequest, NextResponse } from 'next/server';
import { sizeSnapshotUploadSchema } from '@mui/internal-bundle-size-checker/ciReport';
import { uploadReport } from '@/lib/ciReports/s3';
import { isAllowedRepo, validatePrCommit, validateBranchCommit } from '@/lib/ciReports/validation';

export async function POST(request: NextRequest) {
  const body: unknown = await request.json();

  const parsed = sizeSnapshotUploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { commitSha, repo, reportType, prNumber, branch, report } = parsed.data;

  if (!isAllowedRepo(repo)) {
    return NextResponse.json({ error: `Repository "${repo}" is not allowed` }, { status: 403 });
  }

  if (prNumber == null && !branch) {
    return NextResponse.json(
      { error: 'Either prNumber or branch must be provided' },
      { status: 400 },
    );
  }

  // Parse owner/repo
  const [owner, repoName] = repo.split('/');

  // Validate via GitHub API
  if (prNumber != null) {
    const result = await validatePrCommit(owner, repoName, prNumber, commitSha);
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
  } else if (branch) {
    const result = await validateBranchCommit(owner, repoName, branch, commitSha);
    if (!result.valid) {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }
  }

  const key = `artifacts/${repo}/${commitSha}/${reportType}.json`;
  const isPullRequest = prNumber != null;

  await uploadReport({
    key,
    body: JSON.stringify(report),
    isPullRequest,
    branch: branch ?? '',
  });

  return NextResponse.json({ key });
}
