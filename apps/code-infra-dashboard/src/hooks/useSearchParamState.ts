'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';

const defaultSerialize = (value: string): string => value;
const defaultDeserialize = (value: string): string => value;

/**
 * Codec for number values.
 * @example
 * const [page, setPage] = useSearchParamState({
 *   key: 'page',
 *   defaultValue: 1,
 *   ...CODEC_NUMBER,
 * });
 */
export const CODEC_NUMBER = {
  serialize: (value: number): string => String(value),
  deserialize: (value: string): number => Number(value),
};

/**
 * Codec for dayjs date values (YYYY-MM-DD format).
 * @example
 * const [date, setDate] = useSearchParamState({
 *   key: 'date',
 *   defaultValue: dayjs(),
 *   ...CODEC_DAYJS,
 * });
 */
export const CODEC_DAYJS = {
  serialize: (value: Dayjs): string => value.format('YYYY-MM-DD'),
  deserialize: (value: string): Dayjs => dayjs(value),
};

/**
 * Codec for string array values (comma-separated).
 * @example
 * const [tags, setTags] = useSearchParamState({
 *   key: 'tags',
 *   defaultValue: [],
 *   ...CODEC_STRING_ARRAY,
 * });
 */
export const CODEC_STRING_ARRAY = {
  serialize: (value: string[]): string => value.join(','),
  deserialize: (value: string): string[] => value.split(',').filter(Boolean),
};

/**
 * Options for the setState function returned by useSearchParamState.
 */
export interface SetStateOptions {
  /** If true, replaces the current history entry instead of pushing a new one. */
  replace?: boolean;
  /** If true, scrolls to the top of the page after navigation. */
  scroll?: boolean;
}

/**
 * State setter function that updates both local state and URL search params.
 * Accepts either a new value or an updater function (like React's setState).
 */
export type SetState<T> = (value: T | ((prev: T) => T), options?: SetStateOptions) => void;

interface BaseOptions {
  /** The search parameter key to sync with. */
  key: string;
  /** If true, scrolls to top on URL change. Defaults to false. */
  scroll?: boolean;
  /** If true, replaces history entry instead of pushing. Defaults to true. */
  replace?: boolean;
}

/**
 * Options for useSearchParamState when working with string values.
 * Serialize and deserialize are optional since strings don't need conversion.
 */
export interface StringOptions extends BaseOptions {
  /** Default value when the search param is not present. */
  defaultValue: string;
  /** Optional function to serialize the value to a string. */
  serialize?: (value: string) => string;
  /** Optional function to deserialize the string to a value. */
  deserialize?: (value: string) => string;
}

/**
 * Options for useSearchParamState when working with non-string values.
 * Serialize and deserialize are required for type conversion.
 */
export interface NonStringOptions<T> extends BaseOptions {
  /** Default value when the search param is not present. */
  defaultValue: T;
  /** Function to serialize the value to a string for the URL. */
  serialize: (value: T) => string;
  /** Function to deserialize the string from the URL to a value. */
  deserialize: (value: string) => T;
}

/**
 * A hook that syncs React state with URL search parameters.
 *
 * @example
 * // Simple string value
 * const [query, setQuery] = useSearchParamState({
 *   key: 'q',
 *   defaultValue: '',
 * });
 *
 * @example
 * // Number value using CODEC_NUMBER
 * const [page, setPage] = useSearchParamState({
 *   key: 'page',
 *   defaultValue: 1,
 *   ...CODEC_NUMBER,
 * });
 *
 * @example
 * // Date value using CODEC_DAYJS
 * const [date, setDate] = useSearchParamState({
 *   key: 'from',
 *   defaultValue: dayjs(),
 *   ...CODEC_DAYJS,
 * });
 *
 * @example
 * // Array value using CODEC_STRING_ARRAY
 * const [tags, setTags] = useSearchParamState({
 *   key: 'tags',
 *   defaultValue: [],
 *   ...CODEC_STRING_ARRAY,
 * });
 */
export function useSearchParamState(options: StringOptions): [string, SetState<string>];
export function useSearchParamState<T>(options: NonStringOptions<T>): [T, SetState<T>];
export function useSearchParamState<T>(
  options: StringOptions | NonStringOptions<T>,
): [T, SetState<T>] {
  const {
    key,
    defaultValue,
    scroll: defaultScroll = false,
    replace: defaultReplace = true,
  } = options;

  const serialize = (options.serialize ?? defaultSerialize) as unknown as (value: T) => string;
  const deserialize = (options.deserialize ?? defaultDeserialize) as unknown as (
    value: string,
  ) => T;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const getValueFromParams = React.useCallback((): T => {
    const paramValue = searchParams.get(key);
    if (paramValue === null) {
      return defaultValue as T;
    }
    return deserialize(paramValue);
  }, [searchParams, key, defaultValue, deserialize]);

  const [value, setValueInternal] = React.useState<T>(getValueFromParams);

  const serializedDefault = React.useMemo(
    () => serialize(defaultValue as T),
    [serialize, defaultValue],
  );
  const currentSerialized = React.useMemo(() => serialize(value), [serialize, value]);

  React.useEffect(() => {
    const paramValue = searchParams.get(key);

    if (paramValue === null) {
      if (currentSerialized !== serializedDefault) {
        setValueInternal(defaultValue as T);
      }
    } else if (paramValue !== currentSerialized) {
      setValueInternal(deserialize(paramValue));
    }
  }, [
    searchParams,
    key,
    serialize,
    deserialize,
    defaultValue,
    serializedDefault,
    currentSerialized,
  ]);

  const setValue: SetState<T> = React.useCallback(
    (newValueOrUpdater, setStateOptions) => {
      const newValue =
        typeof newValueOrUpdater === 'function'
          ? (newValueOrUpdater as (prev: T) => T)(value)
          : newValueOrUpdater;

      setValueInternal(newValue);

      const serializedValue = serialize(newValue);
      const newParams = new URLSearchParams(searchParams.toString());

      if (serializedValue === serializedDefault) {
        newParams.delete(key);
      } else {
        newParams.set(key, serializedValue);
      }

      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname;

      const shouldReplace = setStateOptions?.replace ?? defaultReplace;
      const shouldScroll = setStateOptions?.scroll ?? defaultScroll;

      if (shouldReplace) {
        router.replace(newUrl, { scroll: shouldScroll });
      } else {
        router.push(newUrl, { scroll: shouldScroll });
      }
    },
    [
      value,
      serialize,
      searchParams,
      serializedDefault,
      key,
      pathname,
      defaultReplace,
      defaultScroll,
      router,
    ],
  );

  return [value, setValue];
}
