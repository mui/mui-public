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
 * Extract the value type from a ParamConfig.
 */
type ValueOf<C extends ParamConfig<unknown>> = C['defaultValue'];

/**
 * Map a config object to its state type.
 */
type StateFromConfig<C extends Record<string, ParamConfig<unknown>>> = {
  [K in keyof C]: ValueOf<C[K]>;
};

/**
 * SetState function type with functional update support.
 */
type SetState<S> = (
  updates: Partial<S> | ((prev: S) => Partial<S>),
  options?: SetStateOptions
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
export function useSearchParamsState<C extends Record<string, ParamConfig<unknown>>>(
  config: C,
  defaultOptions?: UseSearchParamsStateOptions
): [StateFromConfig<C>, SetState<StateFromConfig<C>>] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Memoize config to avoid unnecessary recalculations
  const configRef = React.useRef(config);
  configRef.current = config;

  // Build state from URL params
  const state = React.useMemo(() => {
    const result = {} as StateFromConfig<C>;
    for (const key of Object.keys(configRef.current) as Array<keyof C>) {
      const paramConfig = configRef.current[key];
      const paramValue = searchParams.get(key as string);

      if (paramValue === null) {
        (result as Record<string, unknown>)[key as string] = paramConfig.defaultValue;
      } else {
        const deserialize = paramConfig.deserialize ?? ((v: string) => v);
        (result as Record<string, unknown>)[key as string] = deserialize(paramValue);
      }
    }
    return result;
  }, [searchParams]);

  // Update multiple params at once
  const setState: SetState<StateFromConfig<C>> = React.useCallback(
    (updates, options) => {
      const currentConfig = configRef.current;

      // Support functional updates
      const resolvedUpdates =
        typeof updates === 'function'
          ? updates(state)
          : updates;

      const newParams = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(resolvedUpdates)) {
        const paramConfig = currentConfig[key as keyof C];
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

      const newUrl = newParams.toString()
        ? `${pathname}?${newParams.toString()}`
        : pathname;

      const shouldReplace = options?.replace ?? defaultOptions?.replace ?? false;
      const shouldScroll = options?.scroll ?? defaultOptions?.scroll ?? false;

      if (shouldReplace) {
        router.replace(newUrl, { scroll: shouldScroll });
      } else {
        router.push(newUrl, { scroll: shouldScroll });
      }
    },
    [searchParams, pathname, router, defaultOptions, state]
  );

  return [state, setState];
}
