import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from '@mui/material/Link';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { styled } from '@mui/material/styles';

interface GitHubPRInfo {
  title: string;
  number: number;
  html_url: string;
}

/**
 * Hook to fetch PR information by PR number
 */
function usePRInfo(
  org: string,
  repo: string,
  prNumber: number,
): { prInfo: GitHubPRInfo | null; isLoading: boolean; error: Error | null } {
  const { data, isLoading, error } = useQuery({
    queryKey: ['github-pr', org, repo, prNumber],
    queryFn: async (): Promise<GitHubPRInfo | null> => {
      try {
        const response = await fetch(
          `https://api.github.com/repos/${org}/${repo}/pulls/${prNumber}`,
        );
        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
          title: data.title,
          number: prNumber,
          html_url: data.html_url,
        };
      } catch (err) {
        console.error('Error fetching PR info:', err);
        throw err;
      }
    },
    enabled: Boolean(org && repo && prNumber),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    prInfo: data,
    isLoading,
    error: error as Error | null,
  };
}

// PR icon as a simple SVG component
// Styled SVG wrapper that follows font size
const IconSvg = styled('svg')({
  display: 'inline-block',
  verticalAlign: 'text-bottom',
  marginRight: '4px',
  width: '1em',
  height: '1em',
  fontSize: '0.9em', // Slightly smaller than text
  fill: 'currentColor',
  position: 'relative',
  top: '0.1em', // Fine-tune vertical alignment
});

function PRIcon() {
  return (
    <IconSvg viewBox="0 0 16 16">
      <path d="M7.177 3.073L9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354zM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25zM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z" />
    </IconSvg>
  );
}

// Styled code component for backtick formatting
const CodeSpan = styled('code')({
  fontFamily: 'monospace',
  backgroundColor: 'rgba(0, 0, 0, 0.05)',
  padding: '0.1em 0.3em',
  borderRadius: '3px',
  fontSize: '85%',
  fontWeight: 'normal',
});

interface GitHubPRReferenceProps {
  org: string;
  repo: string;
  prNumber: number;
}

/**
 * Component that renders a GitHub-like PR reference with icon and title
 * Format: "<pr icon> [org/context] PR title org/repo#number"
 * The entire component is a link to the GitHub PR
 */
// Pure presentational component for PR content
// This receives all the data already processed
interface PRContentProps {
  isLoading: boolean;
  icon: React.ReactNode;
  contextPrefix?: string; // Optional context prefix like "[core]"
  title?: React.ReactNode; // The formatted title content (can include React elements for backtick formatting)
  reference: string; // The PR reference (org/repo#number)
}

// This is a pure presentational component that handles different states through props
function PRContent({ isLoading, icon, contextPrefix, title, reference }: PRContentProps) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline' }}>
      {icon}
      <Box component="span" sx={{ ml: 0.5 }}>
        {isLoading || !contextPrefix || !title ? (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
            <Box component="span" sx={{ color: 'primary.main', display: 'inline' }}>
              {reference}
            </Box>
            {isLoading && (
              <CircularProgress 
                size={12} 
                thickness={6}
                sx={{ 
                  ml: 0.75, 
                  color: 'text.secondary',
                  display: 'inline-block',
                  verticalAlign: 'middle'
                }} 
              />
            )}
          </Box>
        ) : (
          <React.Fragment>
            {contextPrefix && (
              <Box component="span" sx={{ fontWeight: 'bold', display: 'inline' }}>
                {contextPrefix}{' '}
              </Box>
            )}
            {title && (
              <Box component="span" sx={{ display: 'inline' }}>
                {title}{' '}
              </Box>
            )}
            <Box component="span" sx={{ color: 'primary.main', display: 'inline' }}>
              {reference}
            </Box>
          </React.Fragment>
        )}
      </Box>
    </Box>
  );
}

export default function GitHubPRReference({ org, repo, prNumber }: GitHubPRReferenceProps) {
  const { prInfo, isLoading, error } = usePRInfo(org, repo, prNumber);

  // Base URL for linking to the PR
  const prUrl = `https://github.com/${org}/${repo}/pull/${prNumber}`;

  // Create the PR reference text (org/repo#number)
  const prReference = `${org}/${repo}#${prNumber}`;

  // Process title for formatting if we have PR info
  let contextPrefix: string | undefined;
  let formattedTitle: React.ReactNode | undefined;

  if (!isLoading && !error && prInfo) {
    // Extract context from PR title (e.g. "[code-infra]")
    const contextMatch = prInfo.title.match(/^\[([\w-]+)\]/);
    if (contextMatch) {
      contextPrefix = contextMatch[0];
      const title = prInfo.title.substring(contextPrefix.length).trim();

      // Format code sections in title
      formattedTitle = title.split(/(`[^`]+`)/g).map((part, index) => {
        const codeMatch = part.match(/^`([^`]+)`$/);
        if (codeMatch) {
          return <CodeSpan key={index}>{codeMatch[1]}</CodeSpan>;
        }
        return part;
      });
    } else {
      formattedTitle = prInfo.title;
    }
  }

  // The Link wrapper is consistent across all states
  return (
    <Link
      href={prUrl}
      target="_blank"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        textDecoration: 'none',
        lineHeight: 'inherit',
        verticalAlign: 'baseline',
        '&:hover': {
          textDecoration: 'underline',
        },
      }}
    >
      <PRContent
        isLoading={isLoading}
        icon={<PRIcon />}
        contextPrefix={contextPrefix}
        title={formattedTitle}
        reference={prReference}
      />
    </Link>
  );
}
