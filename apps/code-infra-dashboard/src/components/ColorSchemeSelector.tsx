'use client';

import * as React from 'react';
import { useColorScheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import SettingsBrightnessIcon from '@mui/icons-material/SettingsBrightness';
import CheckIcon from '@mui/icons-material/Check';

type Mode = 'light' | 'dark' | 'system';

const modes: Record<Mode, { label: string; icon: React.ReactNode }> = {
  light: { label: 'Light', icon: <LightModeIcon fontSize="inherit" /> },
  dark: { label: 'Dark', icon: <DarkModeIcon fontSize="inherit" /> },
  system: { label: 'System', icon: <SettingsBrightnessIcon fontSize="inherit" /> },
};

export default function ColorSchemeSelector() {
  const { mode, setMode } = useColorScheme();
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleModeSelect = (newMode: Mode) => {
    setMode(newMode);
    handleClose();
  };

  return (
    <React.Fragment>
      <IconButton
        onClick={handleClick}
        aria-label="Select color scheme"
        aria-controls={open ? 'color-scheme-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        {modes[mode ?? 'system'].icon}
      </IconButton>
      <Menu
        id="color-scheme-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        slotProps={{
          list: { 'aria-labelledby': 'color-scheme-button' },
        }}
      >
        {(Object.entries(modes) as [Mode, { label: string; icon: React.ReactNode }][]).map(
          ([value, { label, icon }]) => (
            <MenuItem key={value} onClick={() => handleModeSelect(value)} selected={mode === value}>
              <ListItemIcon>{icon}</ListItemIcon>
              <ListItemText>{label}</ListItemText>
              {mode === value && <CheckIcon fontSize="small" sx={{ ml: 1 }} />}
            </MenuItem>
          ),
        )}
      </Menu>
    </React.Fragment>
  );
}
