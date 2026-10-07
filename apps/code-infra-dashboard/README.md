# MUI contributor dashboard

[![Netlify Status](https://api.netlify.com/api/v1/badges/915f3a73-fea0-4248-b916-b7cff9364df1/deploy-status)](https://app.netlify.com/sites/mui-dashboard/deploys)

Collection of helpers useful when working on [MUI](https://github.com/mui).

## Contributing

Bugfixes and feature suggestions are greatly appreciated. Though this project is highly opinionated so feature requests from external contributors likely won't be accepted if no core member has a use for them.

```bash
pnpm install
pnpm -F @apps/code-infra-dashboard dev
```

## Careers API

`GET /api/mui-careers` returns `{ data: [...] }` from the [MUI Ashby job board](https://jobs.ashbyhq.com/MUI).
It uses Ashby's [public Job Postings API](https://developers.ashbyhq.com/docs/public-job-posting-api), so no API key is required.
Only postings with `isListed: true` are returned. Each job contains only these local careers fields:

| Field            | Content                                                        |
| :--------------- | :------------------------------------------------------------- |
| `id`             | Stable job ID for matching roles across syncs.                 |
| `title`          | Role title.                                                    |
| `category`       | Department for grouping roles, or `Other` when absent.         |
| `description`    | Full HTML description for generating the role page.            |
| `summary`        | Short plain-text summary, or an empty string when unavailable. |
| `applicationUrl` | Application link.                                              |

HTML descriptions retain an explicit attribute allowlist: `href`, `target`, `rel`, `src`, `alt`, `title`, `colspan`, `rowspan`, `scope`, `start`, `reversed`, `value`, `datetime`, `lang`, `dir`, `role`, `id`, and `aria-*`.
These preserve links, images, table and list semantics, anchors, and accessibility. Other attributes, including `style`, `class`, and all `data-*` attributes, are removed; markup and text are preserved.
The public Ashby API does not expose the short summary, so `summary` currently returns `""`.
Upstream metadata and the duplicate plain-text description are omitted.

This endpoint is intended for the docs repository's careers sync, alongside `/api/mui-about` for team members.
Successful responses set `Cache-Control: public, max-age=600` for a ten-minute cache lifetime.
Requests reaching the endpoint fetch fresh data with a 10-second timeout. Errors set `Cache-Control: no-store`. Upstream failures or malformed responses return HTTP 502 with `{ error: "Failed to fetch published jobs from Ashby" }`, rather than an empty jobs list.
A successful `{ data: [] }` response means there are no listed postings.
