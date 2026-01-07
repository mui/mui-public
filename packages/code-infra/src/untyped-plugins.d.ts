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

declare module '@babel/plugin-transform-object-rest-spread' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module '@babel/plugin-transform-react-pure-annotations' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module '@babel/plugin-transform-runtime' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module '@babel/plugin-syntax-jsx' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module '@babel/plugin-syntax-typescript' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module 'babel-plugin-optimize-clsx' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module 'babel-plugin-transform-react-remove-prop-types' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module 'babel-plugin-transform-inline-environment-variables' {
  import type { PluginItem } from '@babel/core';

  declare const plugin: PluginItem;
  export default plugin;
}

declare module '@babel/preset-react' {
  import type { PluginItem } from '@babel/core';

  export type Options = {
    runtime: 'string';
  };

  declare const preset: PluginItem;
  export default preset;
}

declare module '@babel/preset-typescript' {
  import type { PluginItem } from '@babel/core';

  declare const preset: PluginItem;
  export default preset;
}

declare module 'stylelint-config-standard' {
  import type { Config } from 'stylelint';

  declare const configExtends: Config['extends'];
  export default configExtends;
}
declare module 'postcss-styled-syntax' {
  import type { Syntax } from 'postcss';

  declare const syntax: Syntax;
  export default syntax;
}
