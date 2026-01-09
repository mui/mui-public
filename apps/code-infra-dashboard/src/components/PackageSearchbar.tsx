'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { fetchNpmPackageSearch } from '../lib/npm';

interface PackageSearchbarBaseProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

interface SingleSelectProps extends PackageSearchbarBaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
}

interface MultiSelectProps extends PackageSearchbarBaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

export type PackageSearchbarProps = SingleSelectProps | MultiSelectProps;

export default function PackageSearchbar(props: PackageSearchbarProps) {
  const {
    inputValue,
    onInputChange,
    placeholder = 'Search for packages...',
    label = 'Package name',
    multiple = false,
  } = props;

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

  if (multiple) {
    const multiProps = props as MultiSelectProps;
    return (
      <Autocomplete
        multiple
        value={multiProps.value}
        onChange={(event, newValue) => {
          const packages = newValue.map((v) => (typeof v === 'string' ? v.trim() : v.name.trim()));
          multiProps.onChange(packages);
        }}
        inputValue={inputValue}
        onInputChange={(event, newValue) => onInputChange(newValue)}
        options={searchResults}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
        loading={isSearching}
        loadingText="Searching packages..."
        noOptionsText="Type to search for packages"
        freeSolo
        filterOptions={(x) => x}
        filterSelectedOptions
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
          const { key, ...rest } = optionProps;
          return (
            <Box component="li" key={key} {...rest}>
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

  const singleProps = props as SingleSelectProps;
  return (
    <Autocomplete
      value={null}
      onChange={(event, newValue) => {
        let packageName: string | null = null;
        if (typeof newValue === 'string') {
          packageName = newValue.trim() || null;
        } else if (newValue && newValue.name) {
          packageName = newValue.name.trim();
        }
        singleProps.onChange(packageName);
      }}
      inputValue={inputValue}
      onInputChange={(event, newValue) => onInputChange(newValue)}
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
      onBlur={(_event) => {
        singleProps.onChange(inputValue.trim() || null);
      }}
      renderOption={(optionProps, option) => {
        const { key, ...rest } = optionProps;
        return (
          <Box component="li" key={key} {...rest}>
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
