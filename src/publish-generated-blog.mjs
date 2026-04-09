import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import OSS from "ali-oss";
import { google } from "googleapis";

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
const DEFAULT_REVALIDATE_SECRET =
  "5decb11d28fe5d7017ee20f5880ddeda4530abf9fc54c8d3ffa31198539b4fc7";
const DEFAULT_SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const DEFAULT_SEARCH_CONSOLE_LOOKBACK_DAYS = 90;
const DEFAULT_SEARCH_CONSOLE_MIN_IMPRESSIONS = 5;
const DEFAULT_SEARCH_CONSOLE_MIN_TOKENS = 2;

const LAYER_DEFINITIONS = {
  core_editorial: {
    label: "Core Editorial",
    sourceKey: "coreEditorial",
    description: "Evergreen, conversion-adjacent educational content around deal qualification.",
  },
  tool_problem: {
    label: "Tool Problem",
    sourceKey: "toolProblem",
    description: "Problem-solving content that maps directly to Email Decoder or Brand Analyze.",
  },
  controlled_programmatic: {
    label: "Controlled Programmatic",
    sourceKey: "programmatic",
    description: "High-intent templates around brands, email patterns, and creator scenarios.",
  },
  trend_linked: {
    label: "Trend Linked",
    sourceKey: "trendLinked",
    description: "Topically aligned, freshness-led creator partnership content.",
  },
};

const PRODUCT_CONTEXT = {
  deal_hunter: {
    name: "Deal Hunter",
    summary:
      "A creator-focused opportunity layer that helps users find active campaigns and shortlist opportunities by niche, platform, fit, and workload.",
    differentiators: [
      "Helps creators move from vague interest to a real shortlist of active opportunities.",
      "Makes fit, workload, timing, and campaign relevance easier to compare quickly.",
      "Useful when creators want fewer low-fit deals and more realistic next steps.",
    ],
  },
  email_decoder: {
    name: "Email Decoder",
    summary:
      "An analysis tool for inbound sponsorship emails that surfaces the real offer, hidden deliverables, potential risks, and better reply angles.",
    differentiators: [
      "Pulls out offer structure, compensation, deliverables, and missing information from a raw email.",
      "Highlights scam signals, urgency patterns, vague asks, and hidden workload.",
      "Supports creators who need a faster first-pass decision before they reply.",
    ],
    reportStructure: [
      "what the offer actually is",
      "product, fee, commission, or compensation structure",
      "requirements and deliverables",
      "brand channels and observed activity",
      "risk signals, creator fit, and next-step guidance",
    ],
  },
  brand_analyze: {
    name: "Brand Analyze",
    summary:
      "A creator-side diligence tool that checks brand legitimacy, campaign style, trust signals, risk, and partnership fit before a creator commits.",
    differentiators: [
      "Looks beyond follower count by pulling in reputation and operational risk context.",
      "Surfaces campaign history, content style, trust signals, and likely creator fit.",
      "Useful when the brand sounds interesting but credibility is still unclear.",
    ],
    reportStructure: [
      "brand profile and official web presence",
      "social footprint and visible campaign activity",
      "trust and reputation signals such as review context",
      "operational and reputation risk assessment",
      "marketing analysis, creator fit, and growth prediction",
    ],
  },
};

const CTA_STYLE_ORDER = ["soft", "weak", "strong"];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const automationRoot = path.resolve(scriptDir, "..");
const defaultProjectRoot = path.resolve(automationRoot, "../..");
const dataRoot = path.resolve(automationRoot, "data");
const stateRoot = path.resolve(automationRoot, ".data");
const publishLogPath = path.resolve(stateRoot, "publish-log.json");
const topicLedgerPath = path.resolve(stateRoot, "topic-ledger.json");

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
    layer: "",
    product: "",
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
      continue;
    }

    if (value === "--layer") {
      args.layer = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (value === "--product") {
      args.product = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
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
    const envProdContent = await fs.readFile(path.resolve(projectRoot, ".env.prod"), "utf8");
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

function extractBalancedJsonObject(rawText) {
  const text = String(rawText || "");
  const startIndex = text.indexOf("{");
  if (startIndex < 0) return "";

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }

      if (char === "\\") {
        escaping = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return "";
}

async function repairJsonPayload({ rawText, apiKey, baseUrl, model }) {
  const repairPrompt = [
    "You repair malformed JSON outputs for a content pipeline.",
    "Return valid JSON only.",
    "Do not add commentary or markdown fences.",
    "Preserve the author's intended meaning while making the JSON valid.",
    "Expected fields:",
    "{",
    '  "title": "string",',
    '  "description": "string",',
    '  "seoTitle": "string",',
    '  "seoDescription": "string",',
    '  "tags": ["array of lowercase strings"],',
    '  "imagePrompt": "string",',
    '  "markdown": "string"',
    "}",
    "Malformed input:",
    rawText,
  ].join("\n");

  logStep("AI_TEXT", "Repairing malformed JSON payload from model output");
  const response = await callGeminiModel({
    model,
    apiKey,
    baseUrl,
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: repairPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    },
  });

  return getTextFromGeminiResponse(response);
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

  return [...new Set(normalizedTags)].slice(0, 6);
}

function ensureUniqueSlug(baseSlug, existingSlugs) {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let attempt = 2;
  while (existingSlugs.has(`${baseSlug}-${attempt}`)) {
    attempt += 1;
  }

  return `${baseSlug}-${attempt}`;
}

function createStablePostId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function summarizeRecentPosts(posts, count = 12) {
  return posts.slice(0, count).map((post) => ({
    slug: post.slug,
    title: post.title,
    tags: post.tags || [],
    category: post.category || "blog",
  }));
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
  const outputDir = path.resolve(stateRoot, "generated-blog-preview");
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${slug}.json`);
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

  try {
    return await fetchJson(`${siteBaseUrl}/api/blog/${encodeURIComponent(slug)}`);
  } catch (error) {
    logError("VERIFY", error, {
      slug,
      nonFatal: true,
    });
    return null;
  }
}

async function loadJsonData(relativePath) {
  const filePath = path.resolve(dataRoot, relativePath);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadV1ConfigBundle() {
  const [topicLibrary, programmaticLibrary, queryRules, scoringRules, internalLinkingRules, toneRules] =
    await Promise.all([
      loadJsonData("topic-library.json"),
      loadJsonData("programmatic-library.json"),
      loadJsonData("query-rules.json"),
      loadJsonData("scoring-rules.json"),
      loadJsonData("internal-linking-rules.json"),
      loadJsonData("tone-rules.json"),
    ]);

  return {
    topicLibrary,
    programmaticLibrary,
    queryRules,
    scoringRules,
    internalLinkingRules,
    toneRules,
  };
}

async function ensureStateRoot() {
  await fs.mkdir(stateRoot, { recursive: true });
}

async function readPublishLog() {
  try {
    const raw = await fs.readFile(publishLogPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendPublishLog(entry) {
  await ensureStateRoot();
  const currentLog = await readPublishLog();
  currentLog.push(entry);
  await fs.writeFile(publishLogPath, `${JSON.stringify(currentLog, null, 2)}\n`, "utf8");
}

async function readTopicLedger() {
  try {
    const raw = await fs.readFile(topicLedgerPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendTopicLedger(entry) {
  await ensureStateRoot();
  const currentLedger = await readTopicLedger();
  currentLedger.push(entry);
  await fs.writeFile(topicLedgerPath, `${JSON.stringify(currentLedger, null, 2)}\n`, "utf8");
}

function parseSearchConsoleCredential(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed);

  if (parsed.type === "service_account") {
    return {
      kind: "service_account",
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key,
      tokenUri: parsed.token_uri || "https://oauth2.googleapis.com/token",
      projectId: parsed.project_id || "",
    };
  }

  if (parsed.web?.client_id) {
    return {
      kind: "oauth_web",
      clientId: parsed.web.client_id,
      clientSecret: parsed.web.client_secret,
      tokenUri: parsed.web.token_uri || "https://oauth2.googleapis.com/token",
      projectId: parsed.web.project_id || "",
    };
  }

  throw new Error("Unsupported Search Console credential JSON shape.");
}

async function getSearchConsoleAccessToken(credential) {
  if (!credential) {
    return {
      ok: false,
      reason: "missing_credential",
      message: "No Search Console credential JSON was provided.",
    };
  }

  if (credential.kind === "service_account") {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: credential.clientEmail,
          private_key: credential.privateKey,
        },
        scopes: [DEFAULT_SEARCH_CONSOLE_SCOPE],
      });
      const authClient = await auth.getClient();
      const tokenResponse = await authClient.getAccessToken();
      const accessToken =
        typeof tokenResponse === "string"
          ? tokenResponse
          : String(tokenResponse?.token || "");

      if (!accessToken) {
        return {
          ok: false,
          reason: "token_exchange_failed",
          message: "googleapis did not return an access token for the service account.",
        };
      }

      return {
        ok: true,
        accessToken,
        credentialKind: credential.kind,
      };
    } catch (error) {
      return {
        ok: false,
        reason: "network_error",
        message: `googleapis service-account token request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  if (credential.kind === "oauth_web") {
    const refreshToken = getEnv("BLOG_SEARCH_CONSOLE_REFRESH_TOKEN");
    if (!refreshToken) {
      return {
        ok: false,
        reason: "missing_refresh_token",
        message:
          "Provided Search Console credential is a web OAuth client, but BLOG_SEARCH_CONSOLE_REFRESH_TOKEN is missing. A web client alone cannot call Search Console without a user refresh token.",
      };
    }

    try {
      const oauth2Client = new google.auth.OAuth2(
        credential.clientId,
        credential.clientSecret,
      );
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });
      const tokenResponse = await oauth2Client.getAccessToken();
      const accessToken =
        typeof tokenResponse === "string"
          ? tokenResponse
          : String(tokenResponse?.token || "");

      if (!accessToken) {
        return {
          ok: false,
          reason: "token_exchange_failed",
          message: "googleapis did not return an access token for the OAuth client.",
        };
      }

      return {
        ok: true,
        accessToken,
        credentialKind: credential.kind,
      };
    } catch (error) {
      return {
        ok: false,
        reason: "network_error",
        message: `googleapis OAuth token request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  return {
    ok: false,
    reason: "unsupported_credential",
    message: "Unsupported Search Console credential type.",
  };
}

async function fetchSearchConsoleRows({
  property,
  credential,
  startDate,
  endDate,
  rowLimit = 250,
}) {
  if (!property) {
    return {
      ok: false,
      reason: "missing_property",
      message: "BLOG_SEARCH_CONSOLE_PROPERTY is required.",
    };
  }

  const tokenResult = await getSearchConsoleAccessToken(credential);
  if (!tokenResult.ok) return tokenResult;
  try {
    const authClient = new google.auth.OAuth2();
    authClient.setCredentials({
      access_token: tokenResult.accessToken,
    });
    const searchconsole = google.searchconsole({
      version: "v1",
      auth: authClient,
    });
    const analyticsResponse = await searchconsole.searchanalytics.query({
      siteUrl: property,
      requestBody: {
        startDate,
        endDate,
        dimensions: ["query"],
        rowLimit,
      },
    });

    const rows = Array.isArray(analyticsResponse.data.rows) ? analyticsResponse.data.rows : [];
    return {
      ok: true,
      credentialKind: tokenResult.credentialKind,
      rows: rows.map((row) => ({
        query: String(row.keys?.[0] || "").trim(),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
      })),
    };
  } catch (error) {
    const raw =
      error?.response?.data
      || error?.errors
      || error?.message
      || String(error);
    return {
      ok: false,
      reason: "api_failed",
      message: typeof raw === "string" ? raw : JSON.stringify(raw),
      credentialKind: tokenResult.credentialKind,
    };
  }
}

function classifySearchConsoleProduct(query, queryRules) {
  const normalized = String(query || "").toLowerCase();
  let bestProduct = "";
  let bestScore = 0;

  for (const [productKey, terms] of Object.entries(queryRules.productTermMap || {})) {
    const score = (terms || []).reduce(
      (sum, term) => sum + (normalized.includes(String(term).toLowerCase()) ? 1 : 0),
      0,
    );
    if (score > bestScore) {
      bestProduct = productKey;
      bestScore = score;
    }
  }

  return bestProduct || "deal_hunter";
}

function classifySearchConsoleLayer(query, productKey) {
  const normalized = String(query || "").toLowerCase();
  if (
    normalized.includes("#paidcollab")
    || normalized.includes("paid collab")
    || normalized.includes("campaign")
  ) {
    return "trend_linked";
  }

  if (
    normalized.includes("email")
    || normalized.includes("reply")
    || normalized.includes("collab email")
  ) {
    return "tool_problem";
  }

  if (
    normalized.includes("legit")
    || normalized.includes("review")
    || normalized.includes("trust")
    || normalized.includes("safe")
    || productKey === "brand_analyze"
  ) {
    return "controlled_programmatic";
  }

  return "core_editorial";
}

function normalizeSearchConsoleQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ");
}

function containsAnyTerm(text, terms) {
  const normalized = String(text || "").toLowerCase();
  return (terms || []).some((term) => normalized.includes(String(term || "").toLowerCase()));
}

function countMatchingTerms(text, terms) {
  const normalized = String(text || "").toLowerCase();
  return (terms || []).reduce(
    (sum, term) => sum + (normalized.includes(String(term || "").toLowerCase()) ? 1 : 0),
    0,
  );
}

function getTokenCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function computeSearchConsoleRelevance(query, queryRules) {
  const normalized = normalizeSearchConsoleQuery(query);
  const creatorMatches = countMatchingTerms(normalized, queryRules.creatorContextTerms || []);
  const priorityMatches = countMatchingTerms(normalized, queryRules.priorityTerms || []);
  const weakMatches = countMatchingTerms(normalized, queryRules.weakIntentTerms || []);
  const productScores = Object.values(queryRules.productTermMap || {}).map((terms) =>
    countMatchingTerms(normalized, terms),
  );
  const strongestProductMatch = Math.max(0, ...productScores);
  const queryShapeBonus = getTokenCount(normalized) >= 3 ? 0.08 : 0;

  return clamp(
    creatorMatches * 0.16
      + priorityMatches * 0.14
      + strongestProductMatch * 0.12
      + queryShapeBonus
      - weakMatches * 0.2,
  );
}

function computeSearchConsoleOpportunity(row) {
  const impressions = Number(row.impressions || 0);
  const ctr = Number(row.ctr || 0);
  const position = Number(row.position || 100);

  const impressionScore = clamp(Math.log10(impressions + 1) / 2.7);
  const ctrGapScore = clamp(1 - Math.min(ctr, 0.1) / 0.1);
  let positionScore = 0.2;

  if (position >= 5 && position <= 45) {
    positionScore = 1;
  } else if (position > 45 && position <= 80) {
    positionScore = 0.62;
  } else if (position < 5) {
    positionScore = 0.18;
  }

  return clamp(impressionScore * 0.45 + ctrGapScore * 0.35 + positionScore * 0.2);
}

function shouldKeepSearchConsoleRow(row, queryRules) {
  const query = normalizeSearchConsoleQuery(row.query);
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);
  const minImpressions = Number(
    queryRules.minimumImpressions ?? DEFAULT_SEARCH_CONSOLE_MIN_IMPRESSIONS,
  );
  const minTokens = Number(queryRules.minimumTokens ?? DEFAULT_SEARCH_CONSOLE_MIN_TOKENS);
  const minRelevanceScore = Number(queryRules.minimumRelevanceScore || 0.34);
  const minCombinedScore = Number(queryRules.minimumCombinedScore || 0.58);

  if (!query) return false;
  if (getTokenCount(query) < minTokens) return false;
  if (containsAnyTerm(query, queryRules.brandTerms || [])) return false;
  if (containsAnyTerm(query, queryRules.ignoreTerms || [])) return false;
  if (containsAnyTerm(query, queryRules.legacyTerms || [])) return false;
  if (impressions < minImpressions && clicks <= 0) return false;

  const relevanceScore = computeSearchConsoleRelevance(query, queryRules);
  const opportunityScore = computeSearchConsoleOpportunity(row);

  return (
    relevanceScore >= minRelevanceScore
    && relevanceScore + opportunityScore >= minCombinedScore
  );
}

function buildSearchConsoleSeedTopic(query, layer, productKey) {
  const normalized = normalizeSearchConsoleQuery(query)
    .replace(/\bai\b/g, "AI")
    .replace(/\bugc\b/g, "UGC");

  if (layer === "tool_problem" || productKey === "email_decoder") {
    return `How creators should use ${normalized} to qualify brand outreach faster`;
  }

  if (layer === "controlled_programmatic" || productKey === "brand_analyze") {
    return `How creators should use ${normalized} to vet brand fit before saying yes`;
  }

  if (layer === "trend_linked") {
    return `What ${normalized} means for creators reviewing paid collaborations right now`;
  }

  return `How creators can turn ${normalized} into better sponsorship decisions`;
}

function classifySearchConsoleIntent(query, layer) {
  const normalized = normalizeSearchConsoleQuery(query);
  if (layer === "trend_linked") return "trend";
  if (normalized.includes("review") || normalized.includes("checker") || normalized.includes("legit")) {
    return "review";
  }
  if (normalized.includes("template") || normalized.includes("reply")) {
    return "template";
  }
  if (normalized.includes("how") || normalized.includes("what") || normalized.includes("why")) {
    return "how-to";
  }
  return layer === "controlled_programmatic" ? "framework" : "workflow";
}

function buildSearchConsoleCandidates(rows, queryRules) {
  return (rows || []).filter((row) => shouldKeepSearchConsoleRow(row, queryRules)).map((row) => {
    const productKey = classifySearchConsoleProduct(row.query, queryRules);
    const layer = classifySearchConsoleLayer(row.query, productKey);
    const relevanceScore = computeSearchConsoleRelevance(row.query, queryRules);
    const opportunityScore = computeSearchConsoleOpportunity(row);
    const priority = clamp(0.58 + relevanceScore * 0.22 + opportunityScore * 0.2);
    return {
      id: `search-console-${slugify(row.query)}`,
      topicKey: `search-console:${slugify(row.query)}`,
      layer,
      cluster: "search-console-query",
      primaryProduct: productKey,
      intentType: classifySearchConsoleIntent(row.query, layer),
      priority,
      seedTopic: buildSearchConsoleSeedTopic(row.query, layer, productKey),
      audience: "creators searching for practical sponsorship guidance",
      angle:
        "Answer the underlying search intent in a creator-business context, then tie it back to clearer qualification, risk review, and decision-making.",
      tags: sanitizeTags([
        normalizeSearchConsoleQuery(row.query),
        productKey.replace(/_/g, " "),
        "creator deals",
      ]),
      sourceType: "search_console",
      templateType: "search_console_query",
      keywordGroup: `query:${slugify(row.query)}`,
      searchConsole: {
        ...row,
        relevanceScore,
        opportunityScore,
      },
    };
  });
}

async function getSearchConsoleContext(queryRules, siteBaseUrl) {
  const property = getEnv("BLOG_SEARCH_CONSOLE_PROPERTY", normalizeBaseUrl(siteBaseUrl));
  const rawCredential =
    getEnv("BLOG_SEARCH_CONSOLE_CREDENTIAL_JSON")
    || getEnv("BLOG_SEARCH_CONSOLE_CLIENT_JSON");
  const exportPath = getEnv("BLOG_SEARCH_CONSOLE_EXPORT_PATH");
  const lookbackDays = Number(
    getEnv("BLOG_SEARCH_CONSOLE_LOOKBACK_DAYS", String(DEFAULT_SEARCH_CONSOLE_LOOKBACK_DAYS)),
  );
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = getDateDaysAgo(lookbackDays);

  if (exportPath) {
    try {
      const raw = await fs.readFile(path.resolve(exportPath), "utf8");
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : parsed.rows || [];
      const normalizedRows = rows.map((row) => ({
        query: String(row.query || row.keys?.[0] || "").trim(),
        clicks: Number(row.clicks || 0),
        impressions: Number(row.impressions || 0),
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
      }));
      return {
        ok: true,
        source: "file",
        property,
        startDate,
        endDate,
        rows: normalizedRows,
        candidates: buildSearchConsoleCandidates(normalizedRows, queryRules),
      };
    } catch (error) {
      return {
        ok: false,
        source: "file",
        reason: "export_read_failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!rawCredential) {
    return {
      ok: false,
      source: "api",
      reason: "missing_credential",
      message:
        "No BLOG_SEARCH_CONSOLE_CREDENTIAL_JSON was provided. V2 will continue without Search Console queries.",
    };
  }

  let credential;
  try {
    credential = parseSearchConsoleCredential(rawCredential);
  } catch (error) {
    return {
      ok: false,
      source: "api",
      reason: "invalid_credential_json",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const apiResult = await fetchSearchConsoleRows({
    property,
    credential,
    startDate,
    endDate,
  });

  if (!apiResult.ok) {
    return {
      ...apiResult,
      source: "api",
      property,
      startDate,
      endDate,
      credentialKind: credential?.kind || "",
    };
  }

  return {
    ok: true,
    source: "api",
    property,
    startDate,
    endDate,
    credentialKind: apiResult.credentialKind,
    rows: apiResult.rows,
    candidates: buildSearchConsoleCandidates(apiResult.rows, queryRules),
  };
}

function hashToUnitInterval(input) {
  const digest = crypto.createHash("sha256").update(String(input)).digest("hex").slice(0, 8);
  return parseInt(digest, 16) / 0xffffffff;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token && token.length > 2);
}

function uniqueStrings(values) {
  return [...new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function toSentenceCase(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days || DEFAULT_SEARCH_CONSOLE_LOOKBACK_DAYS));
  return date.toISOString().slice(0, 10);
}

function buildCandidateText(candidate) {
  return [
    candidate.seedTopic,
    candidate.angle,
    candidate.audience,
    ...(candidate.tags || []),
    candidate.brandName || "",
    candidate.niche || "",
    candidate.platform || "",
    candidate.followerTier || "",
    candidate.templateType || "",
    candidate.keywordGroup || "",
  ]
    .join(" ")
    .toLowerCase();
}

function overlapRatio(leftText, rightText) {
  const leftTokens = new Set(tokenize(leftText));
  const rightTokens = new Set(tokenize(rightText));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }

  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function containsBlockedTerms(text, queryRules) {
  const haystack = String(text || "").toLowerCase();
  return [...(queryRules.ignoreTerms || []), ...(queryRules.legacyTerms || [])].some((term) =>
    haystack.includes(String(term || "").toLowerCase()),
  );
}

function normalizeTopicRecord(record, layer) {
  return {
    ...record,
    layer,
    topicKey: `${layer}:${record.id}`,
    primaryProduct: record.primaryProduct || "deal_hunter",
    tags: sanitizeTags(record.tags || []),
  };
}

function buildProgrammaticCandidates(programmaticLibrary) {
  const brandCandidates = (programmaticLibrary.brands || []).flatMap((brand) => {
    const brandSlug = slugify(brand.name);
    return [
      {
        id: `programmatic-brand-review-${brandSlug}`,
        layer: "controlled_programmatic",
        cluster: "brand-review",
        primaryProduct: "brand_analyze",
        intentType: "review",
        priority: 0.92,
        seedTopic: `Is ${brand.name} a good fit for creator sponsorships? A practical review`,
        audience: "creators researching a brand before replying or pitching",
        angle: `Review ${brand.name} through legitimacy, campaign style, creator fit, risk, and whether the partnership looks realistic for creators in ${brand.creatorFit.join(", ")}.`,
        tags: sanitizeTags([
          brand.name.toLowerCase(),
          "brand review",
          "creator sponsorships",
          brand.category,
          "brand analyze",
        ]),
        sourceType: "brand_review",
        templateType: "brand_review",
        brandName: brand.name,
        brandCategory: brand.category,
        campaignStyle: brand.campaignStyle,
        creatorFit: brand.creatorFit,
        keywordGroup: `brand:${brandSlug}`,
        topicKey: `controlled_programmatic:brand-review:${brandSlug}`,
      },
      {
        id: `programmatic-brand-fit-${brandSlug}`,
        layer: "controlled_programmatic",
        cluster: "brand-fit",
        primaryProduct: "brand_analyze",
        intentType: "framework",
        priority: 0.88,
        seedTopic: `What kinds of creators should say yes to ${brand.name} and who should pass`,
        audience: "creators trying to judge fit before spending time on a brand conversation",
        angle: `Focus on audience fit, campaign style, reputation context, creator workload, and where ${brand.name} is likely to be strong or weak for ${brand.creatorFit.join(", ")} creators.`,
        tags: sanitizeTags([
          brand.name.toLowerCase(),
          "brand fit",
          "creator deals",
          brand.category,
          "brand analyze",
        ]),
        sourceType: "brand_fit",
        templateType: "brand_fit",
        brandName: brand.name,
        brandCategory: brand.category,
        campaignStyle: brand.campaignStyle,
        creatorFit: brand.creatorFit,
        keywordGroup: `brand:${brandSlug}`,
        topicKey: `controlled_programmatic:brand-fit:${brandSlug}`,
      },
    ];
  });

  const emailCandidates = (programmaticLibrary.emailScenarios || []).map((scenario) => ({
    ...scenario,
    layer: "controlled_programmatic",
    cluster: "email-patterns",
    priority: 0.87,
    sourceType: "email_pattern",
    templateType: "email_pattern",
    keywordGroup: `email:${scenario.id}`,
    topicKey: `controlled_programmatic:email:${scenario.id}`,
    tags: sanitizeTags(scenario.tags || []),
  }));

  const creatorCandidates = (programmaticLibrary.creatorScenarios || []).map((scenario) => ({
    id: `programmatic-creator-${scenario.id}`,
    layer: "controlled_programmatic",
    cluster: "creator-scenarios",
    primaryProduct: scenario.primaryProduct || "deal_hunter",
    intentType: "scenario",
    priority: 0.85,
    seedTopic: `How ${scenario.niche} creators on ${scenario.platform} with ${scenario.followerTier} followers can qualify better brand deals`,
    audience: `${scenario.niche} creators building consistent sponsorship workflows`,
    angle: scenario.angle,
    tags: sanitizeTags(scenario.tags || []),
    sourceType: "creator_scenario",
    templateType: "creator_scenario",
    niche: scenario.niche,
    platform: scenario.platform,
    followerTier: scenario.followerTier,
    keywordGroup: `creator:${scenario.id}`,
    topicKey: `controlled_programmatic:creator:${scenario.id}`,
  }));

  return [...brandCandidates, ...emailCandidates, ...creatorCandidates];
}

function buildCandidatePool(configBundle, args, externalCandidates = []) {
  const coreEditorial = (configBundle.topicLibrary.coreEditorial || []).map((record) =>
    normalizeTopicRecord(record, "core_editorial"),
  );
  const toolProblem = (configBundle.topicLibrary.toolProblem || []).map((record) =>
    normalizeTopicRecord(record, "tool_problem"),
  );
  const trendLinked = (configBundle.topicLibrary.trendLinked || []).map((record) =>
    normalizeTopicRecord(record, "trend_linked"),
  );
  const programmatic = buildProgrammaticCandidates(configBundle.programmaticLibrary);

  const combined = [...coreEditorial, ...toolProblem, ...programmatic, ...trendLinked, ...externalCandidates];

  return combined.filter((candidate) => {
    if (args.layer && candidate.layer !== args.layer) return false;
    if (args.product && candidate.primaryProduct !== args.product) return false;
    return !containsBlockedTerms(candidate.seedTopic, configBundle.queryRules);
  });
}

function getRecentPublishWindow(logEntries, days) {
  const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
  return logEntries.filter((entry) => new Date(entry.publishedAt || 0).getTime() >= threshold);
}

function computeLayerStats(recentEntries) {
  const counts = Object.fromEntries(Object.keys(LAYER_DEFINITIONS).map((key) => [key, 0]));
  for (const entry of recentEntries) {
    if (counts[entry.layer] !== undefined) counts[entry.layer] += 1;
  }
  return counts;
}

function selectLayer({ args, scoringRules, publishLog, seed }) {
  if (args.layer && LAYER_DEFINITIONS[args.layer]) {
    logStep("TOPIC", "Using manual layer override", {
      layer: args.layer,
    });
    return args.layer;
  }

  const recentEntries = getRecentPublishWindow(
    publishLog,
    Number(scoringRules.recentPublishWindow || 20),
  );
  const counts = computeLayerStats(recentEntries);
  const total = recentEntries.length || 0;
  const priorities = Object.entries(scoringRules.layerTargets || {}).map(([layer, target]) => {
    const actualRatio = total ? counts[layer] / total : 0;
    const deficit = Number(target || 0) - actualRatio;
    const tiebreaker = hashToUnitInterval(`${seed}:${layer}`) * 0.05;
    return {
      layer,
      target,
      actualRatio,
      deficit,
      priority: deficit + tiebreaker,
    };
  });

  priorities.sort((left, right) => right.priority - left.priority);
  const selected = priorities[0]?.layer || "core_editorial";
  logStep("TOPIC", "Selected layer from recent mix", {
    selected,
    priorities,
  });
  return selected;
}

function normalizeForScoring(candidate) {
  return {
    ...candidate,
    intentType: candidate.intentType || "workflow",
    priority: Number(candidate.priority || 0.7),
  };
}

function computeClusterGap(candidate, recentEntries) {
  if (!recentEntries.length) return 1;
  const sameClusterCount = recentEntries.filter((entry) => entry.cluster === candidate.cluster).length;
  return clamp(1 - sameClusterCount / Math.max(recentEntries.length, 4));
}

function computeCannibalizationRisk(candidate, existingPosts, publishLog) {
  const candidateText = buildCandidateText(candidate);
  const existingRatios = [
    ...(existingPosts || []).map((post) => overlapRatio(candidateText, `${post.title} ${(post.tags || []).join(" ")}`)),
    ...(publishLog || []).map((entry) => overlapRatio(candidateText, `${entry.title} ${(entry.tags || []).join(" ")}`)),
  ];
  const keywordGroupMatch = (publishLog || []).some(
    (entry) => entry.keywordGroup && candidate.keywordGroup && entry.keywordGroup === candidate.keywordGroup,
  );
  const maxOverlap = clamp(Math.max(0, ...existingRatios));
  if (keywordGroupMatch) {
    return clamp(Math.max(maxOverlap, 0.92));
  }
  return maxOverlap;
}

function scoreCandidate({
  candidate,
  scoringRules,
  existingPosts,
  publishLog,
  recentEntries,
}) {
  const weights = scoringRules.scoreWeights || {};
  const productPriority = Number(scoringRules.productPriority?.[candidate.primaryProduct] || 0.7);
  const intentScore = Number(scoringRules.intentScores?.[candidate.intentType] || 0.7);
  const searchConsoleBoost = candidate.sourceType === "search_console"
    ? clamp(
        Number(candidate.searchConsole?.relevanceScore || 0) * 0.55
          + Number(candidate.searchConsole?.opportunityScore || 0) * 0.45,
      )
    : 0;
  const freshness = clamp(
    Number(scoringRules.layerFreshness?.[candidate.layer] || 0.65)
      + (candidate.sourceType === "brand_review" ? 0.04 : 0)
      + (candidate.sourceType === "creator_scenario" ? 0.03 : 0),
  );
  const priorityScore = clamp(candidate.priority + searchConsoleBoost * 0.08);
  const businessFit = clamp((productPriority + clamp(candidate.priority)) / 2);
  const conversionFit = clamp(
    productPriority * (candidate.layer === "core_editorial" ? 0.96 : 1)
      + (candidate.primaryProduct === "deal_hunter" ? 0.03 : 0),
  );
  const topicalGap = computeClusterGap(candidate, recentEntries);
  const cannibalizationRisk = computeCannibalizationRisk(candidate, existingPosts, publishLog);
  const total =
    businessFit * Number(weights.businessFit || 0)
    + intentScore * Number(weights.searchIntent || 0)
    + conversionFit * Number(weights.conversionFit || 0)
    + topicalGap * Number(weights.topicalGap || 0)
    + freshness * Number(weights.freshness || 0)
    + priorityScore * Number(weights.priority || 0)
    - cannibalizationRisk * Number(weights.cannibalizationRisk || 0);

  return {
    total: clamp(total),
    factors: {
      businessFit,
      intentScore,
      conversionFit,
      topicalGap,
      freshness,
      priorityScore,
      cannibalizationRisk,
    },
  };
}

function rankCandidates({
  candidates,
  selectedLayer,
  scoringRules,
  existingPosts,
  publishLog,
  recentEntries,
}) {
  const minimumScore = Number(scoringRules.minimumScore || 0.55);
  const ranked = candidates
    .filter((candidate) => candidate.layer === selectedLayer)
    .map((candidate) => {
      const normalized = normalizeForScoring(candidate);
      const scoring = scoreCandidate({
        candidate: normalized,
        scoringRules,
        existingPosts,
        publishLog,
        recentEntries,
      });

      return {
        ...normalized,
        score: scoring.total,
        scoreFactors: scoring.factors,
      };
    })
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((left, right) => right.score - left.score);

  return ranked;
}

function dedupeCandidates(candidates, existingPosts, publishLog) {
  const existingSlugs = new Set((existingPosts || []).map((post) => post.slug));
  const publishedTopicKeys = new Set((publishLog || []).map((entry) => entry.topicKey));
  const publishedKeywordGroups = new Set(
    (publishLog || []).map((entry) => entry.keywordGroup).filter(Boolean),
  );

  return candidates.filter((candidate) => {
    if (publishedTopicKeys.has(candidate.topicKey)) return false;
    if (candidate.keywordGroup && publishedKeywordGroups.has(candidate.keywordGroup)) return false;
    const slugProbe = slugify(candidate.seedTopic);
    return !existingSlugs.has(slugProbe);
  });
}

function pickTopCandidate(rankedCandidates, seed) {
  if (!rankedCandidates.length) return null;
  const topWindow = rankedCandidates.slice(0, Math.min(5, rankedCandidates.length));
  const index = Math.floor(hashToUnitInterval(seed) * topWindow.length) % topWindow.length;
  return topWindow[index];
}

function buildManualCandidate(topic, product = "deal_hunter") {
  return {
    id: `manual-${slugify(topic)}`,
    topicKey: `manual:${slugify(topic)}`,
    layer: "core_editorial",
    cluster: "manual",
    primaryProduct: product,
    intentType: "workflow",
    priority: 0.9,
    seedTopic: topic,
    audience: "creators, creator managers, and small talent teams",
    angle: "Treat the topic as a practical creator business problem with a concrete decision workflow.",
    tags: sanitizeTags(["creator deals", "creator workflow", "collabgrow"]),
    sourceType: "manual_override",
  };
}

function selectCandidate({
  args,
  configBundle,
  manifest,
  publishLog,
  dateString,
  searchConsoleCandidates = [],
}) {
  const recentEntries = getRecentPublishWindow(
    publishLog,
    Number(configBundle.scoringRules.recentPublishWindow || 20),
  );

  if (args.topic) {
    const manualCandidate = buildManualCandidate(args.topic, args.product || "deal_hunter");
    logStep("TOPIC", "Using manual topic override", {
      topic: args.topic,
      product: manualCandidate.primaryProduct,
    });
    return {
      candidate: manualCandidate,
      selectedLayer: manualCandidate.layer,
      rankedPreview: [
        {
          id: manualCandidate.id,
          score: 1,
          layer: manualCandidate.layer,
          seedTopic: manualCandidate.seedTopic,
        },
      ],
    };
  }

  const candidatePool = dedupeCandidates(
    buildCandidatePool(configBundle, args, searchConsoleCandidates),
    manifest.posts || [],
    publishLog,
  );
  const selectedLayer = selectLayer({
    args,
    scoringRules: configBundle.scoringRules,
    publishLog,
    seed: dateString,
  });

  let rankedCandidates = rankCandidates({
    candidates: candidatePool,
    selectedLayer,
    scoringRules: configBundle.scoringRules,
    existingPosts: manifest.posts || [],
    publishLog,
    recentEntries,
  });

  if (!rankedCandidates.length) {
    logStep("TOPIC", "No candidate met the minimum score in selected layer, widening search", {
      selectedLayer,
    });

    rankedCandidates = Object.keys(LAYER_DEFINITIONS)
      .flatMap((layer) =>
        rankCandidates({
          candidates: candidatePool,
          selectedLayer: layer,
          scoringRules: configBundle.scoringRules,
          existingPosts: manifest.posts || [],
          publishLog,
          recentEntries,
        }),
      )
      .sort((left, right) => right.score - left.score);
  }

  const candidate = pickTopCandidate(
    rankedCandidates,
    `${dateString}:${selectedLayer}:${manifest.posts?.length || 0}`,
  );

  if (!candidate) {
    throw new Error("Unable to select a candidate topic from the V1 topic engine.");
  }

  logStep("TOPIC", "Selected candidate", {
    id: candidate.id,
    layer: candidate.layer,
    score: candidate.score,
    product: candidate.primaryProduct,
    sourceType: candidate.sourceType || "library",
    titleHint: candidate.seedTopic,
  });

  return {
    candidate,
    selectedLayer,
    rankedPreview: rankedCandidates.slice(0, 8).map((item) => ({
      id: item.id,
      layer: item.layer,
      score: item.score,
      seedTopic: item.seedTopic,
      primaryProduct: item.primaryProduct,
    })),
  };
}

function pickWeightedKey(weightMap, seed) {
  const entries = Object.entries(weightMap || {}).filter(([, value]) => Number(value) > 0);
  if (!entries.length) return "soft";

  const total = entries.reduce((sum, [, value]) => sum + Number(value), 0);
  let cursor = hashToUnitInterval(seed) * total;
  for (const [key, value] of entries) {
    cursor -= Number(value);
    if (cursor <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function selectCtaStyle({ scoringRules, toneRules, seed, candidate, score }) {
  const style = pickWeightedKey(scoringRules.ctaMix || {}, seed);
  const ctaRules = toneRules.ctaRules || {};
  const strongAllowedLayers = new Set(ctaRules.strongAllowedLayers || []);
  const strongAllowedIntentTypes = new Set(ctaRules.strongAllowedIntentTypes || []);

  if (
    style === "strong"
    && (
      !strongAllowedLayers.has(candidate.layer)
      || !strongAllowedIntentTypes.has(candidate.intentType)
      || Number(score || 0) < Number(ctaRules.strongScoreThreshold || 0.92)
    )
  ) {
    return "soft";
  }

  if (candidate.layer === "core_editorial" || candidate.layer === "trend_linked") {
    return hashToUnitInterval(`${seed}:cta-lite`) > 0.7 ? "weak" : "soft";
  }

  return CTA_STYLE_ORDER.includes(style) ? style : "soft";
}

function selectSecondaryProducts(primaryProduct, candidate) {
  if (primaryProduct === "deal_hunter") {
    if (candidate.cluster === "risk-detection" || candidate.intentType === "red-flags") {
      return ["email_decoder", "brand_analyze"];
    }
    return ["email_decoder"];
  }

  if (primaryProduct === "email_decoder") {
    return candidate.intentType === "red-flags"
      ? ["brand_analyze", "deal_hunter"]
      : ["deal_hunter"];
  }

  if (primaryProduct === "brand_analyze") {
    return ["deal_hunter", "email_decoder"];
  }

  return ["deal_hunter"];
}

function buildToolSectionMarkdown({
  candidate,
  ctaStyle,
  internalLinkingRules,
  seed,
}) {
  const primaryProduct = internalLinkingRules.products[candidate.primaryProduct];
  const secondaryProducts = selectSecondaryProducts(candidate.primaryProduct, candidate)
    .map((key) => internalLinkingRules.products[key])
    .filter(Boolean)
    .slice(0, candidate.layer === "core_editorial" ? 1 : 2);

  const sections = [`## ${internalLinkingRules.toolSectionTitle}`, ""];
  const primaryCtas = primaryProduct?.[`${ctaStyle}Ctas`] || [];
  const primaryText = primaryCtas.length
    ? primaryCtas[
        Math.floor(hashToUnitInterval(`${seed}:${candidate.primaryProduct}`) * primaryCtas.length)
          % primaryCtas.length
      ]
    : "";
  if (primaryProduct && primaryText) {
    sections.push(
      `- [${primaryProduct.label}](${primaryProduct.url}): ${primaryText}`,
    );
  }

  for (const [index, product] of secondaryProducts.entries()) {
    const fallbackPool = [...(product.softCtas || []), ...(product.weakCtas || [])];
    const fallbackText = fallbackPool.length
      ? fallbackPool[
          Math.floor(hashToUnitInterval(`${seed}:${product.label}:${index}`) * fallbackPool.length)
            % fallbackPool.length
        ]
      : "";
    if (!fallbackText) continue;
    sections.push(`- [${product.label}](${product.url}): ${fallbackText}`);
  }

  return sections.join("\n");
}

function scoreRelatedPost(post, candidate) {
  return overlapRatio(buildCandidateText(candidate), `${post.title} ${(post.tags || []).join(" ")}`);
}

function buildRelatedReadingMarkdown({ manifest, candidate, siteBaseUrl, currentSlug, internalLinkingRules }) {
  const baseUrl = normalizeBaseUrl(siteBaseUrl);
  const relatedPosts = sortPostsByDate(manifest.posts || [])
    .filter((post) => post.slug !== currentSlug)
    .map((post) => ({
      ...post,
      relatedScore: scoreRelatedPost(post, candidate),
    }))
    .filter((post) => post.relatedScore > 0.08)
    .slice(0, 3);

  if (!relatedPosts.length) return "";

  const lines = [
    `## ${internalLinkingRules.relatedReadingTitle}`,
    "",
    internalLinkingRules.relatedReadingIntro,
    "",
  ];

  for (const post of relatedPosts) {
    const href = baseUrl ? `${baseUrl}/blog/${post.slug}` : `/blog/${post.slug}`;
    lines.push(`- [${post.title}](${href})`);
  }

  return lines.join("\n");
}

function ensureMarkdownHasH1(markdown, title) {
  const trimmed = String(markdown || "").trim();
  if (/^#\s+/m.test(trimmed)) return trimmed;
  return `# ${title}\n\n${trimmed}`;
}

function appendMarkdownSections(markdown, sections) {
  const normalizedSections = sections.map((section) => String(section || "").trim()).filter(Boolean);
  return [String(markdown || "").trim(), ...normalizedSections].filter(Boolean).join("\n\n");
}

function getTemplateProfile(programmaticLibrary, candidate) {
  const templates = programmaticLibrary.templates || {};
  if (candidate.templateType && templates[candidate.templateType]) {
    return templates[candidate.templateType];
  }
  return null;
}

function buildPromptContext(candidate, internalLinkingRules, queryRules) {
  const product = PRODUCT_CONTEXT[candidate.primaryProduct] || PRODUCT_CONTEXT.deal_hunter;
  const productLinks = internalLinkingRules.products || {};
  const primaryProductLink = productLinks[candidate.primaryProduct];

  return {
    layer: candidate.layer,
    layerLabel: LAYER_DEFINITIONS[candidate.layer]?.label || candidate.layer,
    audience: candidate.audience,
    angle: candidate.angle,
    cluster: candidate.cluster,
    primaryProduct: candidate.primaryProduct,
    primaryProductName: product.name,
    primaryProductUrl: primaryProductLink?.url || "",
    productSummary: product.summary,
    productDifferentiators: product.differentiators,
    reportStructure: product.reportStructure || [],
    brandBlacklist: queryRules.brandTerms || [],
    legacyBlacklist: queryRules.legacyTerms || [],
    templateType: candidate.templateType || candidate.sourceType || candidate.layer,
  };
}

function buildDraftPrompt({
  candidate,
  manifest,
  dateString,
  promptContext,
  templateProfile,
  toneRules,
}) {
  const recentPosts = summarizeRecentPosts(manifest.posts || []);
  const productLine = [
    `${promptContext.primaryProductName}: ${promptContext.productSummary}`,
    `Differentiators: ${promptContext.productDifferentiators.join(" ")}`,
    promptContext.reportStructure?.length
      ? `Useful report dimensions to reference naturally: ${promptContext.reportStructure.join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const bannedPhrases = uniqueStrings(toneRules.bannedPhrases || []).slice(0, 12);
  const templateGoals = templateProfile?.sectionGoals || [];
  const brandContext = candidate.brandName
    ? `Brand context: ${candidate.brandName} often appears in ${candidate.campaignStyle || "creator campaigns"} and tends to fit ${candidate.creatorFit?.join(", ") || "selected creator niches"}.`
    : "";
  const scenarioContext = candidate.niche
    ? `Scenario context: ${toSentenceCase(candidate.niche)} creators on ${candidate.platform} with ${candidate.followerTier}.`
    : "";

  return [
    "You are writing a production blog post for the CollabGrow website.",
    "Return JSON only. Do not wrap it in markdown fences.",
    "Write in English.",
    "Target readers: overseas creators, creator managers, and boutique talent teams evaluating sponsorships.",
    `Tone: ${toneRules.voice?.style || "practical, sharp, operator-minded, clear, helpful"}. No emojis. No hype.`,
    `Write like ${toneRules.voice?.persona || "someone who actually understands creator deal review, inbox triage, and brand diligence"}.`,
    "",
    "Return JSON with this schema:",
    "{",
    '  "title": "string under 70 characters",',
    '  "description": "string under 180 characters",',
    '  "seoTitle": "string under 70 characters",',
    '  "seoDescription": "string under 180 characters",',
    '  "tags": ["3 to 6 lowercase tags"],',
    '  "imagePrompt": "single paragraph for a 1200x630 editorial hero image with no text, no UI, no watermark",',
    '  "markdown": "full markdown article between 1000 and 1500 words"',
    "}",
    "",
    "Article requirements:",
    "- Use one H1 as the article title, then H2/H3 sections.",
    "- Include a short intro, 4 to 6 substantive sections, one FAQ section, and a clear closing takeaway.",
    "- Do not include frontmatter.",
    "- Do not include citations, fake statistics, or references to made-up surveys.",
    "- Do not write generic influencer marketing advice; stay focused on creator sponsorship decisions, outreach review, brand vetting, and real workflows.",
    "- Mention CollabGrow only once or twice and naturally. The product should feel like a tool that supports the workflow, not the subject of the article.",
    "- Do not include external links. Internal tool links will be added later.",
    "- Avoid these old or low-value directions unless directly necessary: generic influencer marketing software, social media growth hacks, all-in-one creator dashboards, broad CRM positioning.",
    "- Keep the prose natural. Do not sound like a template, a sales page, or an SEO content farm article.",
    "- Prefer specific decision criteria, tradeoffs, and examples over motivational filler.",
    "- Use short paragraphs and varied sentence length.",
    "",
    `Selected layer: ${promptContext.layerLabel}`,
    `Template type: ${templateProfile?.briefLabel || promptContext.templateType}`,
    `Audience: ${promptContext.audience}`,
    `Cluster: ${promptContext.cluster}`,
    `Core topic: ${candidate.seedTopic}`,
    `Primary angle: ${candidate.angle}`,
    `Primary product to support naturally: ${promptContext.primaryProductName}`,
    "",
    brandContext,
    scenarioContext,
    templateGoals.length ? `Template section goals: ${templateGoals.join("; ")}.` : "",
    productLine,
    "",
    `Avoid these phrases entirely: ${bannedPhrases.join("; ")}`,
    `Voice goals: ${(toneRules.voice?.goals || []).join("; ")}`,
    `Must-do writing behaviors: ${(toneRules.mustDos || []).join("; ")}`,
    `Patterns to avoid: ${(toneRules.avoidPatterns || []).join("; ")}`,
    "",
    `Publication date: ${dateString}`,
    "Recent posts to avoid overlapping with:",
    JSON.stringify(recentPosts),
  ].filter(Boolean).join("\n");
}

async function generateBlogDraft({
  manifest,
  candidate,
  dateString,
  apiKey,
  baseUrl,
  model,
  internalLinkingRules,
  queryRules,
  toneRules,
  templateProfile,
}) {
  const promptContext = buildPromptContext(candidate, internalLinkingRules, queryRules);
  const prompt = buildDraftPrompt({
    candidate,
    manifest,
    dateString,
    promptContext,
    templateProfile,
    toneRules,
  });

  logStep("AI_TEXT", "Generating blog draft", {
    model,
    layer: candidate.layer,
    topic: candidate.seedTopic,
    product: candidate.primaryProduct,
    existingPosts: manifest.posts?.length || 0,
  });

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
        temperature: 0.85,
        responseMimeType: "application/json",
      },
    },
  });

  const rawText = getTextFromGeminiResponse(response);
  let parsed;

  try {
    parsed = extractJsonText(rawText);
  } catch (error) {
    logError("AI_TEXT", error, {
      phase: "initial-parse",
      rawPreview: rawText.slice(0, 400),
    });

    const balancedSnippet = extractBalancedJsonObject(rawText);
    if (balancedSnippet) {
      try {
        parsed = JSON.parse(balancedSnippet);
      } catch {
        parsed = null;
      }
    }

    if (!parsed) {
      const repairedText = await repairJsonPayload({
        rawText,
        apiKey,
        baseUrl,
        model,
      });
      parsed = extractJsonText(repairedText);
    }
  }

  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();
  const seoTitle = String(parsed.seoTitle || title).trim();
  const seoDescription = String(parsed.seoDescription || description).trim();
  const imagePrompt = String(parsed.imagePrompt || "").trim();
  const rawMarkdown = ensureMarkdownHasH1(String(parsed.markdown || "").trim(), title);
  const mergedTags = sanitizeTags([...(parsed.tags || []), ...(candidate.tags || [])]);

  if (!title || !description || !rawMarkdown || !imagePrompt) {
    throw new Error("Generated article is missing one of: title, description, markdown, imagePrompt.");
  }

  if (getWordCount(rawMarkdown) < 800) {
    throw new Error("Generated markdown is too short for publishing.");
  }

  logStep("AI_TEXT", "Draft generated", {
    title,
    tags: mergedTags,
    wordCount: getWordCount(rawMarkdown),
  });

  return {
    title,
    description,
    seoTitle,
    seoDescription,
    imagePrompt,
    markdown: rawMarkdown,
    tags: mergedTags,
    promptContext,
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
                "No text, no logo, no watermark, no collage, no UI screenshot.",
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

function enrichMarkdown({
  draft,
  manifest,
  candidate,
  slug,
  siteBaseUrl,
  internalLinkingRules,
  scoringRules,
  toneRules,
  score,
}) {
  const ctaStyle = selectCtaStyle({
    scoringRules,
    toneRules,
    seed: `${slug}:${candidate.primaryProduct}:${candidate.layer}`,
    candidate,
    score,
  });

  const toolSection = buildToolSectionMarkdown({
    candidate,
    ctaStyle,
    internalLinkingRules,
    seed: slug,
  });
  const relatedReading = buildRelatedReadingMarkdown({
    manifest,
    candidate,
    siteBaseUrl,
    currentSlug: slug,
    internalLinkingRules,
  });

  const markdown = appendMarkdownSections(draft.markdown, [toolSection, relatedReading]);
  return {
    markdown,
    ctaStyle,
  };
}

function buildPublishLogEntry({
  slug,
  draft,
  candidate,
  ctaStyle,
  score,
  dateString,
}) {
  return {
    id: createStablePostId(),
    publishedAt: new Date().toISOString(),
    publishDate: dateString,
    slug,
    title: draft.title,
    layer: candidate.layer,
    cluster: candidate.cluster,
    topicKey: candidate.topicKey,
    topicId: candidate.id,
    topicSource: candidate.sourceType || "library",
    primaryProduct: candidate.primaryProduct,
    ctaStyle,
    score,
    keywordGroup: candidate.keywordGroup || "",
    templateType: candidate.templateType || "",
    tags: draft.tags,
  };
}

function buildTopicLedgerEntry({
  dateString,
  candidate,
  rankedPreview,
  ctaStyle,
  slug,
}) {
  return {
    id: createStablePostId(),
    recordedAt: new Date().toISOString(),
    date: dateString,
    slug,
    selected: {
      id: candidate.id,
      topicKey: candidate.topicKey,
      layer: candidate.layer,
      cluster: candidate.cluster,
      topic: candidate.seedTopic,
      primaryProduct: candidate.primaryProduct,
      templateType: candidate.templateType || "",
      sourceType: candidate.sourceType || "library",
      score: candidate.score || 0,
      ctaStyle,
      keywordGroup: candidate.keywordGroup || "",
    },
    rankedPreview,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logStep("BOOT", "Starting blog publisher", {
    dryRun: args.dryRun,
    topicOverride: args.topic || "",
    layerOverride: args.layer || "",
    productOverride: args.product || "",
  });

  await loadLocalEnvFiles();
  const configBundle = await loadV1ConfigBundle();
  logStep("CONFIG", "Loaded V1 content configuration", {
    topicCounts: {
      coreEditorial: configBundle.topicLibrary.coreEditorial?.length || 0,
      toolProblem: configBundle.topicLibrary.toolProblem?.length || 0,
      trendLinked: configBundle.topicLibrary.trendLinked?.length || 0,
      brands: configBundle.programmaticLibrary.brands?.length || 0,
      emailScenarios: configBundle.programmaticLibrary.emailScenarios?.length || 0,
      creatorScenarios: configBundle.programmaticLibrary.creatorScenarios?.length || 0,
    },
  });

  const projectRoot = getProjectRoot();
  const timeZone = getEnv("BLOG_TIMEZONE", DEFAULT_TIMEZONE);
  const now = new Date();
  const { year, month, date } = formatDateParts(now, timeZone);
  const siteBaseUrl = await getSiteBaseUrl(projectRoot);

  const secret = getEnv("BLOG_REVALIDATE_SECRET", DEFAULT_REVALIDATE_SECRET);
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

  const manifest = manifestContext.manifest || {
    version: "",
    generatedAt: "",
    total: 0,
    posts: [],
  };
  const searchConsoleContext = await getSearchConsoleContext(configBundle.queryRules, siteBaseUrl);
  logStep("SEARCH_CONSOLE", "Resolved query source", {
    ok: searchConsoleContext.ok,
    source: searchConsoleContext.source,
    reason: searchConsoleContext.reason || "",
    rows: searchConsoleContext.rows?.length || 0,
    candidates: searchConsoleContext.candidates?.length || 0,
    credentialKind: searchConsoleContext.credentialKind || "",
  });
  if (searchConsoleContext.ok && searchConsoleContext.candidates?.length) {
    logStep("SEARCH_CONSOLE", "Top usable queries", {
      queries: searchConsoleContext.candidates.slice(0, 5).map((item) => ({
        seedTopic: item.seedTopic,
        product: item.primaryProduct,
        layer: item.layer,
        impressions: item.searchConsole?.impressions || 0,
        relevance: item.searchConsole?.relevanceScore || 0,
        opportunity: item.searchConsole?.opportunityScore || 0,
      })),
    });
  }

  if (!aiApiKey) {
    throw new Error("Missing BLOG_AI_API_KEY.");
  }

  const publishLog = await readPublishLog();
  const selection = selectCandidate({
    args,
    configBundle,
    manifest,
    publishLog,
    dateString: date,
    searchConsoleCandidates: searchConsoleContext.ok ? searchConsoleContext.candidates : [],
  });
  const candidate = selection.candidate;
  const templateProfile = getTemplateProfile(configBundle.programmaticLibrary, candidate);

  const draft = await generateBlogDraft({
    manifest,
    candidate,
    dateString: date,
    apiKey: aiApiKey,
    baseUrl: aiBaseUrl,
    model: textModel,
    internalLinkingRules: configBundle.internalLinkingRules,
    queryRules: configBundle.queryRules,
    toneRules: configBundle.toneRules,
    templateProfile,
  });

  const existingSlugs = new Set((manifest.posts || []).map((post) => post.slug));
  const slug = ensureUniqueSlug(slugify(draft.title), existingSlugs);
  logStep("PLAN", "Resolved slug", {
    slug,
    title: draft.title,
    layer: candidate.layer,
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

  const enriched = enrichMarkdown({
    draft,
    manifest,
    candidate,
    slug,
    siteBaseUrl,
    internalLinkingRules: configBundle.internalLinkingRules,
    scoringRules: configBundle.scoringRules,
    toneRules: configBundle.toneRules,
    score: candidate.score || 1,
  });

  logStep("PLAN", "Resolved output targets", {
    imageKey,
    documentKey,
    manifestUrl: fixedManifestUrl,
    ctaStyle: enriched.ctaStyle,
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
    markdown: enriched.markdown,
    tags: draft.tags.length ? draft.tags : ["creator deals", "collabgrow", "blog"],
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
  const publishLogEntry = buildPublishLogEntry({
    slug,
    draft,
    candidate,
    ctaStyle: enriched.ctaStyle,
    score: candidate.score || 1,
    dateString: date,
  });
  const topicLedgerEntry = buildTopicLedgerEntry({
    dateString: date,
    candidate,
    rankedPreview: selection.rankedPreview,
    ctaStyle: enriched.ctaStyle,
    slug,
  });

  logStep("MANIFEST", "Prepared next manifest", {
    totalPosts: nextManifest.total,
    slug,
    layer: candidate.layer,
    primaryProduct: candidate.primaryProduct,
  });

  if (args.dryRun) {
    await appendTopicLedger(topicLedgerEntry);
    const previewPath = await writePreviewArtifacts(slug, {
      candidate,
      templateProfile,
      rankedPreview: selection.rankedPreview,
      currentManifestUrl: manifestContext.manifestUrl,
      nextManifestUrl: fixedManifestUrl,
      imageKey,
      documentKey,
      ctaStyle: enriched.ctaStyle,
      postDocument,
      nextManifest,
      publishLogEntry,
      topicLedgerEntry,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          slug,
          topic: candidate.seedTopic,
          layer: candidate.layer,
          primaryProduct: candidate.primaryProduct,
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
  const verification = await verifyPublishedPost({
    siteBaseUrl,
    slug,
  });
  await appendPublishLog(publishLogEntry);
  await appendTopicLedger(topicLedgerEntry);

  logStep("VERIFY", "Publish flow completed", {
    slug,
    verificationAvailable: Boolean(verification?.post?.slug),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        slug,
        topic: candidate.seedTopic,
        layer: candidate.layer,
        primaryProduct: candidate.primaryProduct,
        manifestUrl: fixedManifestUrl,
        imageUrl,
        documentUrl,
        revalidateResult,
        verification: verification
          ? {
              slug: verification.post?.slug,
              title: verification.post?.title,
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
