# MUI Public

Mono-repository for the MUI organization with code that can be public.\
See https://github.com/mui/mui-private for code that needs to be private.

## Documentation

You can [read the Infra documentation here](./docs/README.md).

## Applications

### Frontend Public

- URL: [frontend-public.mui.com](https://frontend-public.mui.com/)
- Source: `/apps/code-infra-dashboard/`
- Hosting: https://dashboard.render.com/web/srv-d5fq2j0gjchc73e9st5g
- [Docs](./apps/code-infra-dashboard/#readme)

### Tools Public

⚠️ Deprecated. Use **Frontend Public** instead.

- URL: [tools-public.mui.com](https://tools-public.mui.com/)
- Source: `/apps/tools-public/`
- Hosting: https://dashboard.render.com/web/srv-d08mooq4d50c73fso49g
- [Docs](./apps/tools-public/#readme)
- Internal public Toolpad apps that run the operations of MUI, built using https://github.com/mui/toolpad.

### MUI Internal

- URL: [mui-internal.netlify.app](https://mui-internal.netlify.app)
- Source: `/docs/`
- Hosting: https://app.netlify.com/projects/mui-internal/overview
- [Docs](./docs/#readme)
- Website for MUI internal packages, e.g. hosts docs-infra.
  This is equivalent to https://backoffice.mui.com/ but for public logic.

## Packages

### [docs-infra](./packages/docs-infra/)

- Source: `/packages/docs-infra/`
- [Docs](./packages/docs-infra/README.md)

### [code-infra](./packages/code-infra/)

- Source: `/packages/code-infra/`
- [Docs](./packages/code-infra/README.md)

## Versioning

Steps:

1. Checkout latest master
1. Run `pnpm release:prepare`
1. Run `pnpm release:version`
1. Open PR with the changes

## Publishing

Steps:

1. Merge versioning PR
1. Checkout release commit on master
1. Run `pnpm release:prepare`
1. Run `pnpm release:publish`
