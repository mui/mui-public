interface Configuration {
  emotion: boolean;
}

const defaultConfig: Configuration = {
  emotion: false,
};

export const config: Configuration = defaultConfig;

export function configure(newConfig: Partial<Configuration> = {}): void {
  Object.assign(config, newConfig);
}
