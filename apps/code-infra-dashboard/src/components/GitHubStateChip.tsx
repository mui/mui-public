import Chip from '@mui/material/Chip';

const STATE_COLORS: Record<string, string> = {
  open: '#238636',
  closed: '#da3633',
  merged: '#8957e5',
  draft: '#656d76',
};

interface GitHubStateChipProps {
  state: string;
}

export default function GitHubStateChip({ state }: GitHubStateChipProps) {
  return (
    <Chip
      label={state}
      size="small"
      sx={{ bgcolor: STATE_COLORS[state] ?? '#656d76', color: '#fff', fontWeight: 500 }}
    />
  );
}
