import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import * as colors from '@mui/material/colors';
import { QueryCache, ReactQueryCacheProvider } from 'react-query';
import { BrowserRouter, Routes, Route } from 'react-router';
import './index.css';

const Landing = React.lazy(() => import('./pages/Landing'));
const SizeComparison = React.lazy(() => import('./pages/SizeComparison'));

const suspenseQueryCache = new QueryCache({
  defaultConfig: {
    queries: {
      suspense: true,
    },
  },
});

function App() {
  const theme = React.useMemo(() => {
    const nextTheme = createTheme({
      palette: {
        background: { default: '#121212' },
        primary: {
          main: colors.amber['300'],
        },
        secondary: {
          main: colors.teal['300'],
        },
        mode: 'dark',
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
          styleOverrides: {
            sizeSmall: {
              // Adjust spacing to reach minimal touch target hitbox
              marginLeft: 4,
              marginRight: 4,
              padding: 12,
            },
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
      typography: {
        h1: {
          fontSize: '1.4rem',
        },
        h2: {
          fontSize: '1.2rem',
        },
        h3: {
          fontSize: '1.15rem',
        },
        h4: {
          fontSize: '1.1rem',
        },
        h5: {
          fontSize: '1.0rem',
        },
        h6: {
          fontSize: '1.0rem',
        },
      },
    });

    return nextTheme;
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ReactQueryCacheProvider queryCache={suspenseQueryCache}>
        <div>
          <BrowserRouter>
            <Routes>
              <Route
                path="/"
                element={
                  <React.Suspense fallback={<div>Loading...</div>}>
                    <Landing />
                  </React.Suspense>
                }
              />
              <Route
                path="/size-comparison"
                element={
                  <React.Suspense fallback={<div>Loading...</div>}>
                    <SizeComparison />
                  </React.Suspense>
                }
              />
            </Routes>
          </BrowserRouter>
        </div>
      </ReactQueryCacheProvider>
    </ThemeProvider>
  );
}

export default App;
