import * as React from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import Container from '@mui/material/Container';
import * as colors from '@mui/material/colors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useSearchParams,
  Link as RouterLink,
} from 'react-router';
import './index.css';

const Landing = React.lazy(() => import('./pages/Landing'));
const SizeComparison = React.lazy(() => import('./pages/SizeComparison'));
const RepositoryPRs = React.lazy(() => import('./pages/RepositoryPRs'));
const RepositoryPR = React.lazy(() => import('./pages/RepositoryPR'));
const RepositoryCharts = React.lazy(() => import('./pages/RepositoryCharts'));
const NpmVersions = React.lazy(() => import('./pages/NpmVersions'));
const DiffPackage = React.lazy(() => import('./pages/DiffPackage'));

// Redirect component for size comparison with query params
function SizeComparisonRedirect() {
  const [params] = useSearchParams();

  // remove the default when https://github.com/mui/material-ui/pull/45911 is merged for longer than e.g. 1 month
  const repo = params.get('repo') || 'mui/material-ui';

  // Check if we have the essential repo parameter
  if (repo) {
    // Split repo into owner/repo parts
    const [owner, repoName] = repo.split('/');

    // Preserve all query params for the redirect
    const newParams = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      if (key !== 'repo') {
        newParams.append(key, value);
      }
    }

    // Build the new URL with path parameters
    const queryString = newParams.toString() ? `?${newParams.toString()}` : '';
    const newPath = `/size-comparison/${owner}/${repoName}/diff${queryString}`;

    return <Navigate to={newPath} replace />;
  }

  // If we don't have the required params, show an error
  return (
    <div style={{ padding: '2rem', color: 'red' }}>
      <h2>Error: Missing Parameters</h2>
      <p>This page requires the &quot;repo&quot; parameter.</p>
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
      <CssBaseline enableColorScheme />
      <QueryClientProvider client={queryClient}>
        <div>
          <BrowserRouter>
            <Container maxWidth="xl" sx={{ py: 2 }}>
              <Link component={RouterLink} to="/" sx={{ textDecoration: 'none', color: 'inherit' }}>
                <Typography variant="h6" component="h1" sx={{ mb: 4 }}>
                  Code infra dashboard
                </Typography>
              </Link>
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
                  path="/size-comparison/:owner/:repo/diff"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <SizeComparison />
                    </React.Suspense>
                  }
                />
                <Route
                  path="/repository/:owner/:repo/prs"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <RepositoryPRs />
                    </React.Suspense>
                  }
                />
                <Route
                  path="/repository/:owner/:repo/prs/:prNumber"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <RepositoryPR />
                    </React.Suspense>
                  }
                />
                <Route
                  path="/repository/:owner/:repo/bundle-size"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <RepositoryCharts />
                    </React.Suspense>
                  }
                />
                <Route
                  path="/npm-versions"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <NpmVersions />
                    </React.Suspense>
                  }
                />
                <Route
                  path="/diff-package"
                  element={
                    <React.Suspense fallback={<div>Loading...</div>}>
                      <DiffPackage />
                    </React.Suspense>
                  }
                />
              </Routes>
            </Container>
          </BrowserRouter>
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
