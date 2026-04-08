# Blog Publisher

This directory contains the standalone automation logic for generating and publishing blog posts.

## Local test

```bash
pnpm install
pnpm blog:publish:dry-run
```

To publish for real:

```bash
pnpm blog:publish
```

## Required environment variables

- `BLOG_AI_API_KEY`
- `BLOG_OSS_ACCESS_KEY_ID`
- `BLOG_OSS_ACCESS_KEY_SECRET`
- `BLOG_REVALIDATE_SECRET`

## Optional environment variables

- `SITE_BASE_URL`
- `BLOG_AI_BASE_URL`
- `BLOG_TEXT_MODEL`
- `BLOG_IMAGE_MODEL`
- `BLOG_OSS_BUCKET`
- `BLOG_OSS_ENDPOINT`
- `BLOG_OSS_PREFIX`
- `BLOG_MANIFEST_URL`
- `BLOG_PROJECT_ROOT`
- `BLOG_TIMEZONE`

## Workflow

The root workflow file `.github/workflows/daily-blog.yml` only acts as a thin runner for this directory.

For local testing, the script automatically loads:

- `.env.local`
- `.env`
