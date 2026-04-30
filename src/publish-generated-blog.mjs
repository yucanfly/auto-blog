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
const DEFAULT_TREND_LOOKBACK_HOURS = 72;
const DEFAULT_TREND_LANG = "en";
const DEFAULT_TREND_COUNTRY = "us";
const DEFAULT_DINGTALK_WEBHOOK = "";
const DEFAULT_DEAL_BOARD_BASE_API = "https://api-prd.wotohub.com";
const DEFAULT_DEAL_BOARD_ENDPOINT = "/lgi-ai/api/v2/campaign/creator/dealBoard";
const DEFAULT_DEAL_DETAIL_ENDPOINT = "/lgi-ai/api/v2/campaign/creator/dealDetail";

const NOTIFICATION_STEP_ORDER = [
  "BOOT",
  "TOPIC_SELECTION",
  "AI_TEXT",
  "AI_IMAGE",
  "OSS_UPLOAD",
  "MANIFEST_UPDATE",
  "REVALIDATE",
  "VERIFY",
];

const NOTIFICATION_STEP_LABELS = {
  BOOT: "启动初始化",
  TOPIC_SELECTION: "选题生成",
  AI_TEXT: "正文生成",
  AI_IMAGE: "主图生成",
  OSS_UPLOAD: "OSS 上传",
  MANIFEST_UPDATE: "Manifest 更新",
  REVALIDATE: "网站刷新",
  VERIFY: "上线校验",
};

const LAYER_LABELS_ZH = {
  core_editorial: "核心专题内容",
  tool_problem: "工具问题内容",
  controlled_programmatic: "程序化内容",
  trend_linked: "趋势关联内容",
};

const PRODUCT_LABELS_ZH = {
  deal_hunter: "Deal Hunter",
  email_decoder: "Email Decoder",
  brand_analyze: "Brand Analyze",
};

const LIFECYCLE_STAGE_LABELS_ZH = {
  readiness: "接单准备",
  discovery: "找单发现",
  evaluation: "机会判断",
  execution: "推进执行",
  optimization: "复盘优化",
};

const SOURCE_LABELS_ZH = {
  library: "主题库",
  topic_library: "主题库",
  search_console: "Search Console",
  trend_signal: "趋势信号",
  programmatic_seed: "程序化种子",
  deal_board_category: "商单分类信号",
  deal_board_spotlight: "商单精选信号",
  forced_topic: "手动指定主题",
};

const STATUS_ICONS = {
  success: "✅",
  failed: "❌",
  skipped: "⏭️",
  running: "🟡",
};

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

const COVER_STYLE_PROFILES = {
  core_editorial: {
    styleKey: "core_editorial",
    label: "Editorial workspace",
    direction:
      "A thoughtful editorial scene that feels like a creator or strategist is actively reviewing sponsorship decisions.",
    composition:
      "Use a clean desk or studio composition with depth, natural asymmetry, and one clear focal point rather than a perfectly centered product shot.",
    palette:
      "Neutral and grounded colors such as warm whites, soft grays, charcoal, muted wood tones, and one restrained accent color.",
    motifs: [
      "structured notes",
      "research materials",
      "creator workspace",
      "subtle decision-making atmosphere",
    ],
    avoid: [
      "generic stock office look",
      "social-media icon clutter",
      "fake UI panels",
      "overly glossy startup illustration style",
    ],
  },
  tool_problem: {
    styleKey: "tool_problem",
    label: "Focused analytical review",
    direction:
      "A more task-oriented image showing close review, triage, or analysis around a creator deal decision.",
    composition:
      "Frame a tighter scene with documents, a laptop, marked-up notes, or a creator reviewing details in a focused way.",
    palette:
      "Cooler neutrals with soft blue-gray accents, keeping the overall scene calm, sharp, and practical.",
    motifs: [
      "brief review",
      "email triage",
      "brand research notes",
      "decision support",
    ],
    avoid: [
      "futuristic HUD interfaces",
      "cyberpunk glow",
      "fake dashboards",
      "busy split-screen collage",
    ],
  },
  controlled_programmatic: {
    styleKey: "controlled_programmatic",
    label: "Structured creator opportunity scene",
    direction:
      "A practical creator-opportunity visual with slightly more context and specificity than the evergreen editorial layer.",
    composition:
      "Use strong context cues and a recognizable creator-workflow scene, while still keeping the image polished and uncluttered.",
    palette:
      "Balanced neutrals with one or two category-appropriate accent colors.",
    motifs: [
      "campaign evaluation",
      "creator workflow",
      "product or niche context",
      "decision moment",
    ],
    avoid: [
      "random lifestyle stock photo",
      "flat abstract gradient only",
      "generic coworking office scene",
      "heavy sales-banner feel",
    ],
  },
  trend_linked: {
    styleKey: "trend_linked",
    label: "Timely creator-economy update",
    direction:
      "A timely image that suggests change, movement, or pressure in the creator economy without looking like a news banner.",
    composition:
      "Use layered visual depth, motion cues, or a subtle sense of urgency while keeping one dominant subject or scene.",
    palette:
      "Slightly higher contrast than other layers, with controlled blues, oranges, reds, or dark neutrals used sparingly.",
    motifs: [
      "platform change",
      "market shift",
      "creator economy tension",
      "sponsorship risk or update context",
    ],
    avoid: [
      "breaking-news broadcast graphics",
      "large alert symbols",
      "headline banner layouts",
      "sensational clickbait imagery",
    ],
  },
};

const CONTROLLED_PROGRAMMATIC_COVER_STYLES = {
  brand_review: {
    styleKey: "brand_review",
    label: "Brand review still life",
    direction:
      "A category-aware brand evaluation visual that feels like a creator is assessing whether a brand fits their audience and workflow.",
    composition:
      "Use tactile category objects or a refined product-context still life rather than a generic workspace, and let the scene imply review and fit judgment.",
    palette:
      "Category-aware but restrained: polished, premium, and never loud.",
    motifs: [
      "brand category cues",
      "creator fit research",
      "product texture",
      "reputation review mood",
    ],
    avoid: [
      "visible brand logos",
      "e-commerce product grid",
      "unboxing thumbnail style",
      "direct ad creative look",
    ],
  },
  email_pattern: {
    styleKey: "email_pattern",
    label: "Inbox triage scene",
    direction:
      "A creator-side outreach review scene centered on inbox triage, hidden asks, and decision-making under uncertainty.",
    composition:
      "Focus on a desk, notebook, printouts, or a laptop in a close analytical setup that implies someone is reading between the lines of a deal email.",
    palette:
      "Cool neutrals with subtle off-white paper textures and restrained accent colors.",
    motifs: [
      "annotated notes",
      "creator inbox review",
      "deal qualification",
      "hidden workload signals",
    ],
    avoid: [
      "literal email app screenshots",
      "floating mail icons",
      "marketing stock handshake imagery",
      "cartoon scam visuals",
    ],
  },
  creator_scenario: {
    styleKey: "creator_scenario",
    label: "Niche creator environment",
    direction:
      "A creator environment specific to a niche, platform, or audience tier, showing how deal decisions live inside a real content workflow.",
    composition:
      "Use a realistic creator setup or production environment that reflects the niche and platform without becoming a staged influencer portrait.",
    palette:
      "Adapt to the niche while keeping the overall scene clean and editorial.",
    motifs: [
      "platform-native setup",
      "creator production environment",
      "niche-specific props",
      "audience-trust atmosphere",
    ],
    avoid: [
      "selfie-style influencer pose",
      "generic smiling portrait",
      "ring-light cliche",
      "thumbnail-face expression style",
    ],
  },
  category_roundup: {
    styleKey: "category_roundup",
    label: "Curated opportunity roundup",
    direction:
      "A curated creator-opportunity visual that suggests scanning and shortlisting multiple live deals in one niche or category.",
    composition:
      "Show a richer scene with category cues, shortlist energy, and several subtle opportunity signals, but avoid anything that looks like an actual UI board.",
    palette:
      "Use a broader but controlled palette that reflects the category and feels active without looking noisy.",
    motifs: [
      "opportunity curation",
      "shortlist building",
      "category-specific products or props",
      "creator browsing and filtering mood",
    ],
    avoid: [
      "kanban board UI",
      "coupon flyer feeling",
      "shopping-catalog layout",
      "collage of many small disconnected objects",
    ],
  },
  deal_spotlight: {
    styleKey: "deal_spotlight",
    label: "Featured campaign decision",
    direction:
      "A high-intent creator decision moment centered on one standout campaign and the practical tradeoffs behind it.",
    composition:
      "Use a tighter focal composition that suggests one featured brief, one decision, and one clear question of fit, timing, or payoff.",
    palette:
      "Slightly bolder contrast than general editorial, but still polished and premium.",
    motifs: [
      "featured campaign brief",
      "deadline pressure",
      "compensation versus workload",
      "apply-or-pass judgment",
    ],
    avoid: [
      "celebratory jackpot imagery",
      "cash explosion metaphors",
      "app notification graphics",
      "flashy affiliate-banner style",
    ],
  },
};

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

function createStepTracker() {
  const steps = Object.fromEntries(
    NOTIFICATION_STEP_ORDER.map((step) => [
      step,
      {
        status: "pending",
        startedAt: 0,
        finishedAt: 0,
        durationMs: 0,
        details: {},
        error: "",
      },
    ]),
  );

  return {
    start(step, details = {}) {
      if (!steps[step]) return;
      steps[step] = {
        ...steps[step],
        status: "running",
        startedAt: Date.now(),
        details: {
          ...steps[step].details,
          ...details,
        },
      };
    },
    success(step, details = {}) {
      if (!steps[step]) return;
      const finishedAt = Date.now();
      const startedAt = steps[step].startedAt || finishedAt;
      steps[step] = {
        ...steps[step],
        status: "success",
        finishedAt,
        durationMs: finishedAt - startedAt,
        details: {
          ...steps[step].details,
          ...details,
        },
      };
    },
    fail(step, error, details = {}) {
      if (!steps[step]) return;
      const finishedAt = Date.now();
      const startedAt = steps[step].startedAt || finishedAt;
      steps[step] = {
        ...steps[step],
        status: "failed",
        finishedAt,
        durationMs: finishedAt - startedAt,
        details: {
          ...steps[step].details,
          ...details,
        },
        error: error instanceof Error ? error.message : String(error || ""),
      };
    },
    skip(step, details = {}) {
      if (!steps[step]) return;
      steps[step] = {
        ...steps[step],
        status: "skipped",
        finishedAt: Date.now(),
        details: {
          ...steps[step].details,
          ...details,
        },
      };
    },
    snapshot() {
      return NOTIFICATION_STEP_ORDER.map((step) => ({
        step,
        label: NOTIFICATION_STEP_LABELS[step] || step,
        ...steps[step],
      }));
    },
  };
}

function formatExecutionDateTime(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${formatter.format(date)}（${timeZone}）`;
  } catch {
    return `${date.toISOString()}（${timeZone}）`;
  }
}

function truncateText(value, maxLength = 240) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function formatDuration(durationMs) {
  const safe = Number(durationMs || 0);
  if (!safe) return "";
  if (safe < 1000) return `${safe}ms`;
  return `${(safe / 1000).toFixed(1)}s`;
}

function escapeMarkdownText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/>/g, "&gt;");
}

function buildStepLines(stepTracker) {
  return stepTracker.snapshot().map((stepState) => {
    const icon = STATUS_ICONS[stepState.status] || "•";
    const duration = formatDuration(stepState.durationMs);
    const suffix = duration ? `（${duration}）` : "";
    const statusLabel =
      stepState.status === "success"
        ? "成功"
        : stepState.status === "failed"
          ? "失败"
          : stepState.status === "skipped"
            ? "已跳过"
            : stepState.status === "running"
              ? "进行中"
              : "未执行";
    return `- ${icon} ${stepState.label}：${statusLabel}${suffix}`;
  });
}

function buildDingTalkMarkdown({
  status,
  args,
  runState,
  stepTracker,
}) {
  const isDryRun = Boolean(args.dryRun);
  const isSuccess = status === "success";
  const isDry = status === "dry_run";
  const header = isSuccess
    ? "## ✅ 发布成功"
    : isDry
      ? "## 🧪 演练完成（未正式发布）"
      : "## ❌ 发布失败";

  const modeLabel = isDryRun ? "Dry Run" : "正式发布";
  const executionTime = formatExecutionDateTime(runState.startedAt || new Date(), runState.timeZone);
  const sequenceNumber = runState.sequenceNumber ? `第 ${runState.sequenceNumber} 篇` : "未确定";
  const titleLineLabel = isSuccess || isDry ? "文章标题" : "拟定标题";
  const slugLineLabel = isSuccess || isDry ? "文章 Slug" : "拟定 Slug";
  const selectedSource = SOURCE_LABELS_ZH[runState.sourceType] || runState.sourceType || "未确定";
  const layerLabel = LAYER_LABELS_ZH[runState.layer] || runState.layer || "未确定";
  const lifecycleLabel =
    LIFECYCLE_STAGE_LABELS_ZH[runState.lifecycleStage] || runState.lifecycleStage || "未确定";
  const productLabel = PRODUCT_LABELS_ZH[runState.primaryProduct] || runState.primaryProduct || "未确定";
  const lines = [
    "# 🤖 Blog 自动发布通知",
    "",
    header,
    `- 🕒 执行时间：${executionTime}`,
    `- 🚀 执行模式：${modeLabel}`,
    "- 🌍 执行环境：GitHub Actions",
    `- 🧮 自动生成序号：${sequenceNumber}${isSuccess ? "" : isDry ? "（预估）" : "（预期）"}`,
    "",
    "## 📝 本次文章",
    `- 📚 内容层级：${layerLabel}`,
    `- 🔄 流程阶段：${lifecycleLabel}`,
    `- 🧭 选题来源：${selectedSource}`,
    `- 🎯 关联产品：${productLabel}`,
  ];

  if (runState.title) {
    lines.push(`- 🏷️ ${titleLineLabel}：${escapeMarkdownText(runState.title)}`);
  }
  if (runState.slug) {
    lines.push(`- 🔗 ${slugLineLabel}：${escapeMarkdownText(runState.slug)}`);
  }

  lines.push("", "## ⚙️ 执行步骤", ...buildStepLines(stepTracker));

  if (isSuccess) {
    lines.push(
      "",
      "## 📦 发布结果",
      `- 🌐 文章页面：${runState.pageUrl || "未生成"}`,
      `- 🗂️ Manifest 地址：${runState.manifestUrl || "未生成"}`,
      `- 📄 文章 JSON：${runState.documentUrl || "未生成"}`,
      `- 🖼️ 主图地址：${runState.imageUrl || "未生成"}`,
    );
  } else if (!isDry && (runState.manifestUrl || runState.documentUrl)) {
    lines.push("", "## 🔎 排查线索");
    if (runState.manifestUrl) {
      lines.push(`- 🗂️ Manifest 地址：${runState.manifestUrl}`);
    }
    if (runState.documentUrl) {
      lines.push(`- 📄 文章 JSON：${runState.documentUrl}`);
    }
  }

  lines.push("", "## 📊 内容摘要");
  if (runState.wordCount) lines.push(`- 🔢 文章字数：${runState.wordCount}`);
  if (runState.tags?.length) lines.push(`- 🏷️ 标签：${escapeMarkdownText(runState.tags.join(", "))}`);
  if (runState.ctaStyle) lines.push(`- 🪄 CTA 类型：${runState.ctaStyle}`);
  lines.push(`- 🔍 Search Console 候选数：${runState.searchConsoleCandidateCount || 0}`);
  lines.push(`- 📰 趋势候选数：${runState.trendCandidateCount || 0}`);
  lines.push(`- 🎁 商单供给候选数：${runState.dealBoardCandidateCount || 0}`);

  if (!isSuccess) {
    lines.push("", "## 🚨 错误信息");
    if (runState.failedStepLabel) {
      lines.push(`- 📍 失败步骤：${runState.failedStepLabel}`);
    }
    if (runState.errorMessage) {
      lines.push(`- 💬 错误原因：${escapeMarkdownText(truncateText(runState.errorMessage, 600))}`);
    }
  }

  lines.push("", "> 本消息由 Blog 自动化流水线生成");
  return lines.join("\n");
}

function buildSignedDingTalkWebhook(webhook, secret) {
  const rawWebhook = String(webhook || "").trim();
  if (!rawWebhook) return "";

  if (!secret) return rawWebhook;

  const timestamp = Date.now();
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto
    .createHmac("sha256", secret)
    .update(stringToSign)
    .digest("base64");
  const url = new URL(rawWebhook);
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", sign);
  return url.toString();
}

async function sendDingTalkNotification({ webhook, secret, title, markdownText }) {
  if (!webhook) {
    logStep("DINGTALK", "Webhook not configured, skipping notification");
    return {
      ok: false,
      skipped: true,
    };
  }

  const signedWebhook = buildSignedDingTalkWebhook(webhook, secret);
  logStep("DINGTALK", "Sending DingTalk notification", {
    title,
    signed: Boolean(secret),
  });
  const response = await fetch(signedWebhook, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title,
        text: markdownText,
      },
    }),
  });

  const responseText = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(
      `DingTalk webhook failed (${response.status} ${response.statusText}): ${responseText.slice(0, 500)}`,
    );
  }

  let parsed;
  try {
    parsed = responseText ? JSON.parse(responseText) : {};
  } catch {
    parsed = null;
  }

  if (parsed && Number(parsed.errcode || 0) !== 0) {
    throw new Error(
      `DingTalk webhook rejected the message (errcode: ${parsed.errcode}, errmsg: ${parsed.errmsg || "unknown error"})`,
    );
  }

  logStep("DINGTALK", "Notification delivered", {
    response: responseText.slice(0, 200),
  });
  return {
    ok: true,
    responseText,
    signedWebhook,
  };
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
    candidateId: "",
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

    if (value === "--candidate-id") {
      args.candidateId = String(argv[index + 1] || "").trim();
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

async function postJson(url, payload, options = {}) {
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: JSON.stringify(payload || {}),
  });
}

function createDealPageSlug(title, fallback = "") {
  const normalized = String(title || fallback || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  const slug = normalized
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || fallback || `deal-${Date.now()}`;
}

function createDealPageUrl(siteBaseUrl, campaignId, title) {
  if (!siteBaseUrl || !campaignId) return "";
  return `${normalizeBaseUrl(siteBaseUrl)}/deal-hunter/deals/${campaignId}/${createDealPageSlug(title, campaignId)}`;
}

function createDealCategoryUrl(siteBaseUrl, categoryLabel) {
  if (!siteBaseUrl || !categoryLabel) return "";
  return `${normalizeBaseUrl(siteBaseUrl)}/deal-hunter/category/${slugify(categoryLabel)}`;
}

function getMonthYearLabel(dateString, timeZone = DEFAULT_TIMEZONE) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(date);
}

function buildCategoryLookup(dealCategoryMap) {
  const entries = Array.isArray(dealCategoryMap) ? dealCategoryMap : [];
  const lookup = new Map();
  for (const item of entries) {
    const code = String(item?.code || "").trim();
    const label = String(item?.label || "").trim();
    if (code && label) lookup.set(code, label);
  }
  return lookup;
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
  targetLandingPages,
  contentCluster,
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
    targetLandingPages: uniqueStrings(targetLandingPages || []),
    contentCluster: String(contentCluster || "").trim() || undefined,
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
    targetLandingPages: postDocument.targetLandingPages,
    contentCluster: postDocument.contentCluster,
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
  const [
    topicLibrary,
    programmaticLibrary,
    landingPageSupportLibrary,
    queryRules,
    scoringRules,
    internalLinkingRules,
    toneRules,
    trendRules,
    dealBoardRules,
    dealCategoryMap,
  ] =
    await Promise.all([
      loadJsonData("topic-library.json"),
      loadJsonData("programmatic-library.json"),
      loadJsonData("landing-page-support.json"),
      loadJsonData("query-rules.json"),
      loadJsonData("scoring-rules.json"),
      loadJsonData("internal-linking-rules.json"),
      loadJsonData("tone-rules.json"),
      loadJsonData("trend-rules.json"),
      loadJsonData("deal-board-rules.json"),
      loadJsonData("deal-category-map.json"),
    ]);

  return {
    topicLibrary,
    programmaticLibrary,
    landingPageSupportLibrary,
    queryRules,
    scoringRules,
    internalLinkingRules,
    toneRules,
    trendRules,
    dealBoardRules,
    dealCategoryMap,
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

function classifySearchConsoleLifecycleStage(query, layer, productKey) {
  const normalized = normalizeSearchConsoleQuery(query);
  if (normalized.includes("profile") || normalized.includes("rate card") || normalized.includes("media kit")) {
    return "readiness";
  }
  if (
    normalized.includes("brand deal")
    || normalized.includes("paidcollab")
    || normalized.includes("opportunity")
    || layer === "core_editorial"
  ) {
    return "discovery";
  }
  if (
    productKey === "email_decoder"
    || productKey === "brand_analyze"
    || normalized.includes("legit")
    || normalized.includes("checker")
    || normalized.includes("review")
  ) {
    return "evaluation";
  }
  if (normalized.includes("reply") || normalized.includes("follow up")) {
    return "execution";
  }
  if (normalized.includes("improve") || normalized.includes("why")) {
    return "optimization";
  }
  return "evaluation";
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
    const lifecycleStage = classifySearchConsoleLifecycleStage(row.query, layer, productKey);
    const relevanceScore = computeSearchConsoleRelevance(row.query, queryRules);
    const opportunityScore = computeSearchConsoleOpportunity(row);
    const priority = clamp(0.58 + relevanceScore * 0.22 + opportunityScore * 0.2);
    return {
      id: `search-console-${slugify(row.query)}`,
      topicKey: `search-console:${slugify(row.query)}`,
      layer,
      lifecycleStage,
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

function getIsoTimestampHoursAgo(hours) {
  const date = new Date();
  date.setUTCHours(date.getUTCHours() - Number(hours || DEFAULT_TREND_LOOKBACK_HOURS));
  return date.toISOString();
}

function normalizeTrendText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function fetchTrendJson(url, options = {}) {
  logStep("TREND", "Fetching trend source", {
    url,
  });
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Trend source request failed (${response.status} ${response.statusText}): ${errorText.slice(0, 400)}`,
    );
  }
  return response.json();
}

function normalizeCurrentsArticle(article, bucketId) {
  return {
    provider: "currents",
    bucketId,
    title: String(article.title || "").trim(),
    description: String(article.description || "").trim(),
    url: String(article.url || "").trim(),
    sourceName: String(article.author || article.source || "Currents").trim(),
    publishedAt: String(article.published || article.publishedAt || "").trim(),
    language: String(article.language || "").trim().toLowerCase(),
    categories: Array.isArray(article.category) ? article.category : [],
  };
}

function normalizeGNewsArticle(article, bucketId) {
  return {
    provider: "gnews",
    bucketId,
    title: String(article.title || "").trim(),
    description: String(article.description || "").trim(),
    url: String(article.url || "").trim(),
    sourceName: String(article.source?.name || article.source?.url || "GNews").trim(),
    publishedAt: String(article.publishedAt || "").trim(),
    language: String(article.language || "").trim().toLowerCase(),
    categories: Array.isArray(article.keywords) ? article.keywords : [],
  };
}

async function fetchCurrentsArticles({ apiKey, trendRules }) {
  if (!apiKey) return [];
  const sourceConfig = trendRules.sources?.currents || {};
  const url = new URL(sourceConfig.baseUrl || "https://api.currentsapi.services/v1/search");
  url.searchParams.set("keywords", sourceConfig.query || "");
  url.searchParams.set("language", getEnv("BLOG_TREND_LANG", sourceConfig.language || DEFAULT_TREND_LANG));
  url.searchParams.set(
    "page_size",
    String(
      Math.min(
        Number(sourceConfig.pageSize || trendRules.maxCandidates || 12),
        Number(trendRules.maxCandidates || 12),
      ),
    ),
  );

  const payload = await fetchTrendJson(url.toString(), {
    headers: {
      Authorization: apiKey,
    },
  });

  return (payload.news || []).map((article) => normalizeCurrentsArticle(article, "aggregate"));
}

async function fetchGNewsArticles({ apiKey, trendRules }) {
  if (!apiKey) return [];
  const sourceConfig = trendRules.sources?.gnews || {};
  const url = new URL(sourceConfig.baseUrl || "https://gnews.io/api/v4/search");
  url.searchParams.set("q", sourceConfig.query || "");
  url.searchParams.set("lang", getEnv("BLOG_TREND_LANG", sourceConfig.language || DEFAULT_TREND_LANG));
  url.searchParams.set(
    "country",
    getEnv("BLOG_TREND_COUNTRY", sourceConfig.country || DEFAULT_TREND_COUNTRY),
  );
  url.searchParams.set(
    "max",
    String(
      Math.min(
        Number(sourceConfig.max || trendRules.maxCandidates || 12),
        Number(trendRules.maxCandidates || 12),
      ),
    ),
  );
  url.searchParams.set("in", sourceConfig.in || "title,description");
  url.searchParams.set("apikey", apiKey);

  const payload = await fetchTrendJson(url.toString());
  return (payload.articles || []).map((article) => normalizeGNewsArticle(article, "aggregate"));
}

function dedupeTrendArticles(articles) {
  const seen = new Set();
  const deduped = [];

  for (const article of articles || []) {
    const key = `${normalizeTrendText(article.title)}|${normalizeTrendText(article.url)}`;
    if (!article.title || !article.url || seen.has(key)) continue;
    seen.add(key);
    deduped.push(article);
  }

  return deduped;
}

function getTrendAgeHours(publishedAt) {
  const timestamp = new Date(publishedAt || 0).getTime();
  if (!timestamp) return 9999;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
}

function mapTrendProduct(article, trendRules, queryRules) {
  const text = `${article.title} ${article.description}`.toLowerCase();
  const bucket = (trendRules.queryBuckets || []).find((item) => item.id === article.bucketId);

  if (bucket?.primaryProduct) return bucket.primaryProduct;
  return classifySearchConsoleProduct(text, queryRules);
}

function classifyTrendBucket(article) {
  const text = normalizeTrendText(`${article.title} ${article.description}`);

  if (
    /(youtube|tiktok|instagram|reddit|twitter|\bx\b)/.test(text)
    && /(policy|guideline|monetization|disclosure|ads|partnership)/.test(text)
  ) {
    return "platform-policy-and-disclosure";
  }

  if (/(email|outreach|inbox|reply|pitch)/.test(text)) {
    return "email-outreach-and-inbox";
  }

  if (/(brand|campaign|partner)/.test(text) && /(legitimacy|reputation|review|risk|scam|fraud|safety)/.test(text)) {
    return "brand-vetting-and-trust";
  }

  return "creator-sponsorship-risk";
}

function scoreTrendArticle(article, trendRules) {
  const text = normalizeTrendText(`${article.title} ${article.description} ${(article.categories || []).join(" ")}`);
  const creatorHits = countMatchingTerms(text, trendRules.creatorTerms || []);
  const businessHits = countMatchingTerms(text, trendRules.businessTerms || []);
  const platformHits = countMatchingTerms(text, trendRules.platformTerms || []);
  const priorityHits = countMatchingTerms(text, trendRules.priorityThemes || []);
  const blockedHits = countMatchingTerms(text, trendRules.blockedTerms || []);
  const ageHours = getTrendAgeHours(article.publishedAt);
  const freshnessScore =
    ageHours <= 24 ? 1
      : ageHours <= 48 ? 0.82
        : ageHours <= 72 ? 0.68
          : ageHours <= 120 ? 0.45
            : 0.2;

  const relevanceScore = clamp(
    creatorHits * 0.18
      + businessHits * 0.16
      + platformHits * 0.08
      + priorityHits * 0.12
      - blockedHits * 0.25,
  );

  const totalScore = clamp(relevanceScore * 0.62 + freshnessScore * 0.38);

  return {
    totalScore,
    relevanceScore,
    freshnessScore,
    creatorHits,
    businessHits,
    platformHits,
    priorityHits,
    blockedHits,
    ageHours,
  };
}

function shouldKeepTrendArticle(article, scoring) {
  if (!article.title || !article.url) return false;
  if (scoring.blockedHits > 0) return false;
  if (scoring.businessHits < 1) return false;
  if (scoring.creatorHits < 1 && scoring.platformHits < 1) return false;
  return true;
}

function buildTrendSeedTopic(article, bucket, productKey) {
  const sourceTitle = String(article.title || "").trim();

  if (bucket?.cluster === "platform-policy-and-disclosure") {
    return `What ${sourceTitle} means for creators reviewing sponsorships right now`;
  }

  if (productKey === "email_decoder") {
    return `How creators should respond when ${sourceTitle.toLowerCase()} affects inbound brand outreach`;
  }

  if (productKey === "brand_analyze") {
    return `What creators should check when ${sourceTitle.toLowerCase()} changes brand trust signals`;
  }

  return `Why ${sourceTitle.toLowerCase()} matters when creators qualify brand deals`;
}

function buildTrendAngle(article, bucket, productKey) {
  const providerLabel = article.provider === "currents" ? "Currents" : "GNews";
  const productName = PRODUCT_CONTEXT[productKey]?.name || PRODUCT_CONTEXT.deal_hunter.name;
  return [
    `Use the recent signal from ${providerLabel} as a timeliness hook, but turn it into practical guidance for creators.`,
    `Explain what changed, why it matters for sponsorship decisions, and how ${productName} can support better judgment.`,
    article.description ? `Key signal summary: ${article.description}` : "",
  ].filter(Boolean).join(" ");
}

function buildTrendCandidates(articles, trendRules, queryRules) {
  const buckets = Object.fromEntries((trendRules.queryBuckets || []).map((bucket) => [bucket.id, bucket]));

  return (articles || [])
    .map((article) => {
      const classifiedBucketId = classifyTrendBucket(article);
      article.bucketId = classifiedBucketId;
      const bucket = buckets[article.bucketId] || null;
      const scoring = scoreTrendArticle(article, trendRules);
      if (
        scoring.totalScore < Number(trendRules.minimumTrendScore || 0.56)
        || !shouldKeepTrendArticle(article, scoring)
      ) {
        return null;
      }

      const productKey = mapTrendProduct(article, trendRules, queryRules);
      const seedTopic = buildTrendSeedTopic(article, bucket, productKey);
      const lifecycleStage = bucket?.cluster === "platform-policy-and-disclosure" ? "evaluation" : "discovery";

      return {
        id: `trend-${article.provider}-${slugify(article.title)}`,
        topicKey: `trend:${article.provider}:${slugify(article.title)}`,
        layer: "trend_linked",
        lifecycleStage,
        cluster: bucket?.cluster || "trend-linked",
        primaryProduct: productKey,
        intentType: bucket?.intentType || "trend",
        priority: clamp(0.62 + scoring.totalScore * 0.28),
        seedTopic,
        audience: "creators and creator-side operators reacting to platform or brand-partnership changes",
        angle: buildTrendAngle(article, bucket, productKey),
        tags: sanitizeTags([
          ...(bucket?.tags || []),
          article.sourceName.toLowerCase(),
          productKey.replace(/_/g, " "),
        ]),
        sourceType: "trend_signal",
        templateType: "trend_signal",
        keywordGroup: `trend:${bucket?.id || "general"}:${slugify(article.title).split("-").slice(0, 8).join("-")}`,
        trendSignal: {
          ...article,
          totalScore: scoring.totalScore,
          relevanceScore: scoring.relevanceScore,
          freshnessScore: scoring.freshnessScore,
        },
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right.trendSignal?.totalScore || 0) - (left.trendSignal?.totalScore || 0))
    .slice(0, Number(trendRules.maxCandidates || 12));
}

async function getTrendContext(configBundle) {
  const trendRules = configBundle.trendRules || {};
  const currentsApiKey = getEnv("BLOG_CURRENTS_API_KEY");
  const gnewsApiKey = getEnv("BLOG_GNEWS_API_KEY");

  if (!currentsApiKey && !gnewsApiKey) {
    return {
      ok: false,
      reason: "missing_keys",
      message: "No trend source API keys were provided. V3 will continue without external trend signals.",
      articles: [],
      candidates: [],
    };
  }

  const articleResults = await Promise.all(
    [
      fetchCurrentsArticles({ apiKey: currentsApiKey, trendRules }).catch((error) => {
        logError("TREND", error, {
          provider: "currents",
        });
        return [];
      }),
      fetchGNewsArticles({ apiKey: gnewsApiKey, trendRules }).catch((error) => {
        logError("TREND", error, {
          provider: "gnews",
        });
        return [];
      }),
    ],
  );

  const articles = dedupeTrendArticles(articleResults.flat()).filter((article) => {
    const ageHours = getTrendAgeHours(article.publishedAt);
    return ageHours <= Number(getEnv("BLOG_TREND_LOOKBACK_HOURS", String(DEFAULT_TREND_LOOKBACK_HOURS)));
  });

  return {
    ok: true,
    reason: "",
    message: "",
    articles,
    candidates: buildTrendCandidates(articles, trendRules, configBundle.queryRules),
  };
}

function getDealBoardBaseApi(dealBoardRules) {
  return normalizeBaseUrl(
    getEnv("BLOG_DEAL_SOURCE_BASE_API", dealBoardRules?.source?.baseApi || DEFAULT_DEAL_BOARD_BASE_API),
  );
}

function buildDealBoardUrl(dealBoardRules, endpoint) {
  const baseApi = getDealBoardBaseApi(dealBoardRules);
  const targetEndpoint = endpoint || dealBoardRules?.source?.boardEndpoint || DEFAULT_DEAL_BOARD_ENDPOINT;
  return `${baseApi}${targetEndpoint}`;
}

function getTopLevelCategoryCodes(codes, categoryLookup) {
  const result = new Set();
  for (const rawCode of codes || []) {
    const code = String(rawCode || "").trim();
    if (!code) continue;
    if (categoryLookup.has(code)) {
      result.add(code);
      continue;
    }
    const prefix = code.slice(0, 2);
    if (categoryLookup.has(prefix)) {
      result.add(prefix);
    }
  }
  return [...result];
}

function getTopLevelCategoryNames(codes, categoryLookup) {
  return getTopLevelCategoryCodes(codes, categoryLookup)
    .map((code) => categoryLookup.get(code))
    .filter(Boolean);
}

function normalizeUsdAmount(amount, currency, dealBoardRules) {
  const numericAmount = Number(amount || 0);
  if (!numericAmount) return 0;
  const normalizedCurrency = String(currency || "USD").trim().toUpperCase();
  const rates = dealBoardRules?.currencyUsdApprox || {};
  const multiplier = Number(rates[normalizedCurrency] || 1);
  return numericAmount * multiplier;
}

function getDeadlineUrgencyScore(endDate, isLongtime) {
  if (Number(isLongtime) === 1) return 0.85;
  if (!endDate) return 0.4;
  const timestamp = new Date(endDate).getTime();
  if (!timestamp) return 0.4;
  const diffDays = Math.max(0, (timestamp - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return 1;
  if (diffDays <= 14) return 0.86;
  if (diffDays <= 30) return 0.66;
  return 0.42;
}

function getFollowerBarrierScore(minFollowers) {
  const value = Number(minFollowers || 0);
  if (!value) return 1;
  if (value <= 3000) return 0.96;
  if (value <= 5000) return 0.88;
  if (value <= 10000) return 0.76;
  if (value <= 50000) return 0.5;
  return 0.22;
}

function getPlatformCoverageScore(platforms, dealBoardRules) {
  const configured = new Set((dealBoardRules?.platformPriority || []).map((item) => String(item || "").toLowerCase()));
  const normalized = uniqueStrings(platforms).map((item) => String(item || "").toLowerCase());
  if (!normalized.length) return 0.25;
  const matching = normalized.filter((item) => configured.has(item)).length;
  return clamp(matching / Math.max(configured.size || 1, 5) * 2.4, 0, 1);
}

function formatCompensationSnippet(deal) {
  const bits = [];
  const currency = String(deal.fixedCompensationCurrency || deal.productMarketPriceCurrency || "USD").toUpperCase();
  const fixedMin = Number(deal.fixedCompensationMin || 0);
  const fixedMax = Number(deal.fixedCompensationMax || 0);
  const commMin = Number(deal.commissionRateMin || 0);
  const commMax = Number(deal.commissionRateMax || 0);

  if (fixedMin || fixedMax) {
    if (fixedMin && fixedMax && fixedMin !== fixedMax) {
      bits.push(`${currency} ${fixedMin}-${fixedMax} fixed`);
    } else {
      bits.push(`${currency} ${fixedMax || fixedMin} fixed`);
    }
  }

  if (commMin || commMax) {
    if (commMin && commMax && commMin !== commMax) {
      bits.push(`${commMin}-${commMax}% commission`);
    } else {
      bits.push(`${commMax || commMin}% commission`);
    }
  }

  if (Number(deal.isFreeSample) === 1) {
    bits.push("free sample");
  }

  return bits.join(" + ");
}

function summarizeDealSignal(deal, siteBaseUrl) {
  const categoryLabel = Array.isArray(deal.categoryNames) && deal.categoryNames.length
    ? deal.categoryNames[0]
    : "";
  return {
    campaignId: deal.campaignId,
    brandName: deal.brandName || "",
    title: deal.campaignTitle,
    categoryLabel,
    categoryUrl: categoryLabel ? createDealCategoryUrl(siteBaseUrl, categoryLabel) : "",
    pageUrl: createDealPageUrl(siteBaseUrl, deal.campaignId, deal.campaignTitle),
    platforms: uniqueStrings(deal.platforms || []),
    compensationSummary: formatCompensationSnippet(deal),
    followerMin: Number(deal.fansNumMin || 0),
    endDate: deal.campaignEndDate || "",
    longterm: Number(deal.isLongtime || 0) === 1,
    spotlightScore: Number(deal.spotlightScore || 0),
  };
}

function scoreDealBoardRow(row, dealBoardRules) {
  const fixedUsd = Math.max(
    normalizeUsdAmount(row.fixedCompensationMin, row.fixedCompensationCurrency, dealBoardRules),
    normalizeUsdAmount(row.fixedCompensationMax, row.fixedCompensationCurrency, dealBoardRules),
  );
  const marketUsd = normalizeUsdAmount(
    row.productMarketPrice,
    row.productMarketPriceCurrency,
    dealBoardRules,
  );
  const commission = Math.max(Number(row.commissionRateMin || 0), Number(row.commissionRateMax || 0));
  const platformCoverage = getPlatformCoverageScore(row.platforms, dealBoardRules);
  const barrierScore = getFollowerBarrierScore(row.fansNumMin);
  const urgencyScore = getDeadlineUrgencyScore(row.campaignEndDate, row.isLongtime);
  const sampleScore = Number(row.isFreeSample) === 1 ? 0.82 : 0.24;
  const longtermScore = Number(row.isLongtime) === 1 ? 0.88 : 0.4;
  const tagHits = countMatchingTerms((row.systemTag || []).join(" "), dealBoardRules.highlightTags || []);
  const fixedPayScore = clamp(Math.log10(fixedUsd + 1) / 3);
  const marketValueScore = clamp(Math.log10(marketUsd + 1) / 3.1);
  const commissionScore = clamp(commission / 25);

  return clamp(
    fixedPayScore * 0.22
      + marketValueScore * 0.1
      + commissionScore * 0.2
      + barrierScore * 0.12
      + platformCoverage * 0.12
      + urgencyScore * 0.09
      + sampleScore * 0.07
      + longtermScore * 0.05
      + clamp(tagHits * 0.1) * 0.03,
  );
}

async function fetchDealBoardRows({ dealBoardRules, categoryLookup }) {
  const payload = await postJson(
    buildDealBoardUrl(dealBoardRules, dealBoardRules?.source?.boardEndpoint || DEFAULT_DEAL_BOARD_ENDPOINT),
    {
      currentPage: 1,
      pageSize: Number(dealBoardRules?.source?.pageSize || 9999),
      status: Number(dealBoardRules?.source?.status || 0),
      keyword: "",
      blogCateIds: [],
    },
  );

  const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : [];

  return rows.map((row) => {
    const categoryCodes = getTopLevelCategoryCodes(row.bloggerCateList || [], categoryLookup);
    const categoryNames = categoryCodes.map((code) => categoryLookup.get(code)).filter(Boolean);
    const spotlightScore = scoreDealBoardRow(row, dealBoardRules);

    return {
      ...row,
      categoryCodes,
      categoryNames,
      spotlightScore,
    };
  });
}

async function fetchDealDetailRecord({ campaignId, dealBoardRules }) {
  if (!campaignId) return null;
  const payload = await postJson(
    buildDealBoardUrl(dealBoardRules, dealBoardRules?.source?.detailEndpoint || DEFAULT_DEAL_DETAIL_ENDPOINT),
    { campaignId },
  );
  return payload?.data || null;
}

function getCategoryPriorityIndex(categoryCode, dealBoardRules) {
  const list = dealBoardRules?.categoryPriority || [];
  const index = list.indexOf(categoryCode);
  return index >= 0 ? index : list.length + 5;
}

function buildCategoryRoundupCandidates({
  rows,
  dealBoardRules,
  dateString,
  timeZone,
  siteBaseUrl,
}) {
  const groups = new Map();
  for (const row of rows) {
    for (const categoryCode of row.categoryCodes || []) {
      if (!groups.has(categoryCode)) {
        groups.set(categoryCode, []);
      }
      groups.get(categoryCode).push(row);
    }
  }

  const monthLabel = getMonthYearLabel(dateString, timeZone);
  const minimumCategoryDeals = Number(dealBoardRules?.ranking?.minimumCategoryDeals || 4);

  return [...groups.entries()]
    .map(([categoryCode, deals]) => {
      const categoryLabel = deals[0]?.categoryNames?.find(Boolean) || "Creator Deals";
      const highlightedDeals = [...deals]
        .sort((left, right) => Number(right.spotlightScore || 0) - Number(left.spotlightScore || 0))
        .slice(0, Number(dealBoardRules?.ranking?.maxHighlightedDealsPerCategory || 4))
        .map((deal) => summarizeDealSignal(deal, siteBaseUrl));
      const lowBarrierCount = deals.filter((deal) => Number(deal.fansNumMin || 0) <= 5000 || !deal.fansNumMin).length;
      const multiPlatformCount = deals.filter((deal) => (deal.platforms || []).length >= 3).length;
      const averageScore =
        deals.reduce((sum, deal) => sum + Number(deal.spotlightScore || 0), 0) / Math.max(deals.length, 1);
      return {
        id: `deal-category-${categoryCode}-${dateString.slice(0, 7)}`,
        topicKey: `deal-category:${categoryCode}:${dateString.slice(0, 7)}`,
        layer: "core_editorial",
        cluster: "deal-discovery",
        lifecycleStage: "discovery",
        primaryProduct: "deal_hunter",
        supportedProducts: ["deal_hunter", "brand_analyze"],
        intentType: "workflow",
        priority: clamp(0.72 + deals.length * 0.012 + averageScore * 0.12),
        seedTopic: `Best ${categoryLabel} brand deals for UGC creators in ${monthLabel}`,
        audience: `${categoryLabel} creators looking for live brand opportunities that fit their niche and workload`,
        angle: `Use active deal-board supply to shortlist the ${categoryLabel} campaigns that look most worth reviewing right now, then explain who each one suits and what to check before applying.`,
        tags: sanitizeTags([
          categoryLabel.toLowerCase(),
          "ugc creator",
          "brand deals",
          "deal hunter",
          "creator opportunities",
        ]),
        sourceType: "deal_board_category",
        templateType: "category_roundup",
        keywordGroup: `deal-category:${categoryCode}:${dateString.slice(0, 7)}`,
        stateTransitionValue: clamp(0.88 + lowBarrierCount * 0.01),
        dealSupplyFit: clamp(0.6 + deals.length * 0.015),
        dealBoardSignal: {
          type: "category_roundup",
          categoryCode,
          categoryLabel,
          categoryUrl: createDealCategoryUrl(siteBaseUrl, categoryLabel),
          categoryCount: deals.length,
          lowBarrierCount,
          multiPlatformCount,
          highlightedDeals,
          averageScore,
          monthLabel,
        },
      };
    })
    .filter((candidate) => Number(candidate.dealBoardSignal?.categoryCount || 0) >= minimumCategoryDeals)
    .sort((left, right) => {
      const countDiff = Number(right.dealBoardSignal.categoryCount || 0) - Number(left.dealBoardSignal.categoryCount || 0);
      if (countDiff !== 0) return countDiff;
      const priorityDiff = getCategoryPriorityIndex(left.dealBoardSignal.categoryCode, dealBoardRules)
        - getCategoryPriorityIndex(right.dealBoardSignal.categoryCode, dealBoardRules);
      if (priorityDiff !== 0) return priorityDiff;
      return Number(right.priority || 0) - Number(left.priority || 0);
    })
    .slice(0, Number(dealBoardRules?.ranking?.maxCategoryCandidates || 10));
}

function buildDealSpotlightCandidates({
  rows,
  dealBoardRules,
  siteBaseUrl,
}) {
  const threshold = Number(dealBoardRules?.ranking?.minimumSpotlightScore || 0.58);
  return [...rows]
    .filter((row) => {
      const text = normalizeTrendText(`${row.campaignTitle} ${row.campaignDescription} ${(row.systemTag || []).join(" ")}`);
      return !containsAnyTerm(text, dealBoardRules?.blockedTerms || []);
    })
    .sort((left, right) => Number(right.spotlightScore || 0) - Number(left.spotlightScore || 0))
    .filter((row) => Number(row.spotlightScore || 0) >= threshold)
    .slice(0, Number(dealBoardRules?.ranking?.maxSpotlightCandidates || 12))
    .map((row) => {
      const categoryLabel = row.categoryNames?.[0] || "creator";
      const dealLabel = row.brandName
        ? `${row.brandName} ${categoryLabel} deal`
        : `${categoryLabel} creator deal`;
      return {
        id: `deal-spotlight-${row.campaignId}`,
        topicKey: `deal-spotlight:${row.campaignId}`,
        layer: "controlled_programmatic",
        cluster: "deal-spotlight",
        lifecycleStage: "evaluation",
        primaryProduct: "deal_hunter",
        supportedProducts: ["deal_hunter", "brand_analyze"],
        intentType: "review",
        priority: clamp(0.76 + Number(row.spotlightScore || 0) * 0.18),
        seedTopic: `Is the ${dealLabel} worth applying to right now? A creator breakdown`,
        audience: "creators deciding whether one active campaign deserves real attention",
        angle: `Break down the actual upside, friction, payout structure, platform fit, and timing behind this live campaign so creators can decide whether to apply, save it, or skip it.`,
        tags: sanitizeTags([
          row.brandName?.toLowerCase() || "creator deal",
          categoryLabel.toLowerCase(),
          "deal spotlight",
          "deal hunter",
          "creator breakdown",
        ]),
        sourceType: "deal_board_spotlight",
        templateType: "deal_spotlight",
        keywordGroup: `deal-spotlight:${row.campaignId}`,
        stateTransitionValue: 0.94,
        dealSupplyFit: clamp(0.7 + Number(row.spotlightScore || 0) * 0.2),
        dealBoardSignal: {
          type: "deal_spotlight",
          campaignId: row.campaignId,
          categoryCode: row.categoryCodes?.[0] || "",
          categoryLabel,
          categoryUrl: categoryLabel ? createDealCategoryUrl(siteBaseUrl, categoryLabel) : "",
          detailPageUrl: createDealPageUrl(siteBaseUrl, row.campaignId, row.campaignTitle),
          highlightedDeals: [summarizeDealSignal(row, siteBaseUrl)],
          spotlightScore: Number(row.spotlightScore || 0),
          compensationSummary: formatCompensationSnippet(row),
          platforms: uniqueStrings(row.platforms || []),
          longterm: Number(row.isLongtime || 0) === 1,
          followersMin: Number(row.fansNumMin || 0),
        },
      };
    });
}

async function getDealBoardContext({ configBundle, siteBaseUrl, dateString, timeZone }) {
  const categoryLookup = buildCategoryLookup(configBundle.dealCategoryMap);
  try {
    const rows = await fetchDealBoardRows({
      dealBoardRules: configBundle.dealBoardRules,
      categoryLookup,
    });
    const categoryCandidates = buildCategoryRoundupCandidates({
      rows,
      dealBoardRules: configBundle.dealBoardRules,
      dateString,
      timeZone,
      siteBaseUrl,
    });
    const spotlightCandidates = buildDealSpotlightCandidates({
      rows,
      dealBoardRules: configBundle.dealBoardRules,
      siteBaseUrl,
    });
    return {
      ok: true,
      rows,
      categoryCandidates,
      spotlightCandidates,
      candidates: [...categoryCandidates, ...spotlightCandidates],
    };
  } catch (error) {
    return {
      ok: false,
      reason: "deal_board_failed",
      message: error instanceof Error ? error.message : String(error),
      rows: [],
      categoryCandidates: [],
      spotlightCandidates: [],
      candidates: [],
    };
  }
}

async function hydrateDealBoardCandidate(candidate, dealBoardRules, siteBaseUrl) {
  if (!candidate?.dealBoardSignal) return candidate;

  const nextCandidate = {
    ...candidate,
    dealBoardSignal: {
      ...candidate.dealBoardSignal,
    },
  };

  if (candidate.dealBoardSignal.type === "deal_spotlight" && candidate.dealBoardSignal.campaignId) {
    const detail = await fetchDealDetailRecord({
      campaignId: candidate.dealBoardSignal.campaignId,
      dealBoardRules,
    }).catch(() => null);
    if (detail) {
      nextCandidate.dealBoardSignal.detail = {
        ...detail,
        detailPageUrl: createDealPageUrl(siteBaseUrl, detail.campaignId, detail.campaignTitle),
        categoryUrl: candidate.dealBoardSignal.categoryUrl || "",
        compensationSummary: formatCompensationSnippet(detail),
      };
    }
  }

  if (candidate.dealBoardSignal.type === "category_roundup") {
    const highlightedIds = (candidate.dealBoardSignal.highlightedDeals || [])
      .map((deal) => deal.campaignId)
      .filter(Boolean)
      .slice(0, 3);
    if (highlightedIds.length) {
      const detailRows = await Promise.all(
        highlightedIds.map((campaignId) =>
          fetchDealDetailRecord({ campaignId, dealBoardRules }).catch(() => null),
        ),
      );
      nextCandidate.dealBoardSignal.highlightedDealDetails = detailRows
        .filter(Boolean)
        .map((detail) => ({
          ...detail,
          detailPageUrl: createDealPageUrl(siteBaseUrl, detail.campaignId, detail.campaignTitle),
          compensationSummary: formatCompensationSnippet(detail),
        }));
    }
  }

  return nextCandidate;
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
    lifecycleStage: record.lifecycleStage || inferLifecycleStage(record),
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
        lifecycleStage: "evaluation",
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
        lifecycleStage: "evaluation",
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
    lifecycleStage: scenario.lifecycleStage || "evaluation",
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
    lifecycleStage: scenario.lifecycleStage || "discovery",
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

function buildLandingPageSupportCandidates(landingPageSupportLibrary) {
  return (landingPageSupportLibrary.articles || []).map((record) => ({
    ...record,
    layer: "core_editorial",
    cluster: record.cluster || "landing-support",
    lifecycleStage: record.lifecycleStage || "discovery",
    primaryProduct: record.primaryProduct || "deal_hunter",
    intentType: record.intentType || "workflow",
    priority: Number(record.priority || 0.88),
    sourceType: "landing_page_support",
    templateType: "landing_page_support",
    keywordGroup: record.keywordGroup || `landing-support:${record.id}`,
    topicKey: `landing_page_support:${record.id}`,
    tags: sanitizeTags(record.tags || []),
    targetLandingPages: uniqueStrings(record.targetLandingPages || []),
  }));
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
  const landingSupport = buildLandingPageSupportCandidates(configBundle.landingPageSupportLibrary);

  const combined = [
    ...coreEditorial,
    ...toolProblem,
    ...programmatic,
    ...trendLinked,
    ...landingSupport,
    ...externalCandidates,
  ];

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

function inferLifecycleStage(candidate) {
  if (candidate.lifecycleStage) return candidate.lifecycleStage;

  if (
    candidate.cluster === "creator-readiness"
    || candidate.seedTopic?.toLowerCase().includes("profile")
    || candidate.seedTopic?.toLowerCase().includes("rate baseline")
  ) {
    return "readiness";
  }

  if (
    candidate.cluster === "deal-discovery"
    || candidate.templateType === "category_roundup"
    || candidate.seedTopic?.toLowerCase().includes("shortlist")
    || candidate.seedTopic?.toLowerCase().includes("prioritize")
    || candidate.seedTopic?.toLowerCase().includes("worth applying")
  ) {
    return "discovery";
  }

  if (
    candidate.cluster === "deal-execution"
    || candidate.seedTopic?.toLowerCase().includes("reviewing")
    || candidate.seedTopic?.toLowerCase().includes("negotiat")
    || candidate.seedTopic?.toLowerCase().includes("reply")
    || candidate.seedTopic?.toLowerCase().includes("imported sponsorship email")
  ) {
    return "execution";
  }

  if (
    candidate.cluster === "creator-optimization"
    || candidate.seedTopic?.toLowerCase().includes("ignored")
    || candidate.seedTopic?.toLowerCase().includes("fix the pattern")
  ) {
    return "optimization";
  }

  return "evaluation";
}

function inferSupportedProducts(candidate) {
  const seed = new Set([candidate.primaryProduct || "deal_hunter"]);
  const secondaryProducts = selectSecondaryProducts(candidate.primaryProduct, candidate);
  for (const productKey of secondaryProducts || []) {
    seed.add(productKey);
  }
  return [...seed];
}

function computeLifecycleStats(recentEntries, scoringRules) {
  const targets = scoringRules.lifecycleTargets || {};
  const counts = Object.fromEntries(Object.keys(targets).map((key) => [key, 0]));
  for (const entry of recentEntries) {
    const lifecycleStage = entry.lifecycleStage || inferLifecycleStage(entry);
    if (counts[lifecycleStage] !== undefined) counts[lifecycleStage] += 1;
  }
  return counts;
}

function computeLifecycleGap(candidate, recentEntries, scoringRules) {
  const stage = inferLifecycleStage(candidate);
  const targets = scoringRules.lifecycleTargets || {};
  const target = Number(targets[stage] || 0.18);
  const counts = computeLifecycleStats(recentEntries, scoringRules);
  const total = recentEntries.length || 0;
  const actual = total ? Number(counts[stage] || 0) / total : 0;
  return clamp(0.5 + Math.max(0, target - actual));
}

function computeSourceTypeGap(candidate, recentEntries, scoringRules) {
  const targets = scoringRules.sourceTypeTargets || {};
  const target = Number(targets[candidate.sourceType] || 0);
  if (!target) return 0.55;

  const total = recentEntries.length || 0;
  const sameSourceCount = recentEntries.filter(
    (entry) => entry.topicSource === candidate.sourceType,
  ).length;
  const actual = total ? sameSourceCount / total : 0;
  return clamp(0.5 + Math.max(0, target - actual));
}

function computeProductSurfaceDepth(candidate) {
  const supportedProducts = candidate.supportedProducts?.length
    ? candidate.supportedProducts
    : inferSupportedProducts(candidate);
  return clamp(0.45 + supportedProducts.length * 0.18);
}

function computeStateTransitionValue(candidate) {
  if (typeof candidate.stateTransitionValue === "number") {
    return clamp(candidate.stateTransitionValue);
  }

  const lifecycleStage = inferLifecycleStage(candidate);
  const intentType = String(candidate.intentType || "");

  if (lifecycleStage === "discovery") {
    return clamp(intentType === "workflow" ? 0.92 : 0.86);
  }
  if (lifecycleStage === "evaluation") {
    return clamp(["framework", "checklist", "review", "red-flags"].includes(intentType) ? 0.94 : 0.88);
  }
  if (lifecycleStage === "execution") {
    return clamp(intentType === "workflow" ? 0.9 : 0.82);
  }
  if (lifecycleStage === "optimization") {
    return 0.84;
  }
  return 0.78;
}

function computeDealSupplyFit(candidate) {
  if (typeof candidate.dealSupplyFit === "number") {
    return clamp(candidate.dealSupplyFit);
  }
  if (candidate.sourceType === "deal_board_category") {
    return 0.88;
  }
  if (candidate.sourceType === "deal_board_spotlight") {
    return 0.92;
  }
  return 0.38;
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
    lifecycleStage: inferLifecycleStage(candidate),
    supportedProducts: candidate.supportedProducts?.length
      ? candidate.supportedProducts
      : inferSupportedProducts(candidate),
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
  const workflowCoverage = computeLifecycleGap(candidate, recentEntries, scoringRules);
  const sourceStrategyFit = computeSourceTypeGap(candidate, recentEntries, scoringRules);
  const productSurfaceDepth = computeProductSurfaceDepth(candidate);
  const stateTransitionValue = computeStateTransitionValue(candidate);
  const dealSupplyFit = computeDealSupplyFit(candidate);
  const cannibalizationRisk = computeCannibalizationRisk(candidate, existingPosts, publishLog);
  const total =
    businessFit * Number(weights.businessFit || 0)
    + intentScore * Number(weights.searchIntent || 0)
    + conversionFit * Number(weights.conversionFit || 0)
    + topicalGap * Number(weights.topicalGap || 0)
    + freshness * Number(weights.freshness || 0)
    + priorityScore * Number(weights.priority || 0)
    + workflowCoverage * Number(weights.workflowCoverage || 0)
    + sourceStrategyFit * Number(weights.sourceStrategyFit || 0)
    + productSurfaceDepth * Number(weights.productSurfaceDepth || 0)
    + stateTransitionValue * Number(weights.stateTransitionValue || 0)
    + dealSupplyFit * Number(weights.dealSupplyFit || 0)
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
      workflowCoverage,
      sourceStrategyFit,
      productSurfaceDepth,
      stateTransitionValue,
      dealSupplyFit,
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
  let scopedCandidates = candidates.filter((candidate) => candidate.layer === selectedLayer);
  if (
    selectedLayer === "trend_linked"
    && scopedCandidates.some((candidate) => candidate.sourceType === "trend_signal")
  ) {
    scopedCandidates = scopedCandidates.filter((candidate) => candidate.sourceType === "trend_signal");
  }

  const ranked = scopedCandidates
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
    lifecycleStage: "evaluation",
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
  trendCandidates = [],
  dealBoardCandidates = [],
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

  if (args.candidateId) {
    const candidatePool = buildCandidatePool(configBundle, args, [
      ...searchConsoleCandidates,
      ...trendCandidates,
      ...dealBoardCandidates,
    ]);
    const matchedCandidate = candidatePool.find((candidate) => candidate.id === args.candidateId);
    if (!matchedCandidate) {
      throw new Error(`Candidate not found for --candidate-id=${args.candidateId}`);
    }

    logStep("TOPIC", "Using manual candidate override", {
      candidateId: args.candidateId,
      product: matchedCandidate.primaryProduct,
      layer: matchedCandidate.layer,
      sourceType: matchedCandidate.sourceType || "library",
    });

    return {
      candidate: matchedCandidate,
      selectedLayer: matchedCandidate.layer,
      rankedPreview: [
        {
          id: matchedCandidate.id,
          score: 1,
          layer: matchedCandidate.layer,
          seedTopic: matchedCandidate.seedTopic,
          primaryProduct: matchedCandidate.primaryProduct,
        },
      ],
    };
  }

  const candidatePool = dedupeCandidates(
    buildCandidatePool(configBundle, args, [
      ...searchConsoleCandidates,
      ...trendCandidates,
      ...dealBoardCandidates,
    ]),
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
    lifecycleStage: candidate.lifecycleStage || inferLifecycleStage(candidate),
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
      lifecycleStage: item.lifecycleStage || inferLifecycleStage(item),
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

function buildLiveOpportunitiesMarkdown(candidate) {
  const signal = candidate.dealBoardSignal;
  if (!signal) return "";

  const lines = ["## Live Opportunities Mentioned", ""];

  if (signal.type === "category_roundup") {
    if (signal.categoryUrl && signal.categoryLabel) {
      lines.push(`- [Browse all ${signal.categoryLabel} deals](${signal.categoryUrl})`);
    }
    for (const deal of signal.highlightedDeals || []) {
      if (!deal.pageUrl) continue;
      const snippet = [deal.compensationSummary, deal.platforms?.join("/"), deal.followerMin ? `${deal.followerMin}+ followers` : "open follower range"]
        .filter(Boolean)
        .join(" · ");
      lines.push(`- [${deal.title}](${deal.pageUrl})${snippet ? ` — ${snippet}` : ""}`);
    }
  }

  if (signal.type === "deal_spotlight") {
    if (signal.detailPageUrl) {
      lines.push(`- [Open the featured deal](${signal.detailPageUrl})`);
    }
    if (signal.categoryUrl && signal.categoryLabel) {
      lines.push(`- [Browse more ${signal.categoryLabel} deals](${signal.categoryUrl})`);
    }
  }

  return lines.length > 2 ? lines.join("\n") : "";
}

function buildLandingPageSupportMarkdown(candidate, internalLinkingRules) {
  const landingPages = internalLinkingRules.landingPages || {};
  const targetLandingPages = uniqueStrings(candidate.targetLandingPages || [])
    .map((slug) => ({
      slug,
      ...(landingPages[slug] || {}),
    }))
    .filter((item) => item.label && item.url);

  if (!targetLandingPages.length) return "";

  const lines = [
    `## ${internalLinkingRules.landingPageSectionTitle || "Related Deal Pages"}`,
    "",
    internalLinkingRules.landingPageSectionIntro
      || "If you want to move from general advice to live opportunities, these focused deal pages are the next step:",
    "",
  ];

  for (const page of targetLandingPages) {
    const suffix = page.description ? `: ${page.description}` : "";
    lines.push(`- [${page.label}](${page.url})${suffix}`);
  }

  return lines.join("\n");
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

function getControlledProgrammaticStyleKey(candidate) {
  const templateType = String(candidate.templateType || "").trim();
  if (templateType === "brand_fit") return "brand_review";
  if (CONTROLLED_PROGRAMMATIC_COVER_STYLES[templateType]) return templateType;
  return "creator_scenario";
}

function getCoverStyleProfile(candidate) {
  const layerKey = String(candidate.layer || "").trim();
  if (layerKey === "controlled_programmatic") {
    const styleKey = getControlledProgrammaticStyleKey(candidate);
    return {
      ...COVER_STYLE_PROFILES.controlled_programmatic,
      ...CONTROLLED_PROGRAMMATIC_COVER_STYLES[styleKey],
    };
  }

  return COVER_STYLE_PROFILES[layerKey] || COVER_STYLE_PROFILES.core_editorial;
}

function buildCoverStyleGuidance(candidate, styleProfile) {
  const extraMotifs = [];

  if (candidate.brandName) extraMotifs.push(`${candidate.brandName} brand context without showing logos`);
  if (candidate.categoryLabel) extraMotifs.push(`${candidate.categoryLabel} category cues`);
  if (candidate.niche) extraMotifs.push(`${candidate.niche} creator environment`);
  if (candidate.platform) extraMotifs.push(`${candidate.platform}-native production mood`);
  if (candidate.dealBoardSignal?.type === "category_roundup" && candidate.dealBoardSignal?.categoryLabel) {
    extraMotifs.push(`${candidate.dealBoardSignal.categoryLabel} opportunity roundup context`);
  }
  if (candidate.dealBoardSignal?.type === "deal_spotlight") {
    extraMotifs.push("single featured campaign decision energy");
  }

  const motifs = uniqueStrings([...(styleProfile.motifs || []), ...extraMotifs]);

  return [
    `Cover style label: ${styleProfile.label}.`,
    `Cover art direction: ${styleProfile.direction}`,
    `Composition guidance: ${styleProfile.composition}`,
    `Palette guidance: ${styleProfile.palette}`,
    motifs.length ? `Motifs to include naturally: ${motifs.join(", ")}.` : "",
    styleProfile.avoid?.length ? `Avoid these visual patterns: ${styleProfile.avoid.join("; ")}.` : "",
  ].filter(Boolean).join("\n");
}

function composeCoverImagePrompt({ candidate, promptContext, styleProfile, modelPrompt }) {
  const topicLine = candidate.seedTopic
    ? `Article topic: ${candidate.seedTopic}.`
    : "";
  const lifecycleLine = promptContext?.lifecycleStage
    ? `Creator workflow stage: ${promptContext.lifecycleStage}.`
    : "";
  const audienceLine = candidate.audience
    ? `Audience context: ${candidate.audience}.`
    : "";

  return [
    `Visual system style: ${styleProfile.label}.`,
    `Use this direction: ${styleProfile.direction}`,
    `Composition: ${styleProfile.composition}`,
    `Palette: ${styleProfile.palette}`,
    styleProfile.avoid?.length ? `Do not include: ${styleProfile.avoid.join(", ")}.` : "",
    topicLine,
    lifecycleLine,
    audienceLine,
    "Keep the image realistic or editorially stylized, not illustrative UI art.",
    "Do not render any visible text, typography, logos, watermarks, app chrome, or dashboard interfaces.",
    String(modelPrompt || "").trim(),
  ].filter(Boolean).join("\n");
}

function buildPromptContext(candidate, internalLinkingRules, queryRules) {
  const product = PRODUCT_CONTEXT[candidate.primaryProduct] || PRODUCT_CONTEXT.deal_hunter;
  const productLinks = internalLinkingRules.products || {};
  const primaryProductLink = productLinks[candidate.primaryProduct];
  const coverStyleProfile = getCoverStyleProfile(candidate);

  return {
    layer: candidate.layer,
    layerLabel: LAYER_DEFINITIONS[candidate.layer]?.label || candidate.layer,
    lifecycleStage: candidate.lifecycleStage || inferLifecycleStage(candidate),
    audience: candidate.audience,
    angle: candidate.angle,
    cluster: candidate.cluster,
    primaryProduct: candidate.primaryProduct,
    supportedProducts: candidate.supportedProducts?.length
      ? candidate.supportedProducts
      : inferSupportedProducts(candidate),
    primaryProductName: product.name,
    primaryProductUrl: primaryProductLink?.url || "",
    productSummary: product.summary,
    productDifferentiators: product.differentiators,
    reportStructure: product.reportStructure || [],
    brandBlacklist: queryRules.brandTerms || [],
    legacyBlacklist: queryRules.legacyTerms || [],
    templateType: candidate.templateType || candidate.sourceType || candidate.layer,
    trendSignal: candidate.trendSignal || null,
    dealBoardSignal: candidate.dealBoardSignal || null,
    targetLandingPages: uniqueStrings(candidate.targetLandingPages || []),
    coverStyleProfile,
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
  const dealBoardContext = promptContext.dealBoardSignal
    ? (() => {
        const signal = promptContext.dealBoardSignal;
        if (signal.type === "category_roundup") {
          const dealLines = (signal.highlightedDealDetails || signal.highlightedDeals || [])
            .slice(0, 4)
            .map((deal) => {
              const title = deal.campaignTitle || deal.title;
              const comp = deal.compensationSummary || formatCompensationSnippet(deal);
              const platforms = uniqueStrings(deal.platforms || []).join(", ");
              return `- ${title}${comp ? ` | ${comp}` : ""}${platforms ? ` | ${platforms}` : ""}`;
            });
          return [
            `Live deal-board category: ${signal.categoryLabel}`,
            `Current category count: ${signal.categoryCount}`,
            signal.lowBarrierCount ? `Low-barrier deals in this category: ${signal.lowBarrierCount}` : "",
            dealLines.length ? `Highlighted live deals:\n${dealLines.join("\n")}` : "",
            "Treat the article as a curated shortlist plus decision framework, not a generic market overview.",
          ].filter(Boolean).join("\n");
        }

        const detail = signal.detail || null;
        const highlighted = signal.highlightedDeals?.[0] || {};
        return [
          `Featured live campaign: ${detail?.campaignTitle || highlighted.title || ""}`,
          `Brand: ${detail?.brandName || highlighted.brandName || "Unknown"}`,
          `Compensation: ${detail?.compensationSummary || signal.compensationSummary || highlighted.compensationSummary || ""}`,
          `Platforms: ${uniqueStrings(detail?.platforms || signal.platforms || highlighted.platforms || []).join(", ")}`,
          detail?.fansNumMin || signal.followersMin ? `Follower threshold: ${detail?.fansNumMin || signal.followersMin}+` : "",
          detail?.campaignEndDate || signal.endDate ? `Deadline: ${detail?.campaignEndDate || signal.endDate}` : "",
          detail?.requirements?.length ? `Requirements summary:\n${detail.requirements.map((item) => `- ${item.title}: ${item.description}`).join("\n")}` : "",
          "Treat the article as a creator-side evaluation breakdown. Explain fit, upside, hidden friction, and who should pass.",
        ].filter(Boolean).join("\n");
      })()
    : "";
  const landingPageContext = promptContext.targetLandingPages?.length
    ? `Primary deal pages this article should support naturally: ${promptContext.targetLandingPages.join(", ")}. Treat them as the most relevant next-step pages for readers who want live opportunities after reading.`
    : "";
  const trendContext = promptContext.trendSignal
    ? [
        `Recent signal title: ${promptContext.trendSignal.title}`,
        promptContext.trendSignal.description
          ? `Recent signal summary: ${promptContext.trendSignal.description}`
          : "",
        `Recent signal source: ${promptContext.trendSignal.sourceName}`,
        `Recent signal published at: ${promptContext.trendSignal.publishedAt}`,
        "Use this only as timely context. Do not rewrite it like a news recap and do not invent unsupported facts.",
      ].filter(Boolean).join("\n")
    : "";
  const coverStyleContext = promptContext.coverStyleProfile
    ? buildCoverStyleGuidance(candidate, promptContext.coverStyleProfile)
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
    '  "imagePrompt": "single paragraph for a 1200x630 cover image prompt that follows the visual direction below, with no text, no UI, and no watermark",',
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
    "- The imagePrompt should match the cover style guidance below rather than defaulting to the same generic workspace image every time.",
    "",
    `Selected layer: ${promptContext.layerLabel}`,
    `Creator workflow stage: ${promptContext.lifecycleStage}`,
    `Template type: ${templateProfile?.briefLabel || promptContext.templateType}`,
    `Audience: ${promptContext.audience}`,
    `Cluster: ${promptContext.cluster}`,
    `Core topic: ${candidate.seedTopic}`,
    `Primary angle: ${candidate.angle}`,
    `Primary product to support naturally: ${promptContext.primaryProductName}`,
    `Supporting surfaces when relevant: ${promptContext.supportedProducts.join(", ")}`,
    "",
    brandContext,
    scenarioContext,
    dealBoardContext,
    landingPageContext,
    trendContext,
    coverStyleContext,
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
    finalImagePrompt: composeCoverImagePrompt({
      candidate,
      promptContext,
      styleProfile: promptContext.coverStyleProfile,
      modelPrompt: imagePrompt,
    }),
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
                "Keep the scene visually coherent and premium, with one strong focal idea rather than many competing objects.",
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
  const landingPageSupport = buildLandingPageSupportMarkdown(
    candidate,
    internalLinkingRules,
  );
  const liveOpportunities = buildLiveOpportunitiesMarkdown(candidate);

  const markdown = appendMarkdownSections(draft.markdown, [
    toolSection,
    landingPageSupport,
    liveOpportunities,
    relatedReading,
  ]);
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
    lifecycleStage: candidate.lifecycleStage || inferLifecycleStage(candidate),
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
      lifecycleStage: candidate.lifecycleStage || inferLifecycleStage(candidate),
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
  const stepTracker = createStepTracker();
  const runState = {
    startedAt: new Date(),
    timeZone: getEnv("BLOG_TIMEZONE", DEFAULT_TIMEZONE),
    sequenceNumber: 0,
    layer: "",
    lifecycleStage: "",
    sourceType: "",
    primaryProduct: "",
    title: "",
    slug: "",
    pageUrl: "",
    manifestUrl: "",
    documentUrl: "",
    imageUrl: "",
    wordCount: 0,
    tags: [],
    ctaStyle: "",
    searchConsoleCandidateCount: 0,
    trendCandidateCount: 0,
    dealBoardCandidateCount: 0,
    errorMessage: "",
    failedStep: "",
    failedStepLabel: "",
  };
  const dingTalkWebhook = getEnv("BLOG_DINGTALK_WEBHOOK", DEFAULT_DINGTALK_WEBHOOK);
  const dingTalkSecret = getEnv("BLOG_DINGTALK_SECRET");
  let notificationStatus = args.dryRun ? "dry_run" : "failed";

  stepTracker.start("BOOT");
  logStep("BOOT", "Starting blog publisher", {
    dryRun: args.dryRun,
    topicOverride: args.topic || "",
    layerOverride: args.layer || "",
    productOverride: args.product || "",
  });
  try {
    await loadLocalEnvFiles();
    const configBundle = await loadV1ConfigBundle();
    logStep("CONFIG", "Loaded V4 content configuration", {
      topicCounts: {
        coreEditorial: configBundle.topicLibrary.coreEditorial?.length || 0,
        toolProblem: configBundle.topicLibrary.toolProblem?.length || 0,
        trendLinked: configBundle.topicLibrary.trendLinked?.length || 0,
        landingSupport: configBundle.landingPageSupportLibrary.articles?.length || 0,
        brands: configBundle.programmaticLibrary.brands?.length || 0,
        emailScenarios: configBundle.programmaticLibrary.emailScenarios?.length || 0,
        creatorScenarios: configBundle.programmaticLibrary.creatorScenarios?.length || 0,
        dealCategories: configBundle.dealCategoryMap?.length || 0,
      },
    });

    const projectRoot = getProjectRoot();
    const timeZone = getEnv("BLOG_TIMEZONE", DEFAULT_TIMEZONE);
    runState.timeZone = timeZone;
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
      hasCurrentsApiKey: Boolean(getEnv("BLOG_CURRENTS_API_KEY")),
      hasGnewsApiKey: Boolean(getEnv("BLOG_GNEWS_API_KEY")),
      hasDingTalkWebhook: Boolean(dingTalkWebhook),
      hasDingTalkSecret: Boolean(dingTalkSecret),
      dealSourceBaseApi: getDealBoardBaseApi(configBundle.dealBoardRules),
    });

    const publicOssBaseUrl = buildPublicOssBaseUrl(ossBucket, ossEndpoint);
    const fixedManifestUrl = `${publicOssBaseUrl}/${ossPrefix}/manifest.json`;
    runState.manifestUrl = fixedManifestUrl;
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
    runState.sequenceNumber = Number(manifest.total || manifest.posts?.length || 0) + 1;

    const searchConsoleContext = await getSearchConsoleContext(configBundle.queryRules, siteBaseUrl);
    runState.searchConsoleCandidateCount = searchConsoleContext.candidates?.length || 0;
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
    const trendContext = await getTrendContext(configBundle);
    runState.trendCandidateCount = trendContext.candidates?.length || 0;
    logStep("TREND", "Resolved external trend signals", {
      ok: trendContext.ok,
      reason: trendContext.reason || "",
      articles: trendContext.articles?.length || 0,
      candidates: trendContext.candidates?.length || 0,
    });
    if (trendContext.ok && trendContext.candidates?.length) {
      logStep("TREND", "Top usable trend candidates", {
        topics: trendContext.candidates.slice(0, 5).map((item) => ({
          seedTopic: item.seedTopic,
          product: item.primaryProduct,
          score: item.trendSignal?.totalScore || 0,
          source: item.trendSignal?.sourceName || "",
        })),
      });
    }
    const dealBoardContext = await getDealBoardContext({
      configBundle,
      siteBaseUrl,
      dateString: date,
      timeZone,
    });
    runState.dealBoardCandidateCount = dealBoardContext.candidates?.length || 0;
    logStep("DEAL_BOARD", "Resolved live deal supply signals", {
      ok: dealBoardContext.ok,
      reason: dealBoardContext.reason || "",
      rows: dealBoardContext.rows?.length || 0,
      categoryCandidates: dealBoardContext.categoryCandidates?.length || 0,
      spotlightCandidates: dealBoardContext.spotlightCandidates?.length || 0,
    });
    if (dealBoardContext.ok && dealBoardContext.candidates?.length) {
      logStep("DEAL_BOARD", "Top live deal candidates", {
        topics: dealBoardContext.candidates.slice(0, 5).map((item) => ({
          seedTopic: item.seedTopic,
          sourceType: item.sourceType,
          lifecycleStage: item.lifecycleStage,
          product: item.primaryProduct,
        })),
      });
    }

    if (!aiApiKey) {
      throw new Error("Missing BLOG_AI_API_KEY.");
    }

    const publishLog = await readPublishLog();
    stepTracker.start("TOPIC_SELECTION");
    const selection = selectCandidate({
      args,
      configBundle,
      manifest,
      publishLog,
      dateString: date,
      searchConsoleCandidates: searchConsoleContext.ok ? searchConsoleContext.candidates : [],
      trendCandidates: trendContext.ok ? trendContext.candidates : [],
      dealBoardCandidates: dealBoardContext.ok ? dealBoardContext.candidates : [],
    });
    let candidate = selection.candidate;
    candidate = await hydrateDealBoardCandidate(
      candidate,
      configBundle.dealBoardRules,
      siteBaseUrl,
    );
    const templateProfile = getTemplateProfile(configBundle.programmaticLibrary, candidate);
    runState.layer = candidate.layer;
    runState.lifecycleStage = candidate.lifecycleStage || inferLifecycleStage(candidate);
    runState.sourceType = candidate.sourceType || "library";
    runState.primaryProduct = candidate.primaryProduct;
    stepTracker.success("TOPIC_SELECTION", {
      layer: candidate.layer,
      lifecycleStage: runState.lifecycleStage,
      sourceType: candidate.sourceType || "library",
      product: candidate.primaryProduct,
    });
    stepTracker.success("BOOT", {
      siteBaseUrl,
      sequenceNumber: runState.sequenceNumber,
    });

    stepTracker.start("AI_TEXT");
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
    runState.title = draft.title;
    runState.wordCount = getWordCount(draft.markdown);
    runState.tags = draft.tags;
    stepTracker.success("AI_TEXT", {
      title: draft.title,
      wordCount: runState.wordCount,
    });

    const existingSlugs = new Set((manifest.posts || []).map((post) => post.slug));
    const slug = ensureUniqueSlug(slugify(draft.title), existingSlugs);
    runState.slug = slug;
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

    stepTracker.start("AI_IMAGE");
    const imageAsset = await generateCoverImage({
      prompt: draft.finalImagePrompt || draft.imagePrompt,
      apiKey: aiApiKey,
      baseUrl: aiBaseUrl,
      model: imageModel,
    });
    stepTracker.success("AI_IMAGE", {
      mimeType: imageAsset.mimeType,
    });

    const imageExtension = inferFileExtension(imageAsset.mimeType);
    const imageKey = `${ossPrefix}/images/${year}/${month}/${slug}-cover.${imageExtension}`;
    const imageUrl = `${publicOssBaseUrl}/${imageKey}`;
    const documentKey = `${ossPrefix}/posts/${slug}.json`;
    const documentUrl = `${publicOssBaseUrl}/${documentKey}`;
    runState.imageUrl = imageUrl;
    runState.documentUrl = documentUrl;
    runState.pageUrl = siteBaseUrl ? `${siteBaseUrl}/blog/${slug}` : "";

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
    runState.ctaStyle = enriched.ctaStyle;

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
      targetLandingPages: candidate.targetLandingPages || [],
      contentCluster: candidate.cluster || "",
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
      stepTracker.skip("OSS_UPLOAD");
      stepTracker.skip("MANIFEST_UPDATE");
      stepTracker.skip("REVALIDATE");
      stepTracker.skip("VERIFY");
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

      notificationStatus = "dry_run";

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

    stepTracker.start("OSS_UPLOAD");
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
    stepTracker.success("OSS_UPLOAD", {
      imageKey,
      documentKey,
    });

    stepTracker.start("MANIFEST_UPDATE");
    await putObject(
      ossClient,
      `${ossPrefix}/manifest.json`,
      Buffer.from(JSON.stringify(nextManifest, null, 2)),
      {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    );
    stepTracker.success("MANIFEST_UPDATE", {
      totalPosts: nextManifest.total,
    });

    stepTracker.start("REVALIDATE");
    const revalidateResult = await revalidateSite({
      siteBaseUrl,
      secret,
      manifestUrl: fixedManifestUrl,
    });
    stepTracker.success("REVALIDATE");

    stepTracker.start("VERIFY");
    const verification = await verifyPublishedPost({
      siteBaseUrl,
      slug,
    });
    stepTracker.success("VERIFY", {
      verifiedSlug: verification?.post?.slug || "",
    });
    await appendPublishLog(publishLogEntry);
    await appendTopicLedger(topicLedgerEntry);

    logStep("VERIFY", "Publish flow completed", {
      slug,
      verificationAvailable: Boolean(verification?.post?.slug),
    });

    notificationStatus = "success";

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
  } catch (error) {
    const activeFailureStep = stepTracker
      .snapshot()
      .find((step) => step.status === "running");
    if (activeFailureStep?.step) {
      stepTracker.fail(activeFailureStep.step, error);
      runState.failedStep = activeFailureStep.step;
      runState.failedStepLabel = activeFailureStep.label;
    } else {
      stepTracker.fail("BOOT", error);
      runState.failedStep = "BOOT";
      runState.failedStepLabel = NOTIFICATION_STEP_LABELS.BOOT;
    }

    runState.errorMessage = error instanceof Error ? error.message : String(error);
    logError("FATAL", error);
    throw error;
  } finally {
    const markdownText = buildDingTalkMarkdown({
      status: notificationStatus,
      args,
      runState,
      stepTracker,
    });
    const titlePrefix =
      notificationStatus === "success"
        ? "Blog 自动发布成功"
        : notificationStatus === "dry_run"
          ? "Blog 自动演练完成"
          : "Blog 自动发布失败";
    const titleSuffix = runState.sequenceNumber ? `｜第${runState.sequenceNumber}篇` : "";
    const titleSlug = runState.slug ? `｜${runState.slug}` : "";
    try {
      await sendDingTalkNotification({
        webhook: dingTalkWebhook,
        secret: dingTalkSecret,
        title: `${titlePrefix}${titleSuffix}${titleSlug}`,
        markdownText,
      });
    } catch (notificationError) {
      logError("DINGTALK", notificationError);
    }
  }
}

main().catch((error) => {
  logError("FATAL", error);
  process.exitCode = 1;
});
