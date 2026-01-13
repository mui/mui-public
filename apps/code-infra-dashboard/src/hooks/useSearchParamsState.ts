'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Configuration for a single search parameter.
 */
export interface ParamConfig<T> {
  defaultValue: T;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
}

/**
 * Codec for number values.
 */
export const CODEC_NUMBER = {
  serialize: (value: number): string => String(value),
  deserialize: (value: string): number => Number(value),
};

/**
 * Codec for dayjs date values (YYYY-MM-DD format, UTC).
 */
export const CODEC_DAYJS_DATE = {
  serialize: (value: Dayjs): string => value.format('YYYY-MM-DD'),
  deserialize: (value: string): Dayjs => dayjs.utc(value),
};

/**
 * Codec for string array values (comma-separated).
 */
export const CODEC_STRING_ARRAY = {
  serialize: (value: string[]): string => value.join(','),
  deserialize: (value: string): string[] => value.split(',').filter(Boolean),
};

/**
 * Options for setState calls.
 */
export interface SetStateOptions {
  replace?: boolean;
  scroll?: boolean;
}

/**
 * SetState function type with functional update support.
 */
type SetState<S> = (
  updates: Partial<S> | ((prev: S) => Partial<S>),
  options?: SetStateOptions,
) => void;

/**
 * Hook options.
 */
export interface UseSearchParamsStateOptions {
  replace?: boolean;
  scroll?: boolean;
}

/**
 * A hook that syncs multiple search parameters with React state.
 *
 * @example
 * const [params, setParams] = useSearchParamsState({
 *   page: { defaultValue: 1, ...CODEC_NUMBER },
 *   query: { defaultValue: '' },
 *   tags: { defaultValue: [] as string[], ...CODEC_STRING_ARRAY },
 * });
 *
 * // Read values
 * params.page // number
 * params.query // string
 * params.tags // string[]
 *
 * // Update single or multiple params
 * setParams({ page: 2 });
 * setParams({ query: 'search', tags: ['a', 'b'] });
 *
 * // Functional updates
 * setParams(prev => ({ page: prev.page + 1 }));
 */
export function useSearchParamsState<C extends {}>(
  config: { [K in keyof C]: ParamConfig<C[K]> },
  defaultOptions?: UseSearchParamsStateOptions,
): [C, SetState<C>] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Track previous state to preserve value references
  const prevStateRef = React.useRef<C | null>(null);

  // Build state from URL params
  const state = React.useMemo(() => {
    const result = {} as C;
    const prevState = prevStateRef.current;

    for (const key of Object.keys(config) as Array<keyof C>) {
      const paramConfig = config[key];
      const paramValue = searchParams.get(key as string);

      let newValue: C[keyof C];
      if (paramValue === null) {
        newValue = paramConfig.defaultValue;
      } else {
        const deserialize = paramConfig.deserialize ?? ((v: string) => v);
        newValue = deserialize(paramValue) as C[keyof C];
      }

      // Reuse previous value if serialized representation is the same
      if (prevState !== null) {
        const serialize = paramConfig.serialize ?? String;
        const prevValue = prevState[key];
        if (serialize(prevValue) === serialize(newValue)) {
          (result as Record<string, unknown>)[key as string] = prevValue;
          continue;
        }
      }

      (result as Record<string, unknown>)[key as string] = newValue;
    }

    prevStateRef.current = result;
    return result;
  }, [config, searchParams]);

  // Update multiple params at once
  const setState: SetState<C> = React.useCallback(
    (updates, options) => {
      // Support functional updates
      const resolvedUpdates = typeof updates === 'function' ? updates(state) : updates;

      const newParams = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(resolvedUpdates)) {
        const paramConfig = config[key as keyof C];
        if (!paramConfig) {
          continue;
        }

        const serialize = paramConfig.serialize ?? String;
        const serialized = serialize(value as never);
        const defaultSerialized = serialize(paramConfig.defaultValue as never);

        if (serialized === defaultSerialized) {
          newParams.delete(key);
        } else {
          newParams.set(key, serialized);
        }
      }

      const newUrl = newParams.toString() ? `${pathname}?${newParams.toString()}` : pathname;

      const shouldReplace = options?.replace ?? defaultOptions?.replace ?? false;
      const shouldScroll = options?.scroll ?? defaultOptions?.scroll ?? false;

      if (shouldReplace) {
        router.replace(newUrl, { scroll: shouldScroll });
      } else {
        router.push(newUrl, { scroll: shouldScroll });
      }
    },
    [config, searchParams, pathname, router, defaultOptions, state],
  );

  return [state, setState];
}
