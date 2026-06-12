# @babel-plugin-display-name

Forked from: https://github.com/zendesk/babel-plugin-react-displayname

## What it does

This plugin converts the following:

```tsx
const Linebreak = React.memo(() => {
  return <br />;
});

const Img = function () {
  return <img />;
};
```

into:

```tsx
const Linebreak = React.memo(function _Linebreak() {
  return <br />;
});
Linebreak.displayName = 'Linebreak';

const Img = function () {
  return <img />;
};
Img.displayName = 'Img';
```

## Options

### `allowedCallees`

`Object.<string, string[]>`, defaults to `{ "react": ["createContext"] }`

Enables generation of displayNames for certain called functions.

```json
{
  "plugins": [
    "@probablyup/babel-plugin-react-displayname",
    {
      "allowedCallees": {
        "react": ["createComponent"]
      }
    }
  ]
}
```

## Related ESLint rule

When a project compiles with this plugin, the `mui/material-ui-name-matches-component-name` rule
(in `@mui/internal-code-infra`) can be configured with `{ babelDisplayNamePlugin: true }`. This lets
`forwardRef`/`memo` components use an anonymous or arrow render function (avoiding `no-shadow`) while
still validating their theming `name` against the variable name that this plugin uses for the injected
`displayName`.
