import * as React from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Heading from '../components/Heading';
import NpmVersionBreakdown from '../components/NpmVersionBreakdown';
import { fetchNpmPackageSearch, SearchResult } from '../lib/npm';

export default function NpmVersions() {
  const [searchParams, setSearchParams] = useSearchParams();
  const packageParam = searchParams.get('package');
  const versionParam = searchParams.get('version');

  const [inputValue, setInputValue] = React.useState(packageParam || '');
  const searchQuery = inputValue.length > 2 ? inputValue : '';

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

  React.useEffect(() => {
    if (searchError) {
      // TODO: Handle search error gracefully, make Autocomplete show error state
      console.error('Error fetching npm package search results:', searchError);
    }
  }, [searchError]);

  // Update input value when package parameter changes
  React.useEffect(() => {
    if (packageParam) {
      setInputValue(packageParam);
    }
  }, [packageParam]);

  const handlePackageSelect = (
    event: React.SyntheticEvent,
    value: SearchResult | string | null,
  ) => {
    setSearchParams((params) => {
      const newParams = new URLSearchParams(params);
      let packageName = null;
      if (typeof value === 'string') {
        packageName = value.trim();
      } else if (value && value.name) {
        packageName = value.name.trim();
      }
      if (!packageName) {
        newParams.delete('package');
      } else {
        newParams.set('package', packageName);
      }
      newParams.delete('version'); // Clear version when package changes
      return newParams;
    });
  };

  const handleVersionChange = (version: string | null) => {
    setSearchParams((params) => {
      const newParams = new URLSearchParams(params);
      if (version) {
        newParams.set('version', version);
      } else {
        newParams.delete('version');
      }
      return newParams;
    });
  };

  return (
    <React.Fragment>
      <Heading level={1}>npm Package Version Breakdown</Heading>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Search for an npm package
        </Typography>

        <Autocomplete
          value={null}
          onChange={handlePackageSelect}
          inputValue={inputValue}
          onInputChange={(event, value) => {
            setInputValue(value);
          }}
          options={searchResults}
          getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
          loading={isSearching}
          loadingText="Searching packages..."
          noOptionsText="Type to search for packages"
          freeSolo
          filterOptions={(x) => x} // Disable client-side filtering since we use server search
          renderInput={(params) => (
            <TextField
              {...params}
              label="Package name"
              placeholder="e.g., react, lodash, express"
              variant="outlined"
              fullWidth
              slotProps={{
                input: {
                  ...params.InputProps,
                  endAdornment: (
                    <React.Fragment>
                      {isSearching ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </React.Fragment>
                  ),
                },
              }}
            />
          )}
          onBlur={(event) => {
            handlePackageSelect(event, inputValue.trim() || null);
          }}
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
      </Paper>

      {/* Package Details and Version Breakdown */}
      {packageParam && (
        <Paper sx={{ p: 3 }}>
          <NpmVersionBreakdown
            packageName={packageParam}
            selectedVersion={versionParam}
            onVersionChange={handleVersionChange}
          />
        </Paper>
      )}

      {/* Empty State */}
      {!packageParam && (
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
