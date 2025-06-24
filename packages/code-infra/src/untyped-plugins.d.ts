declare module 'eslint-config-airbnb-base' {
  import type { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb' {
  import type { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/best-practices' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/errors' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/es6' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/imports' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/node' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/strict' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/style' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb-base/rules/variables' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb/rules/react' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module 'eslint-config-airbnb/rules/react-a11y' {
  import { Linter } from 'eslint';

  declare const config: Omit<Linter.LegacyConfig, 'extends' | 'plugins'>;
  export default config;
}

declare module '@next/eslint-plugin-next' {
  import { Linter } from 'eslint';

  interface NextEslintPluginConfig extends Linter.LegacyConfig {
    flatConfig: {
      recommended: Linter.Config;
    };
  }

  declare const config: NextEslintPluginConfig;
  export default config;
}
