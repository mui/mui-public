import consistentProductionGuard from './rules/consistent-production-guard.mjs';
import disallowActiveElementAsKeyEventTarget from './rules/disallow-active-element-as-key-event-target.mjs';
import disallowReactApiInServerComponents from './rules/disallow-react-api-in-server-components.mjs';
import docgenIgnoreBeforeComment from './rules/docgen-ignore-before-comment.mjs';
import muiNameMatchesComponentName from './rules/mui-name-matches-component-name.mjs';
import noEmptyBox from './rules/no-empty-box.mjs';
import noRestrictedResolvedImports from './rules/no-restricted-resolved-imports.mjs';
import noStyledBox from './rules/no-styled-box.mjs';
import requireDevWrapper from './rules/require-dev-wrapper.mjs';
import rulesOfUseThemeVariants from './rules/rules-of-use-theme-variants.mjs';
import straightQuotes from './rules/straight-quotes.mjs';

export default /** @type {import('eslint').ESLint.Plugin} */ ({
  meta: {
    name: '@mui/eslint-plugin-material-ui',
    version: '0.1.0',
  },
  rules: {
    'consistent-production-guard': consistentProductionGuard,
    'disallow-active-element-as-key-event-target': disallowActiveElementAsKeyEventTarget,
    'docgen-ignore-before-comment': docgenIgnoreBeforeComment,
    'mui-name-matches-component-name': muiNameMatchesComponentName,
    'rules-of-use-theme-variants': rulesOfUseThemeVariants,
    'no-empty-box': noEmptyBox,
    'no-styled-box': noStyledBox,
    'straight-quotes': straightQuotes,
    'disallow-react-api-in-server-components': disallowReactApiInServerComponents,
    'no-restricted-resolved-imports': noRestrictedResolvedImports,
    'require-dev-wrapper': requireDevWrapper,
  },
});
