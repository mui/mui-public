import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import * as colors from '@mui/material/colors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router';
import './index.css';

const Landing = React.lazy(() => import('./pages/Landing'));
const SizeComparison = React.lazy(() => import('./pages/SizeComparison'));
const RepositoryPRs = React.lazy(() => import('./pages/RepositoryPRs'));

// Redirect component for size comparison with query params
function SizeComparisonRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  // remove the default when https://github.com/mui/material-ui/pull/45911 is merged for longer than 1 month
  const repo = params.get('repo') || 'mui/material-ui';
  const prNumber = params.get('prNumber');

  // Check if we have the essential path parameters
  if (repo && prNumber) {
    // Split repo into owner/repo parts
    const [owner, repoName] = repo.split('/');

    // Preserve all other query params for the redirect
    const otherParams = new URLSearchParams();
    const circleCIBuildNumber = params.get('circleCIBuildNumber');
    if (circleCIBuildNumber) {
      otherParams.append('circleCIBuildNumber', circleCIBuildNumber);
    }

    // Build the new URL with path parameters
    const queryString = otherParams.toString() ? `?${otherParams.toString()}` : '';
    const newPath = `/size-comparison/${owner}/${repoName}/${prNumber}${queryString}`;

    return <Navigate to={newPath} replace />;
  }

  // If we don't have the required params, show an error
  return (
    <div style={{ padding: '2rem', color: 'red' }}>
      <h2>Error: Missing Parameters</h2>
      <p>This page requires both &quot;repo&quot; and &quot;prNumber&quot; parameters.</p>
      <p>Example: /size-comparison?repo=mui/material-ui&prNumber=1234</p>
    </div>
  );
}

// In TanStack Query v5+, suspense is no longer specified in defaultOptions
const queryClient = new QueryClient();

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
      <QueryClientProvider client={queryClient}>
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
              <Route path="/size-comparison" element={<SizeComparisonRedirect />} />
              <Route
                path="/size-comparison/:owner/:repo/:prNumber"
                element={
                  <React.Suspense fallback={<div>Loading...</div>}>
                    <SizeComparison />
                  </React.Suspense>
                }
              />
              <Route
                path="/size-comparison/:owner/:repo"
                element={
                  <React.Suspense fallback={<div>Loading...</div>}>
                    <RepositoryPRs />
                  </React.Suspense>
                }
              />
            </Routes>
          </BrowserRouter>
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
