import fs from "node:fs/promises";
import path from "node:path";

const baselinePath = process.argv[2] ?? "scripts/fojing-batch-sample.json";
const endpoint = process.env.FOJING_TEST_ENDPOINT ?? "http://localhost:3000/api/translate";
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();

if (!apiKey) {
  throw new Error("Set DEEPSEEK_API_KEY before running the batch test.");
}

const baseline = JSON.parse(await fs.readFile(baselinePath, "utf8"));
const payloads = baseline.results.map(({ text, mode, level }) => ({
  text,
  mode,
  level,
}));

const outDir = path.resolve("test-runs");
await fs.mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const jsonPath = path.join(outDir, `fojing-100-after-prompt-fix-${stamp}.json`);
const mdPath = path.join(outDir, `fojing-100-after-prompt-fix-${stamp}.md`);

const modeName = {
  gentle: "慈悲开示",
  debate: "机锋辩难",
  defend: "方便圆说",
  lament: "无常悲叹",
};
const levelName = { light: "一偈", standard: "一经", grand: "一论" };
const fojingWords = [
  "如是",
  "众生",
  "善知识",
  "古",
  "功德",
  "佛理",
  "因缘",
  "情分",
  "信",
  "体面",
  "道理",
  "菩萨",
  "法门",
  "慈悲",
];
const classicalMarks = ["吾", "余", "夫", "矣", "哉", "乎", "焉", "兮"];
const bannedTailPatterns = [
  /你好好想想/,
  /你且想想/,
  /这其中的道理/,
  /仔细想想其中的道理/,
  /这正是我担忧的啊/,
];
const fakeCitationPatterns = [
  /《[^》]{1,12}》[^。！？!?]{0,30}(所言|有云|曰|云|说|记载)/,
  /(佛陀|世尊|祖师|古德)[^。！？!?]{0,10}(云|曰|说|有言)/,
  /古人云[：:]/,
  /某经有云/,
];
const modernConnectors = [
  "我听说",
  "古代",
  "古时候",
  "当年",
  "但是",
  "所以",
  "这样看来",
  "难道",
  "有人",
  "如今",
  "现在",
  "若按",
];

function hasAnyPattern(result, patterns) {
  return patterns.some((pattern) => pattern.test(result));
}

function scoreItem(item) {
  const result = item.result || "";
  const chars = Array.from(result).length;
  const classicalCount = classicalMarks.reduce(
    (sum, mark) => sum + (result.split(mark).length - 1),
    0,
  );
  const hasFakeCitation = hasAnyPattern(result, fakeCitationPatterns);
  const hasBannedTail = hasAnyPattern(result, bannedTailPatterns);
  const hasFojingWord = fojingWords.some((word) => result.includes(word));
  const hasModernConnector = modernConnectors.some((word) =>
    result.includes(word),
  );
  const hasMarkdown = /^#|```|\*\*|^-\s/m.test(result);
  const tokenParts = item.text
    .split(/[，。！？!?、\s]+/)
    .map((word) => word.replace(/[“”"']/g, ""))
    .filter((word) => word.length >= 2);
  const hasOriginalTrace = tokenParts.some((word) => {
    const head = word.slice(0, Math.min(4, word.length));
    return result.includes(head);
  });
  const lengthOk =
    item.level === "light"
      ? chars >= 60 && chars <= 190
      : item.level === "standard"
        ? chars >= 120 && chars <= 340
        : chars >= 240 && chars <= 560;
  const modeOk =
    item.mode === "gentle"
      ? ["体面", "情分", "不妨", "可以", "说明白", "相处", "保全"].some(
          (word) => result.includes(word),
        )
      : item.mode === "debate"
        ? ["难道", "这样看来", "不是", "而是", "可见", "若"].some((word) =>
            result.includes(word),
          )
        : item.mode === "defend"
          ? ["看似", "其实", "功德", "合乎", "不能说", "君子"].some((word) =>
              result.includes(word),
            )
          : ["因缘", "慈悲", "长此以往", "怎能", "岂", "可见"].some((word) =>
              result.includes(word),
            );

  const issues = [];
  if (!item.ok) issues.push("request_failed");
  if (item.demo) issues.push("demo_mode");
  if (!lengthOk) issues.push(`length_${chars}`);
  if (!hasFojingWord) issues.push("missing_fojing_vocab");
  if (!hasModernConnector) issues.push("missing_modern_connector");
  if (classicalCount > 4) issues.push(`too_classical_${classicalCount}`);
  if (hasFakeCitation) issues.push("fake_citation");
  if (hasBannedTail) issues.push("banned_tail");
  if (hasMarkdown) issues.push("markdown_or_explanation");
  if (!hasOriginalTrace) issues.push("weak_original_trace");
  if (!modeOk) issues.push("weak_mode_signal");

  return {
    chars,
    classicalCount,
    hasFakeCitation,
    hasBannedTail,
    hasFojingWord,
    hasModernConnector,
    hasOriginalTrace,
    lengthOk,
    modeOk,
    issues,
    pass: issues.length === 0,
  };
}

async function callOne(index) {
  const payload = payloads[index];
  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "x-client-id": `fojing-after-fix-${Date.now()}-${index}-${attempt}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      const item = {
        index: index + 1,
        ...payload,
        ok: response.ok,
        status: response.status,
        demo: Boolean(data.demo),
        model: data.model,
        result: data.result || "",
        error: data.error || "",
        usage: data.usage || null,
        latencyMs: Date.now() - startedAt,
      };
      return { ...item, score: scoreItem(item) };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  const item = {
    index: index + 1,
    ...payload,
    ok: false,
    status: 0,
    demo: false,
    model: "",
    result: "",
    error: lastError?.message || "unknown error",
    usage: null,
    latencyMs: Date.now() - startedAt,
  };
  return { ...item, score: scoreItem(item) };
}

const results = [];
const concurrency = Number(process.env.FOJING_TEST_CONCURRENCY || 5);
let next = 0;

async function worker() {
  while (next < payloads.length) {
    const current = next;
    next += 1;
    const item = await callOne(current);
    results[current] = item;
    const label = item.ok
      ? item.score.pass
        ? "PASS"
        : `CHECK:${item.score.issues.join(",")}`
      : `FAIL:${item.error}`;
    console.log(
      `${String(current + 1).padStart(3, "0")} ${label} ${item.mode}/${item.level} ${item.score.chars}字 ${item.latencyMs}ms`,
    );
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const totalUsage = results.reduce(
  (acc, item) => {
    if (!item.usage) return acc;
    acc.prompt += item.usage.prompt_tokens || 0;
    acc.completion += item.usage.completion_tokens || 0;
    acc.total += item.usage.total_tokens || 0;
    acc.cached +=
      item.usage.prompt_cache_hit_tokens ||
      item.usage.prompt_tokens_details?.cached_tokens ||
      0;
    return acc;
  },
  { prompt: 0, completion: 0, total: 0, cached: 0 },
);

const byIssue = {};
const byMode = Object.fromEntries(
  Object.keys(modeName).map((mode) => [mode, { total: 0, pass: 0 }]),
);
const byLevel = Object.fromEntries(
  Object.keys(levelName).map((level) => [level, { total: 0, pass: 0 }]),
);

for (const item of results) {
  for (const issue of item.score.issues) {
    byIssue[issue] = (byIssue[issue] || 0) + 1;
  }
  byMode[item.mode].total += 1;
  byLevel[item.level].total += 1;
  if (item.score.pass) {
    byMode[item.mode].pass += 1;
    byLevel[item.level].pass += 1;
  }
}

const failed = results.filter((item) => !item.ok);
const nonDemo = results.filter((item) => item.ok && !item.demo).length;
const pass = results.filter((item) => item.score.pass).length;
const needsReview = results.filter((item) => item.score.issues.length > 0);
const avgChars = Math.round(
  results.reduce((sum, item) => sum + item.score.chars, 0) / results.length,
);
const avgLatency = Math.round(
  results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length,
);

const baselineSummary = baseline.summary || {};
const report = {
  createdAt: new Date().toISOString(),
  baselinePath,
  endpoint,
  count: results.length,
  model: [...new Set(results.map((item) => item.model).filter(Boolean))],
  summary: {
    pass,
    needsReview: needsReview.length,
    failed: failed.length,
    nonDemo,
    avgChars,
    avgLatency,
    totalUsage,
    byIssue,
    byMode,
    byLevel,
    comparison: {
      previousFailed: baselineSummary.failed,
      previousAvgLatency: baselineSummary.avgLatency,
      previousTotalTokens: baselineSummary.totalUsage?.total,
    },
  },
  results,
};
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

const sampleGood = results.filter((item) => item.score.pass).slice(0, 8);
const sampleNeedsReview = needsReview.slice(0, 16);
const md = [
  "# 「如是我闻」翻译器 100 条复测报告（Prompt 修正后）",
  "",
  `- 时间：${report.createdAt}`,
  `- 模型：${report.model.join(", ") || "未知"}`,
  `- 总数：${results.length}`,
  `- 成功走 DeepSeek：${nonDemo}/${results.length}`,
  `- 规则初筛通过：${pass}/${results.length}`,
  `- 需人工复看：${needsReview.length}/${results.length}`,
  `- 请求失败：${failed.length}/${results.length}`,
  `- 平均字数：${avgChars}`,
  `- 平均延迟：${avgLatency}ms`,
  `- Token 合计：prompt ${totalUsage.prompt} / completion ${totalUsage.completion} / total ${totalUsage.total} / cached ${totalUsage.cached}`,
  "",
  "## 问题分布",
  "",
  Object.keys(byIssue).length
    ? Object.entries(byIssue)
        .map(([issue, count]) => `- ${issue}: ${count}`)
        .join("\n")
    : "- 无",
  "",
  "## 按辞气",
  "",
  ...Object.entries(byMode).map(
    ([mode, stat]) => `- ${modeName[mode]}：${stat.pass}/${stat.total}`,
  ),
  "",
  "## 按篇幅",
  "",
  ...Object.entries(byLevel).map(
    ([level, stat]) => `- ${levelName[level]}：${stat.pass}/${stat.total}`,
  ),
  "",
  "## 通过样例",
  "",
  ...sampleGood.flatMap((item) => [
    `### ${item.index}. ${modeName[item.mode]} / ${levelName[item.level]}`,
    "",
    `原话：${item.text}`,
    "",
    item.result,
    "",
  ]),
  "## 需复看样例",
  "",
  ...sampleNeedsReview.flatMap((item) => [
    `### ${item.index}. ${modeName[item.mode]} / ${levelName[item.level]} / ${item.score.issues.join(", ")}`,
    "",
    `原话：${item.text}`,
    "",
    item.result || item.error,
    "",
  ]),
].join("\n");
await fs.writeFile(mdPath, md);

console.log("\nSUMMARY");
console.log(JSON.stringify(report.summary, null, 2));
console.log(`JSON ${jsonPath}`);
console.log(`MD ${mdPath}`);
