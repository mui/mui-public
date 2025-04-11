import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from '@mui/material/Link';
import Box from '@mui/material/Box';
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
        const response = await fetch(`https://api.github.com/repos/${org}/${repo}/pulls/${prNumber}`);
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
  top: '0.1em' // Fine-tune vertical alignment
});

function PRIcon() {
  return (
    <IconSvg viewBox="0 0 16 16">
      <path d="M7.177 3.073L9.573.677A.25.25 0 0 1 10 .854v4.792a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354zM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25zM11 2.5h-1V4h1a1 1 0 0 1 1 1v5.628a2.251 2.251 0 1 0 1.5 0V5A2.5 2.5 0 0 0 11 2.5zm1 10.25a.75.75 0 1 1 1.5 0 .75.75 0 0 1-1.5 0zM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z"></path>
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
  fontWeight: 'normal'
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
export default function GitHubPRReference({ org, repo, prNumber }: GitHubPRReferenceProps) {
  const { prInfo, isLoading, error } = usePRInfo(org, repo, prNumber);
  
  // Base URL for linking to the PR
  const prUrl = `https://github.com/${org}/${repo}/pull/${prNumber}`;
  
  // Create the PR reference text (org/repo#number)
  const prReference = `${org}/${repo}#${prNumber}`;

  if (isLoading) {
    return (
      <Link 
        href={prUrl} 
        target="_blank" 
        sx={{ 
          display: 'inline-flex', 
          alignItems: 'center',
          fontSize: 'inherit',
          fontWeight: 'inherit',
          color: 'inherit'
        }}
      >
        <PRIcon />
        Loading PR {prReference}...
      </Link>
    );
  }

  if (error || !prInfo) {
    return (
      <Link 
        href={prUrl} 
        target="_blank" 
        sx={{ 
          display: 'inline-flex', 
          alignItems: 'center',
          fontSize: 'inherit',
          fontWeight: 'inherit'
        }}
      >
        <PRIcon />
        {prReference}
      </Link>
    );
  }

  // Extract the context from the PR title (e.g. "[code-infra]")
  let context = '';
  let title = prInfo.title;
  
  const contextMatch = prInfo.title.match(/^\[([\w-]+)\]/);
  if (contextMatch) {
    context = contextMatch[0];
    title = prInfo.title.substring(context.length).trim();
  }

  // Process title to format code sections (text in backticks)
  const formatTitleWithCode = (text: string) => {
    // Split the text by backticks
    const parts = text.split(/(`[^`]+`)/);
    
    return parts.map((part, index) => {
      const codeMatch = part.match(/^`([^`]+)`$/);
      if (codeMatch) {
        // This is a code section, render it with CodeSpan
        return <CodeSpan key={index}>{codeMatch[1]}</CodeSpan>;
      }
      // Regular text
      return part;
    });
  };

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
          textDecoration: 'underline'
        }
      }}
    >
      <PRIcon />
      <Box component="span" sx={{ display: 'inline' }}>
        {context && <Box component="span" sx={{ fontWeight: 'bold', display: 'inline' }}>{context} </Box>}
        <Box component="span" sx={{ display: 'inline' }}>{formatTitleWithCode(title)} </Box>
        <Box component="span" sx={{ color: 'primary.main', display: 'inline' }}>
          {prReference}
        </Box>
      </Box>
    </Link>
  );
}