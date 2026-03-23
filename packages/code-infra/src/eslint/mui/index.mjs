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
import addUndefToOptional from './rules/add-undef-to-optional.mjs';
import flattenParentheses from './rules/flatten-parentheses.mjs';

/** @type {import('eslint').ESLint.Plugin} */
const muiPlugin = {
  meta: {
    name: '@mui/eslint-plugin',
    version: '0.1.0',
  },
  rules: {
    'consistent-production-guard': consistentProductionGuard,
    'disallow-active-element-as-key-event-target': disallowActiveElementAsKeyEventTarget,
    'docgen-ignore-before-comment': docgenIgnoreBeforeComment,
    'material-ui-name-matches-component-name': muiNameMatchesComponentName,
    'material-ui-rules-of-use-theme-variants': rulesOfUseThemeVariants,
    'material-ui-no-empty-box': noEmptyBox,
    'material-ui-no-styled-box': noStyledBox,
    'straight-quotes': straightQuotes,
    'disallow-react-api-in-server-components': disallowReactApiInServerComponents,
    'no-restricted-resolved-imports': noRestrictedResolvedImports,
    'require-dev-wrapper': requireDevWrapper,
    // Some discrepancies between TypeScript and ESLint types - casting to any
    'add-undef-to-optional': /** @type {any} */ (addUndefToOptional),
    'flatten-parentheses': /** @type {any} */ (flattenParentheses),
  },
};

export default muiPlugin;
