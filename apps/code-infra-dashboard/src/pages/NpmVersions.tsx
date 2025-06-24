import * as React from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Heading from '../components/Heading';
import NpmVersionBreakdown from '../components/NpmVersionBreakdown';
import {
  fetchNpmPackageSearch,
  fetchNpmPackageDetails,
  fetchNpmPackageVersions,
  Package,
} from '../lib/npm';

export default function NpmVersions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const packageParam = searchParams.get('package');
  const versionParam = searchParams.get('version');

  const [inputValue, setInputValue] = React.useState(packageParam || '');
  const [searchQuery, setSearchQuery] = React.useState('');

  const {
    data: searchResults = [],
    isLoading: isSearching,
    error: searchError,
  } = useQuery({
    queryKey: ['npmPackageSearch', searchQuery],
    queryFn: () => fetchNpmPackageSearch(searchQuery),
    enabled: !!searchQuery.trim(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const {
    data: packageDetails = null,
    isLoading: isLoadingDetails,
    error: detailsError,
  } = useQuery({
    queryKey: ['npmPackageDetails', packageParam],
    queryFn: () => fetchNpmPackageDetails(packageParam!),
    enabled: !!packageParam,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const {
    data: versions = {},
    isLoading: isLoadingVersions,
    error: versionsError,
  } = useQuery({
    queryKey: ['npmPackageVersions', packageParam],
    queryFn: () => fetchNpmPackageVersions(packageParam!),
    enabled: !!packageParam,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Update input value when package parameter changes
  React.useEffect(() => {
    if (packageParam) {
      setInputValue(packageParam);
    }
  }, [packageParam]);

  const handlePackageSelect = (event: React.SyntheticEvent, value: Package | null) => {
    if (value) {
      // Reset version when switching packages
      setSearchParams({ package: value.name });
    } else {
      setSearchParams({});
    }
  };

  const handleVersionChange = (version: string | null) => {
    if (!packageParam) {
      return;
    }

    const newParams: Record<string, string> = { package: packageParam };
    if (version) {
      newParams.version = version;
    }
    setSearchParams(newParams);
  };

  const handleInputChange = (event: React.SyntheticEvent, value: string) => {
    setInputValue(value);
    if (value.length > 2) {
      setSearchQuery(value);
    } else {
      setSearchQuery('');
    }
  };

  return (
    <React.Fragment>
      <Heading level={1}>npm Package Version Breakdown</Heading>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Search for an npm package
        </Typography>

        <Autocomplete
          value={packageDetails}
          onChange={handlePackageSelect}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          options={searchResults}
          getOptionLabel={(option) => option.name}
          loading={isSearching}
          loadingText="Searching packages..."
          noOptionsText="Type to search for packages"
          filterOptions={(x) => x} // Disable client-side filtering since we use server search
          renderInput={(params) => (
            <TextField
              {...params}
              label="Package name"
              placeholder="e.g., react, lodash, express"
              variant="outlined"
              fullWidth
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <React.Fragment>
                    {isSearching ? <CircularProgress color="inherit" size={20} /> : null}
                    {params.InputProps.endAdornment}
                  </React.Fragment>
                ),
              }}
            />
          )}
          renderOption={(props, option) => (
            <Box component="li" {...props}>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body1" component="div">
                  {option.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" component="div">
                  {option.description}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  Latest: v{option.version} • by {option.author}
                </Typography>
              </Box>
            </Box>
          )}
          sx={{ mb: 2 }}
        />

        {searchError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Search Error: {searchError.message}
          </Alert>
        )}
      </Paper>

      {/* Package Details and Version Breakdown */}
      {(packageDetails || isLoadingDetails) && (
        <Paper sx={{ p: 3 }}>
          {/* Package Details Section */}
          {packageDetails && (
            <React.Fragment>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  mb: 2,
                }}
              >
                <Typography variant="h3">{packageDetails.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  Latest: v{packageDetails.version}
                </Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Author: {packageDetails.author}
              </Typography>

              <Typography variant="body1" color="text.secondary" paragraph>
                {packageDetails.description}
              </Typography>
            </React.Fragment>
          )}

          {/* Loading State */}
          {(isLoadingDetails || isLoadingVersions) && (
            <React.Fragment>
              <Skeleton variant="text" width="60%" height={40} />
              <Skeleton variant="rectangular" height={400} />
            </React.Fragment>
          )}

          {/* Version Breakdown */}
          {packageDetails && versions && !isLoadingDetails && !isLoadingVersions && (
            <NpmVersionBreakdown
              packageData={{ ...packageDetails, versions }}
              selectedVersion={versionParam}
              onVersionChange={handleVersionChange}
            />
          )}
        </Paper>
      )}

      {/* Error State */}
      {(detailsError || versionsError) && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {detailsError && `Package Details Error: ${detailsError.message}`}
          {versionsError && `Versions Error: ${versionsError.message}`}
        </Alert>
      )}

      {/* Empty State */}
      {!packageDetails && !isLoadingDetails && (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h5" color="text.secondary" gutterBottom>
            Search for an npm package to view its download statistics
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Explore download distributions by major/minor versions and click pie chart slices to
            drill down
          </Typography>
        </Paper>
      )}
    </React.Fragment>
  );
}
