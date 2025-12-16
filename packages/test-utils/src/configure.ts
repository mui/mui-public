export interface Configuration {
  /**
   * The emotion wrapper is optional.
   * If your repository uses emotion, install `@emotion/react` and `@emotion/cache` and set this to true.
   */
  emotion: boolean;
}

const defaultConfig: Configuration = {
  emotion: false,
};

export const config: Configuration = { ...defaultConfig };

export function configure(newConfig: Partial<Configuration> = {}): void {
  Object.assign(config, newConfig);
}
