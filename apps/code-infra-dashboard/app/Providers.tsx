'use client';

import * as React from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import * as colors from '@mui/material/colors';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers-pro/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers-pro/AdapterDayjs';
import { LicenseInfo } from '@mui/x-license';
import SessionProvider from '../src/components/auth/SessionProvider';

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
}

if (process.env.NEXT_PUBLIC_MUI_LICENSE) {
  LicenseInfo.setLicenseKey(process.env.NEXT_PUBLIC_MUI_LICENSE);
}

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true;
  }
}

const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'data',
  },
  colorSchemes: {
    light: {},
    dark: {
      palette: {
        background: { default: '#121212' },
        primary: {
          main: colors.amber['300'],
        },
        secondary: {
          main: colors.teal['300'],
        },
      },
    },
  },
  typography: {
    h1: { fontSize: '1.4rem' },
    h2: { fontSize: '1.2rem' },
    h3: { fontSize: '1.15rem' },
    h4: { fontSize: '1.1rem' },
    h5: { fontSize: '1.0rem' },
    h6: { fontSize: '1.0rem' },
  },
  components: {
    MuiButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiFilledInput: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiFormControl: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiFormHelperText: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiInputBase: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiInputLabel: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiListItem: {
      defaultProps: {
        dense: true,
      },
    },
    MuiOutlinedInput: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiFab: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiTable: {
      defaultProps: {
        size: 'small',
      },
    },
    MuiTextField: {
      defaultProps: {
        margin: 'dense',
      },
    },
    MuiToolbar: {
      defaultProps: {
        variant: 'dense',
      },
    },
  },
  spacing: 4,
});

let browserQueryClient: QueryClient | undefined;

/**
 * A module-scope client would be shared by every render in the server process,
 * which would serve one signed-in user's cached data to another. The server gets
 * a fresh client per request; the browser keeps one for the tab's lifetime.
 */
function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    return new QueryClient();
  }
  browserQueryClient ??= new QueryClient();
  return browserQueryClient;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(getQueryClient);

  return (
    <AppRouterCacheProvider>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <ThemeProvider theme={theme}>
            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <CssBaseline enableColorScheme />
              {children}
            </LocalizationProvider>
          </ThemeProvider>
        </SessionProvider>
      </QueryClientProvider>
    </AppRouterCacheProvider>
  );
}
