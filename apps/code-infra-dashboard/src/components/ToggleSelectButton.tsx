import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';

export const ToggleSelectButton = styled(Button)(({ theme }) => ({
  minWidth: 'auto',
  padding: 0,
  fontSize: '0.75rem',
  textDecoration: 'underline',
  color: theme.vars.palette.primary.main,
  textTransform: 'none',
  '&:disabled': {
    color: theme.vars.palette.text.secondary,
    textDecoration: 'none',
  },
}));
