import _formatErrorMessage from '@mui/utils/formatMuiErrorMessage';
throw new TypeError(
  process.env.NODE_ENV !== 'production'
    ? 'MUI: Expected a valid string argument.'
    : _formatErrorMessage(1),
);
throw new TypeError(
  process.env.NODE_ENV !== 'production' ? `MUI: Invalid type provided.` : _formatErrorMessage(2),
);
