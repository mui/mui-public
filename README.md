# MUI Public

Mono-repository for the MUI organization with code that can be public.
See https://github.com/mui/mui-private for code that needs to be private.

## Applications

### [tools-public.mui.com](https://tools-public.mui.com/)

- Folder: `/apps/tools-public/`
- Hosting: https://dashboard.render.com/web/srv-d08mooq4d50c73fso49g
- [Docs](./apps/tools-public/#readme)

Internal public Toolpad apps that run the operations of MUI, built using https://github.com/mui/toolpad.

### [frontend-public.mui.com](https://frontend-public.mui.com/)

- Folder: `/apps/code-infra-dashboard/`
- Hosting: https://app.netlify.com/sites/mui-frontend-public/overview
- [Docs](./apps/code-infra-dashboard/#readme)

## Versioning

Steps:

1. Run `pnpm release:prepare`
1. Run `pnpm test`
1. Run `pnpm release:version`

## Publishing

Steps:

1. Run `pnpm release:prepare`
1. Run `pnpm test`
1. Run `pnpm release:publish`
