'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import { fetchNpmPackageSearch } from '../lib/npm';

export interface PackageSearchbarProps {
  onPackageSelect: (packageName: string) => void;
  placeholder?: string;
  label?: string;
  sx?: SxProps<Theme>;
}

export default function PackageSearchbar(props: PackageSearchbarProps) {
  const {
    onPackageSelect,
    placeholder = 'Search for packages...',
    label = 'Package name',
    sx,
  } = props;

  const [inputValue, setInputValue] = React.useState('');

  const searchQuery = inputValue.length > 2 ? inputValue : '';

  const {
    data: searchResults = [],
    isLoading: isSearching,
    error: searchError,
  } = useQuery({
    queryKey: ['npmPackageSearch', searchQuery],
    queryFn: () => fetchNpmPackageSearch(searchQuery),
    enabled: !!searchQuery.trim(),
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (searchError) {
      console.error('Error fetching npm package search results:', searchError);
    }
  }, [searchError]);

  const handleChange = React.useCallback(
    (_event: React.SyntheticEvent, newValue: string | { name: string } | null) => {
      let packageName: string | null = null;
      if (typeof newValue === 'string') {
        packageName = newValue.trim() || null;
      } else if (newValue && newValue.name) {
        packageName = newValue.name.trim();
      }
      if (packageName) {
        onPackageSelect(packageName);
        setInputValue('');
      }
    },
    [onPackageSelect],
  );

  return (
    <Autocomplete
      sx={sx}
      value={null}
      onChange={handleChange}
      inputValue={inputValue}
      onInputChange={(_event, newValue) => setInputValue(newValue)}
      options={searchResults}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
      loading={isSearching}
      loadingText="Searching packages..."
      noOptionsText="Type to search for packages"
      freeSolo
      filterOptions={(x) => x}
      size="small"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
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
      renderOption={(optionProps, option) => {
        return (
          <Box component="li" {...optionProps}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="body1" component="div">
                {option.name}
              </Typography>
              <Typography variant="body2" color="text.secondary" component="div">
                {option.description}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                Latest: v{option.version} &bull; by {option.author}
              </Typography>
            </Box>
          </Box>
        );
      }}
    />
  );
}
