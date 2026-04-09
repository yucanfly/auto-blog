# Blog Publisher

This directory contains the standalone automation logic for generating and publishing blog posts.

For full architecture and flow documentation, see:

- [docs/BLOG_AUTOMATION_ARCHITECTURE.md](/Users/yu/工作代码/collabGrow-web/automation/blog-publisher/docs/BLOG_AUTOMATION_ARCHITECTURE.md)

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
- `BLOG_SEARCH_CONSOLE_PROPERTY`
- `BLOG_SEARCH_CONSOLE_CREDENTIAL_JSON`
- `BLOG_SEARCH_CONSOLE_LOOKBACK_DAYS`
- `BLOG_SEARCH_CONSOLE_EXPORT_PATH`
- `BLOG_CURRENTS_API_KEY`
- `BLOG_GNEWS_API_KEY`
- `BLOG_TREND_LOOKBACK_HOURS`
- `BLOG_TREND_LANG`
- `BLOG_TREND_COUNTRY`
- `BLOG_DINGTALK_WEBHOOK`
- `BLOG_DINGTALK_SECRET`

## Workflow

The root workflow file `.github/workflows/daily-blog.yml` only acts as a thin runner for this directory.

For local testing, the script automatically loads:

- `.env.local`
- `.env`

## V1.5 topic engine

The publisher now uses a four-layer topic system instead of a fixed random topic list:

- `core_editorial`
- `tool_problem`
- `controlled_programmatic`
- `trend_linked`

The topic engine is driven by these data files:

- `data/topic-library.json`
- `data/programmatic-library.json`
- `data/query-rules.json`
- `data/scoring-rules.json`
- `data/internal-linking-rules.json`
- `data/tone-rules.json`

V1.5 also adds:

- template-aware programmatic topics such as `brand_review`, `brand_fit`, `email_pattern`, and `creator_scenario`
- tone constraints to reduce AI-sounding, salesy, or SEO-template writing
- softer CTA behavior by default, with strong CTAs reserved for a smaller subset of high-intent topics

## V2 query signal layer

V2 now treats Google Search Console as a first-class query source instead of a debug-only add-on.

- Search Console queries are filtered before they can influence topic selection.
- Brand terms, test terms, and low-value legacy directions are excluded.
- Queries need enough impressions and enough creator-business relevance to become candidates.
- The publisher rewrites raw queries into cleaner creator-facing article angles instead of drafting directly from keyword fragments.
- Search Console signals are blended into the normal scoring system rather than overriding the topic engine.

Recommended production settings:

- `BLOG_SEARCH_CONSOLE_PROPERTY=https://collabgrow.lgi365.com`
- `BLOG_SEARCH_CONSOLE_CREDENTIAL_JSON=<service account json>`

## V3 trend signal layer

V3 adds two external news sources and treats them as lightweight trend signals rather than article source material.

- Currents API
- GNews API

The publisher normalizes both source formats into one internal structure, filters them against creator-business relevance, and only then turns the strongest signals into `trend_linked` candidates.

Recommended production settings:

- `BLOG_CURRENTS_API_KEY=<currents api key>`
- `BLOG_GNEWS_API_KEY=<gnews api key>`
- `BLOG_TREND_LOOKBACK_HOURS=72`
- `BLOG_TREND_LANG=en`
- `BLOG_TREND_COUNTRY=us`

## DingTalk notification

The publisher can send a Chinese markdown summary to a DingTalk robot webhook after every run.

- success: sends publish result, URLs, step status, and content summary
- dry-run: sends generation result without publish URLs
- failure: sends failed step, error summary, and troubleshooting links

Recommended production setting:

- `BLOG_DINGTALK_WEBHOOK=<dingtalk webhook url>`
- `BLOG_DINGTALK_SECRET=<dingtalk robot signing secret>`

The script keeps local state in:

- `.data/publish-log.json`
- `.data/topic-ledger.json`

## Useful local flags

Force a dry-run for a specific layer:

```bash
pnpm blog:publish:dry-run -- --layer core_editorial
pnpm blog:publish:dry-run -- --layer controlled_programmatic
```

Force a topic:

```bash
pnpm blog:publish:dry-run -- --topic "How creators should score inbound brand deals"
```

Force a product mapping:

```bash
pnpm blog:publish:dry-run -- --product deal_hunter
pnpm blog:publish:dry-run -- --product email_decoder
pnpm blog:publish:dry-run -- --product brand_analyze
```
