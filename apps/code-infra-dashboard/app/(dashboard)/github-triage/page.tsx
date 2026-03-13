import type { Metadata } from 'next';
import GitHubTriage from '@/views/GitHubTriage';

export const metadata: Metadata = { title: 'GitHub Triage' };

export default function GitHubTriagePage() {
  return <GitHubTriage />;
}
