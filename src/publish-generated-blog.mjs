import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import OSS from "ali-oss";

const DEFAULT_AI_BASE_URL = "https://yunwu.ai";
const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const DEFAULT_OSS_ENDPOINT = "oss-ap-southeast-1.aliyuncs.com";
const DEFAULT_OSS_BUCKET = "lgi-static";
const DEFAULT_OSS_PREFIX = "blog";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const DEFAULT_AUTHOR_NAME = "CollabGrow Team";
const DEFAULT_AUTHOR_AVATAR =
  "https://lgi-static.oss-ap-southeast-1.aliyuncs.com/2026/01/12/063bfbdccd884bc59d929a2c26b5cf0d-aiLogo.png";
const DEFAULT_TOPICS = [
  "How creators can qualify sponsorship emails faster without missing good deals",
  "A practical framework for scoring brand partnerships before you reply",
  "How agencies can standardize creator deal evaluation across the whole team",
  "What creators should check before accepting a paid collaboration",
  "How to spot risky sponsorship terms before they become expensive mistakes",
  "Why inbox triage is one of the highest-leverage systems for creator revenue",
  "How collaboration data helps creators negotiate with more confidence",
  "What a healthy creator-brand partnership looks like before a contract is signed",
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const automationRoot = path.resolve(scriptDir, "..");
const defaultProjectRoot = path.resolve(automationRoot, "../..");

function getLogTimestamp() {
  return new Date().toISOString();
}

function logStep(step, message, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[${getLogTimestamp()}] [${step}] ${message}${suffix}`);
}

function logError(step, error, details) {
  const message = error instanceof Error ? error.message : String(error);
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[${getLogTimestamp()}] [${step}] ${message}${suffix}`);
}

async function loadLocalEnvFiles() {
  const envFilePaths = [
    path.resolve(automationRoot, ".env.local"),
    path.resolve(automationRoot, ".env"),
  ];

  for (const envFilePath of envFilePaths) {
    let fileContent = "";
    try {
      fileContent = await fs.readFile(envFilePath, "utf8");
      logStep("ENV", "Loaded local env file", {
        file: path.relative(automationRoot, envFilePath) || path.basename(envFilePath),
      });
    } catch {
      continue;
    }

    for (const rawLine of fileContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const equalIndex = line.indexOf("=");
      if (equalIndex <= 0) continue;

      const key = line.slice(0, equalIndex).trim();
      const rawValue = line.slice(equalIndex + 1).trim();
      if (!key || process.env[key]) continue;

      process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
    }
  }
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    force: false,
    topic: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (value === "--force") {
      args.force = true;
      continue;
    }

    if (value === "--topic") {
      args.topic = String(argv[index + 1] || "").trim();
      index += 1;
    }
  }

  return args;
}

function readEnvFileValue(fileContent, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=\\s*['"]?([^\\n'"]+)['"]?\\s*$`, "m");
  const match = fileContent.match(pattern);
  return match?.[1]?.trim() || "";
}

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getProjectRoot() {
  return path.resolve(getEnv("BLOG_PROJECT_ROOT", defaultProjectRoot));
}

async function getSiteBaseUrl(projectRoot) {
  const directValue = String(
    process.env.SITE_BASE_URL || process.env.NUXT_PUBLIC_BASE_URL || "",
  ).trim();
  if (directValue) return normalizeBaseUrl(directValue);

  try {
    const envProdContent = await fs.readFile(
      path.resolve(projectRoot, ".env.prod"),
      "utf8",
    );
    const fileValue = readEnvFileValue(envProdContent, "NUXT_PUBLIC_BASE_URL");
    return normalizeBaseUrl(fileValue);
  } catch {
    return "";
  }
}

function formatDateParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((item) => item.type === "year")?.value || "1970";
  const month = parts.find((item) => item.type === "month")?.value || "01";
  const day = parts.find((item) => item.type === "day")?.value || "01";

  return {
    year,
    month,
    day,
    date: `${year}-${month}-${day}`,
  };
}

function slugify(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `blog-${Date.now()}`;
}

function getWordCount(markdown) {
  return String(markdown || "")
    .replace(/[`#>*_\-\[\]\(\)!]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function summarizeRecentPosts(posts, count = 12) {
  return posts.slice(0, count).map((post) => ({
    slug: post.slug,
    title: post.title,
    tags: post.tags || [],
  }));
}

function selectTopic(existingPosts, preferredTopic) {
  if (preferredTopic) return preferredTopic;

  const existingText = existingPosts
    .flatMap((post) => [post.title, post.slug, ...(post.tags || [])])
    .join(" ")
    .toLowerCase();

  return (
    DEFAULT_TOPICS.find((topic) => {
      const probe = slugify(topic).split("-").slice(0, 3).join(" ");
      return probe && !existingText.includes(probe);
    })
    || DEFAULT_TOPICS[new Date().getUTCDate() % DEFAULT_TOPICS.length]
  );
}

function extractJsonText(rawText) {
  const directText = String(rawText || "").trim();
  if (!directText) {
    throw new Error("AI text generation returned empty content.");
  }

  try {
    return JSON.parse(directText);
  } catch {
    const fencedMatch = directText.match(/```json\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1]);
    }

    const objectMatch = directText.match(/\{[\s\S]*\}/);
    if (objectMatch?.[0]) {
      return JSON.parse(objectMatch[0]);
    }
  }

  throw new Error(`Unable to parse JSON from AI response: ${directText.slice(0, 300)}`);
}

async function callGeminiModel({ model, apiKey, baseUrl, body }) {
  const requestUrl = `${normalizeBaseUrl(baseUrl)}/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  logStep("AI", "Calling Gemini model", {
    model,
    baseUrl: normalizeBaseUrl(baseUrl),
  });

  const response = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Gemini request failed (${response.status} ${response.statusText}): ${errorText.slice(0, 500)}`,
    );
  }

  logStep("AI", "Gemini response received", {
    model,
    status: response.status,
  });

  return response.json();
}

function getTextFromGeminiResponse(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const textPart = parts.find((item) => typeof item?.text === "string" && item.text.trim());
  return String(textPart?.text || "").trim();
}

function getInlineImageFromGeminiResponse(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((item) => item?.inlineData?.data || item?.inline_data?.data);

  if (!imagePart) {
    return null;
  }

  const inlineData = imagePart.inlineData || imagePart.inline_data;
  return {
    data: String(inlineData.data || ""),
    mimeType: String(inlineData.mimeType || inlineData.mime_type || "image/png"),
  };
}

async function fetchJson(url, options = {}) {
  logStep("FETCH", "Fetching JSON", {
    url,
    method: String(options?.method || "GET").toUpperCase(),
  });
  const response = await fetch(url, options);
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Request failed (${response.status} ${response.statusText}) for ${url}: ${errorText.slice(0, 500)}`,
    );
  }
  return response.json();
}

function buildPublicOssBaseUrl(bucket, endpoint) {
  const normalizedEndpoint = String(endpoint || DEFAULT_OSS_ENDPOINT)
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/g, "");
  return `https://${bucket}.${normalizedEndpoint}`;
}

function getOssRegionFromEndpoint(endpoint) {
  const host = String(endpoint || DEFAULT_OSS_ENDPOINT)
    .trim()
    .replace(/^https?:\/\//, "")
    .split("/")[0];
  return host.replace(/\.aliyuncs\.com$/i, "");
}

function createOssClient() {
  const accessKeyId = getEnv("BLOG_OSS_ACCESS_KEY_ID");
  const accessKeySecret = getEnv("BLOG_OSS_ACCESS_KEY_SECRET");
  const bucket = getEnv("BLOG_OSS_BUCKET", DEFAULT_OSS_BUCKET);
  const endpoint = getEnv("BLOG_OSS_ENDPOINT", DEFAULT_OSS_ENDPOINT);

  if (!accessKeyId || !accessKeySecret) {
    throw new Error("Missing BLOG_OSS_ACCESS_KEY_ID or BLOG_OSS_ACCESS_KEY_SECRET.");
  }

  return new OSS({
    region: getOssRegionFromEndpoint(endpoint),
    endpoint: `https://${endpoint.replace(/^https?:\/\//, "")}`,
    bucket,
    accessKeyId,
    accessKeySecret,
    secure: true,
    timeout: 60 * 1000,
  });
}

async function putObject(client, key, body, headers = {}) {
  logStep("OSS", "Uploading object", {
    key,
    contentType: headers["Content-Type"] || headers["content-type"] || "",
  });
  await client.put(key, body, {
    headers,
  });
  logStep("OSS", "Upload completed", { key });
}

function inferFileExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "png";
}

async function getCurrentManifestContext({ siteBaseUrl, secret, fallbackManifestUrl }) {
  let manifestUrl = getEnv("BLOG_MANIFEST_URL");

  if (!manifestUrl && siteBaseUrl) {
    logStep("MANIFEST", "Resolving current manifest from site endpoint", {
      siteBaseUrl,
    });
    const response = await fetchJson(`${siteBaseUrl}/api/internal/blog/manifest`, {
      headers: secret
        ? {
            "x-blog-revalidate-secret": secret,
          }
        : {},
    }).catch(() => null);

    manifestUrl = String(response?.manifestUrl || "").trim();
  }

  manifestUrl = manifestUrl || fallbackManifestUrl;
  logStep("MANIFEST", "Using manifest URL", {
    manifestUrl,
    fallbackManifestUrl,
  });
  const manifest = manifestUrl ? await fetchJson(manifestUrl).catch(() => null) : null;

  logStep("MANIFEST", "Manifest loaded", {
    manifestUrl,
    totalPosts: manifest?.posts?.length || 0,
  });

  return {
    manifestUrl,
    manifest: manifest || {
      version: "",
      generatedAt: "",
      total: 0,
      posts: [],
    },
  };
}

function sanitizeTags(tags) {
  const normalizedTags = Array.isArray(tags)
    ? tags.map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean)
    : [];

  return [...new Set(normalizedTags)].slice(0, 5);
}

function ensureUniqueSlug(baseSlug, existingSlugs) {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let attempt = 2;
  while (existingSlugs.has(`${baseSlug}-${attempt}`)) {
    attempt += 1;
  }

  return `${baseSlug}-${attempt}`;
}

async function generateBlogDraft({
  manifest,
  topic,
  dateString,
  apiKey,
  baseUrl,
  model,
}) {
  logStep("AI_TEXT", "Generating blog draft", {
    model,
    topic,
    existingPosts: manifest.posts?.length || 0,
  });
  const recentPosts = summarizeRecentPosts(manifest.posts || []);
  const prompt = [
    "You are writing a production blog post for the CollabGrow website.",
    "Return JSON only. Do not wrap it in markdown fences.",
    "Target audience: creators, creator managers, and agencies evaluating brand deals.",
    "Tone: practical, editorial, confident, useful. No emojis.",
    "Write in English.",
    "JSON schema:",
    "{",
    '  "title": "string under 70 characters",',
    '  "description": "string under 180 characters",',
    '  "seoTitle": "string under 70 characters",',
    '  "seoDescription": "string under 180 characters",',
    '  "tags": ["3 to 5 lowercase tags"],',
    '  "imagePrompt": "single paragraph prompt for a 1200x630 editorial hero image with no text, no watermark, no UI screenshot",',
    '  "markdown": "full markdown article between 900 and 1400 words"',
    "}",
    "Article requirements:",
    "- Use one H1 as the article title, then H2/H3 sections.",
    "- Include a short intro, 4 to 6 substantive sections, and a final takeaway section.",
    "- Mention CollabGrow naturally 1 or 2 times, not as a sales pitch.",
    "- Avoid fabricated statistics and citations.",
    "- Do not include frontmatter.",
    "- Prefer concrete workflows, checklists, and examples.",
    `Today's target topic: ${topic}`,
    `Publication date: ${dateString}`,
    "Avoid overlapping with these recent posts:",
    JSON.stringify(recentPosts),
  ].join("\n");

  const response = await callGeminiModel({
    model,
    apiKey,
    baseUrl,
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.9,
        responseMimeType: "application/json",
      },
    },
  });

  const parsed = extractJsonText(getTextFromGeminiResponse(response));
  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();
  const seoTitle = String(parsed.seoTitle || title).trim();
  const seoDescription = String(parsed.seoDescription || description).trim();
  const markdown = String(parsed.markdown || "").trim();
  const imagePrompt = String(parsed.imagePrompt || "").trim();
  const tags = sanitizeTags(parsed.tags);

  if (!title || !description || !markdown || !imagePrompt) {
    throw new Error("Generated article is missing one of: title, description, markdown, imagePrompt.");
  }

  if (getWordCount(markdown) < 700) {
    throw new Error("Generated markdown is too short for publishing.");
  }

  logStep("AI_TEXT", "Draft generated", {
    title,
    tags,
    wordCount: getWordCount(markdown),
  });

  return {
    title,
    description,
    seoTitle,
    seoDescription,
    markdown,
    imagePrompt,
    tags,
  };
}

async function generateCoverImage({ prompt, apiKey, baseUrl, model }) {
  logStep("AI_IMAGE", "Generating cover image", {
    model,
    promptPreview: prompt.slice(0, 120),
  });
  const response = await callGeminiModel({
    model,
    apiKey,
    baseUrl,
    body: {
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                "Generate a single polished editorial cover image.",
                "Aspect ratio: 1200x630.",
                "No text, no logo, no watermark, no collage.",
                prompt,
              ].join("\n"),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.8,
        responseModalities: ["TEXT", "IMAGE"],
      },
    },
  });

  const imagePart = getInlineImageFromGeminiResponse(response);
  if (!imagePart?.data) {
    throw new Error("Image generation completed without returning inline image data.");
  }

  logStep("AI_IMAGE", "Cover image generated", {
    mimeType: imagePart.mimeType,
    bytes: Buffer.byteLength(imagePart.data, "base64"),
  });

  return {
    mimeType: imagePart.mimeType,
    buffer: Buffer.from(imagePart.data, "base64"),
  };
}

function buildBlogDocument({
  slug,
  draft,
  dateString,
  imageUrl,
  title,
  description,
  seoTitle,
  seoDescription,
  markdown,
  tags,
  author,
}) {
  return {
    slug,
    title,
    description,
    date: dateString,
    updatedAt: dateString,
    image: imageUrl,
    author,
    tags,
    category: "blog",
    draft,
    seo: {
      title: seoTitle,
      description: seoDescription,
      image: imageUrl,
    },
    markdown,
  };
}

function buildBlogSummary(documentUrl, postDocument) {
  return {
    slug: postDocument.slug,
    title: postDocument.title,
    description: postDocument.description,
    date: postDocument.date,
    updatedAt: postDocument.updatedAt,
    image: postDocument.image,
    documentUrl,
    author: postDocument.author,
    tags: postDocument.tags,
    category: postDocument.category,
    draft: postDocument.draft,
    seo: postDocument.seo,
  };
}

function sortPostsByDate(posts) {
  return [...posts].sort((left, right) => {
    const leftTime = new Date(left.updatedAt || left.date || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.date || 0).getTime();
    return rightTime - leftTime;
  });
}

async function writePreviewArtifacts(slug, payload) {
  const outputDir = path.resolve(automationRoot, ".data/generated-blog-preview");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${slug}.json`);
  await fs.writeFile(`${outputPath}`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  logStep("DRY_RUN", "Preview artifact written", {
    slug,
    outputPath,
  });
  return outputPath;
}

async function revalidateSite({ siteBaseUrl, secret, manifestUrl }) {
  if (!siteBaseUrl) {
    throw new Error("SITE_BASE_URL is required to call the blog revalidate endpoint.");
  }

  logStep("REVALIDATE", "Calling revalidate endpoint", {
    siteBaseUrl,
    manifestUrl,
  });

  const response = await fetch(`${siteBaseUrl}/api/internal/blog/revalidate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret
        ? {
            "x-blog-revalidate-secret": secret,
          }
        : {}),
    },
    body: JSON.stringify({
      manifestUrl,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Revalidate failed (${response.status} ${response.statusText}): ${errorText.slice(0, 500)}`,
    );
  }

  logStep("REVALIDATE", "Revalidate completed", {
    status: response.status,
  });

  return response.json();
}

async function verifyPublishedPost({ siteBaseUrl, slug }) {
  if (!siteBaseUrl) return null;
  logStep("VERIFY", "Verifying published blog post", {
    siteBaseUrl,
    slug,
  });
  return fetchJson(`${siteBaseUrl}/api/blog/${encodeURIComponent(slug)}`);
}

function createStablePostId() {
  return crypto.randomUUID().replace(/-/g, "");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logStep("BOOT", "Starting blog publisher", {
    dryRun: args.dryRun,
    topicOverride: args.topic || "",
  });
  await loadLocalEnvFiles();

  const projectRoot = getProjectRoot();
  const timeZone = getEnv("BLOG_TIMEZONE", DEFAULT_TIMEZONE);
  const now = new Date();
  const { year, month, date } = formatDateParts(now, timeZone);
  const siteBaseUrl = await getSiteBaseUrl(projectRoot);

  const secret = getEnv("BLOG_REVALIDATE_SECRET");
  const aiBaseUrl = getEnv("BLOG_AI_BASE_URL", DEFAULT_AI_BASE_URL);
  const aiApiKey = getEnv("BLOG_AI_API_KEY");
  const textModel = getEnv("BLOG_TEXT_MODEL", DEFAULT_TEXT_MODEL);
  const imageModel = getEnv("BLOG_IMAGE_MODEL", DEFAULT_IMAGE_MODEL);
  const ossBucket = getEnv("BLOG_OSS_BUCKET", DEFAULT_OSS_BUCKET);
  const ossEndpoint = getEnv("BLOG_OSS_ENDPOINT", DEFAULT_OSS_ENDPOINT);
  const ossPrefix = getEnv("BLOG_OSS_PREFIX", DEFAULT_OSS_PREFIX).replace(/^\/+|\/+$/g, "");
  logStep("CONFIG", "Resolved runtime configuration", {
    projectRoot,
    siteBaseUrl,
    timeZone,
    textModel,
    imageModel,
    ossBucket,
    ossEndpoint,
    ossPrefix,
    hasAiApiKey: Boolean(aiApiKey),
    hasOssAccessKeyId: Boolean(getEnv("BLOG_OSS_ACCESS_KEY_ID")),
    hasOssAccessKeySecret: Boolean(getEnv("BLOG_OSS_ACCESS_KEY_SECRET")),
    hasRevalidateSecret: Boolean(secret),
  });
  const publicOssBaseUrl = buildPublicOssBaseUrl(ossBucket, ossEndpoint);
  const fixedManifestUrl = `${publicOssBaseUrl}/${ossPrefix}/manifest.json`;
  const manifestContext = await getCurrentManifestContext({
    siteBaseUrl,
    secret,
    fallbackManifestUrl: fixedManifestUrl,
  });

  if (!aiApiKey) {
    throw new Error("Missing BLOG_AI_API_KEY.");
  }

  const manifest = manifestContext.manifest || {
    version: "",
    generatedAt: "",
    total: 0,
    posts: [],
  };
  const topic = selectTopic(manifest.posts || [], args.topic);
  logStep("PLAN", "Selected topic for generation", {
    topic,
    currentPostCount: manifest.posts?.length || 0,
  });
  const draft = await generateBlogDraft({
    manifest,
    topic,
    dateString: date,
    apiKey: aiApiKey,
    baseUrl: aiBaseUrl,
    model: textModel,
  });

  const existingSlugs = new Set((manifest.posts || []).map((post) => post.slug));
  const slug = ensureUniqueSlug(slugify(draft.title), existingSlugs);
  logStep("PLAN", "Resolved slug", {
    slug,
    title: draft.title,
  });
  const author = {
    name: DEFAULT_AUTHOR_NAME,
    avatar:
      String(
        manifest.posts?.find((post) => post.author?.avatar)?.author?.avatar || DEFAULT_AUTHOR_AVATAR,
      ).trim() || DEFAULT_AUTHOR_AVATAR,
  };

  const imageAsset = await generateCoverImage({
    prompt: draft.imagePrompt,
    apiKey: aiApiKey,
    baseUrl: aiBaseUrl,
    model: imageModel,
  });

  const imageExtension = inferFileExtension(imageAsset.mimeType);
  const imageKey = `${ossPrefix}/images/${year}/${month}/${slug}-cover.${imageExtension}`;
  const imageUrl = `${publicOssBaseUrl}/${imageKey}`;
  const documentKey = `${ossPrefix}/posts/${slug}.json`;
  const documentUrl = `${publicOssBaseUrl}/${documentKey}`;
  logStep("PLAN", "Resolved output targets", {
    imageKey,
    documentKey,
    manifestUrl: fixedManifestUrl,
  });

  const postDocument = buildBlogDocument({
    slug,
    draft: false,
    dateString: date,
    imageUrl,
    title: draft.title,
    description: draft.description,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    markdown: draft.markdown,
    tags: draft.tags.length ? draft.tags : ["collabgrow", "creator-economy", "blog"],
    author,
  });

  const postSummary = buildBlogSummary(documentUrl, postDocument);
  const mergedPosts = sortPostsByDate([
    postSummary,
    ...(manifest.posts || []).filter((post) => post.slug !== slug),
  ]);
  const nextManifest = {
    version: createStablePostId(),
    generatedAt: now.toISOString(),
    total: mergedPosts.length,
    posts: mergedPosts,
  };
  logStep("MANIFEST", "Prepared next manifest", {
    totalPosts: nextManifest.total,
    slug,
  });

  if (args.dryRun) {
    const previewPath = await writePreviewArtifacts(slug, {
      topic,
      currentManifestUrl: manifestContext.manifestUrl,
      nextManifestUrl: fixedManifestUrl,
      imageKey,
      documentKey,
      postDocument,
      nextManifest,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          slug,
          topic,
          previewPath,
          manifestUrl: fixedManifestUrl,
        },
        null,
        2,
      ),
    );
    return;
  }

  logStep("OSS", "Creating OSS client");
  const ossClient = createOssClient();
  await putObject(ossClient, imageKey, imageAsset.buffer, {
    "Content-Type": imageAsset.mimeType,
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  await putObject(ossClient, documentKey, Buffer.from(JSON.stringify(postDocument, null, 2)), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300",
  });
  await putObject(
    ossClient,
    `${ossPrefix}/manifest.json`,
    Buffer.from(JSON.stringify(nextManifest, null, 2)),
    {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  );

  const revalidateResult = await revalidateSite({
    siteBaseUrl,
    secret,
    manifestUrl: fixedManifestUrl,
  });
  const publishedResult = await verifyPublishedPost({
    siteBaseUrl,
    slug,
  });
  logStep("VERIFY", "Verification completed", {
    slug: publishedResult?.post?.slug || slug,
    title: publishedResult?.post?.title || "",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        slug,
        topic,
        manifestUrl: fixedManifestUrl,
        imageUrl,
        documentUrl,
        revalidateResult,
        verification: publishedResult
          ? {
              slug: publishedResult.post?.slug,
              title: publishedResult.post?.title,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  logError("FATAL", error);
  process.exitCode = 1;
});
