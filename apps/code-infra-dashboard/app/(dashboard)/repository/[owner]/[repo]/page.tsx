import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function RepositoryRedirect({ params }: PageProps) {
  const { owner, repo } = await params;
  redirect(`/repository/${owner}/${repo}/prs`);
}
