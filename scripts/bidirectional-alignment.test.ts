import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = () =>
  readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layoutSource = () =>
  readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const packageSource = () =>
  readFileSync(new URL("../package.json", import.meta.url), "utf8");
const readmeSource = () =>
  readFileSync(new URL("../README.md", import.meta.url), "utf8");
const skillSource = () =>
  readFileSync(new URL("../skill-package/speak-fojing/SKILL.md", import.meta.url), "utf8");
const publicSkillSource = () =>
  readFileSync(new URL("../public/downloads/speak-fojing-SKILL.md", import.meta.url), "utf8");
const promptSource = () =>
  readFileSync(new URL("../lib/prompt.ts", import.meta.url), "utf8");
const routeSource = () =>
  readFileSync(new URL("../app/api/translate/route.ts", import.meta.url), "utf8");
const cssSource = () =>
  readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const envExampleSource = () =>
  readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const wranglerSource = () =>
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

test("website copy presents translate and explain as paired directions", () => {
  const source = pageSource();

  assert.match(source, /译经成文，解经还意/);
  assert.match(source, /把寻常的话/);
  assert.match(source, /说得符合佛理/);
  assert.match(source, /入坛译经解经/);
  assert.match(source, /白话入坛，化成佛经体/);
  assert.match(source, /佛经长文，翻回正常话/);
  assert.match(source, /isPlainDirection \? "解经" : "译经"/);
  assert.match(source, /今日还可\$\{isPlainDirection \? "解经" : "译经"\}/);
  assert.match(source, /分钟后再\$\{isPlainDirection \? "解经" : "译经"\}/);
  assert.match(
    source,
    /className="hero entry-hero"[\s\S]*className="assembly-section teaching-section"[\s\S]*className="translator-section"/,
  );
  assert.match(source, /\/images\/buddha-riverside-teaching\.jpg/);
});

test("card export uses direction-aware title, footer, and filename semantics", () => {
  const source = pageSource();

  assert.match(source, /cardMainTitle = isPlainDirection \? "解经还意" : "言之成经"/);
  assert.match(source, /cardFooterTitle = isPlainDirection \? "「如是我闻」翻译器 · 解经录" : "「如是我闻」翻译器 · 译经录"/);
  assert.match(source, /cardDownloadTitle = isPlainDirection \? `解经-\$\{levelTitle\}` : `译经-\$\{levelTitle\}`/);
});

test("public docs and metadata describe bidirectional translation", () => {
  assert.match(layoutSource(), /译经成文，解经还意/);
  assert.match(packageSource(), /译经与解经/);

  const readme = readmeSource();
  assert.match(readme, /译经 \+ 解经/);
  assert.match(readme, /解经示例/);
  assert.match(readme, /佛经体翻回直接人话/);
  assert.match(readme, /`direction`, `mode`, `plainMode`/);
});

test("published Skill text and zip include the speak-fojing workflow", () => {
  const source = skillSource();
  const publicCopy = publicSkillSource();
  const zipBytes = readFileSync(
    new URL("../public/downloads/speak-fojing-skill.zip", import.meta.url),
  );

  assert.match(source, /## 解经/);
  assert.match(source, /翻回人话/);
  assert.match(source, /不要以“这段话的意思是”开头/);
  assert.equal(publicCopy, source);
  assert.equal(
    zipBytes.includes("speak-fojing/SKILL.md") ||
      zipBytes.includes("speak-fojing\\SKILL.md"),
    true,
  );
});

test("fojing conversion changes form without inventing a story", () => {
  const prompt = promptSource();
  const skill = skillSource();
  const route = routeSource();

  assert.match(prompt, /外层讲法人物固定为佛陀与须菩提/);
  assert.match(prompt, /佛陀续讲原事—须菩提问答—佛陀解释/);
  assert.match(prompt, /故事已经讲到原文结尾/);
  assert.match(skill, /外层固定为佛陀与须菩提/);
  assert.match(skill, /一个故事可以讲多个道理/);
  assert.doesNotMatch(skill, /先讲一个能听懂的故事/);
  assert.doesNotMatch(skill, /约六成输出可以用“如是我闻”/);
  assert.doesNotMatch(route, /当年有人行路匆忙/);
  assert.doesNotMatch(route, /古代有贤德的人/);
  assert.match(route, /须菩提从座而起，合掌白佛言/);
  assert.match(route, /名词、材料、数量、方向和施受关系必须逐字守真/);
  assert.match(route, /受损一方不得因在意损失而被反向归责/);
  assert.match(route, /isNarrativeHarmInput/);
  assert.match(route, /asksForHarmInstructions/);
  assert.match(route, /reviewFojingDraft/);
  assert.match(route, /原文是事实全集/);
  assert.match(route, /删除照抄真实《金刚经》/);
  assert.match(prompt, /皆大欢喜，信受奉行/);
  assert.match(prompt, /引语守真而不守字/);
  assert.match(prompt, /少壮而无盛气，尚可名少壮乎/);
  assert.match(prompt, /不得写成“两俱受伤”/);
  assert.match(route, /ensureFojingEnding/);
  assert.match(route, /hasConventionalFojingEnding/);
  assert.match(route, /removeCopiedCanonicalOpening/);
  assert.match(route, /校订不能把正文压缩成剧情复述/);
  assert.match(route, /现代对白只能保留语义、对象、语气与作用/);
  assert.match(route, /严格区分“共同促成冲突”和“实际承受伤害”/);
  assert.match(route, /文言化只能改变表达形式，不能删减或替换台词中的命题/);
  assert.match(route, /清除残留的现代社交口语/);
  assert.match(route, /佛在舍卫国祇树给孤独园/);
  assert.match(route, /已有合格结语时不要改成固定句/);
  assert.doesNotMatch(`${prompt}\n${skill}\n${route}`, /华强|瓜摊|保熟|吸铁石/);
});

test("fojing conversion borrows sutra form without forcing Diamond Sutra doctrine", () => {
  const prompt = promptSource();
  const skill = skillSource();
  const route = routeSource();

  assert.match(prompt, /《金刚经》只作章法、语气和对告结构的参考，不是义理答案库/);
  assert.match(prompt, /经文格式与义理来源必须分离/);
  assert.match(prompt, /原文行为—直接影响—对应道理/);
  assert.match(prompt, /道理不限于佛教术语/);
  assert.match(prompt, /原文没有明显善恶冲突时，不得硬造戒律、罪业、功德或顿悟/);
  assert.match(skill, /义理必须从用户原文中现取/);
  assert.match(skill, /不使用固定佛理题库/);
  assert.match(route, /《金刚经》只参考外层问答格式、复沓和设问，不提供现成义理/);
  assert.match(route, /不得把普通通知、协作、创作、娱乐或技术操作强行解释成破相、离执或无所得/);
  assert.doesNotMatch(prompt, /凡所有相，皆是虚妄/);
  assert.doesNotMatch(prompt, /一切有为法，如梦幻泡影/);
  assert.doesNotMatch(prompt, /应无所住而生其心/);
});

test("fojing conversion uses a stable sutra-style opening", () => {
  const prompt = promptSource();
  const skill = skillSource();
  const route = routeSource();

  assert.match(prompt, /如是我闻。一时，佛在舍卫城。尔时，须菩提从座而起，合掌白佛言/);
  assert.match(skill, /如是我闻。一时，佛在舍卫城。尔时，须菩提从座而起，合掌白佛言/);
  assert.match(route, /DEFAULT_FOJING_OPENING = "如是我闻。一时，佛在舍卫城。"/);
  assert.match(route, /尔时，须菩提从座而起，合掌白佛言/);
  assert.doesNotMatch(route, /"如是我闻。一时，佛与须菩提共坐/);
});

test("public website uses browser-owned API keys instead of a shared server key", () => {
  const page = pageSource();
  const route = routeSource();
  const envExample = envExampleSource();
  const wrangler = wranglerSource();

  assert.match(page, /rushi-wowen-deepseek-api-key/);
  assert.match(page, /window\.localStorage\.setItem/);
  assert.match(page, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(page, /配置 DeepSeek API/);
  assert.match(page, /清除本机 Key/);
  assert.match(route, /function getUserApiKey/);
  assert.match(route, /请先在网页中配置你自己的 DeepSeek API Key/);
  assert.doesNotMatch(route, /process\.env\.DEEPSEEK_API_KEY/);
  assert.doesNotMatch(envExample, /^DEEPSEEK_API_KEY=/m);
  assert.doesNotMatch(wrangler, /example\.com/);
});

test("page hides retired sections and links to the original project", () => {
  const source = pageSource();
  const css = cssSource();

  assert.match(source, /className="attribution-footer"/);
  assert.match(source, /https:\/\/hehuzhouli\.com\//);
  assert.match(source, /https:\/\/github\.com\/Aspirin0000\/zhouli-translator/);
  assert.match(source, /https:\/\/github\.com\/lizi605\/rushi-wowen-translator/);
  assert.match(source, /\/downloads\/speak-fojing-skill\.zip/);
  assert.match(css, /\.skill-section,[\s\S]*\.attribution-footer ~ footer[\s\S]*display: none/);
});
