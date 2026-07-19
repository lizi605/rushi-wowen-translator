# 「如是我闻」翻译器

**译经 + 解经：把寻常白话写成佛经体，也把佛经体翻回直接人话。**

「如是我闻」翻译器是一个 Next.js 网页应用。它支持两种方向：

- 译经：把普通中文改写成近期中文互联网流行的“佛经体 / 佛说体”白话翻译腔。
- 解经：把佛经体翻回直接、清楚、正常的人话。

如果没有配置 API Key，应用会使用本地演示文案，仍然可以预览界面和交互。

## 功能

| Capability | Detail |
| --- | --- |
| 双向翻译 | 译经生成佛经体，解经把佛经体翻回直接人话 |
| 译经模式 | 慈悲开示、机锋辩难、方便圆说、无常悲叹 |
| 解经模式 | 直白释义、耐心讲明、潜台词版、锐评拆穿 |
| 三档长度 | 一偈 / 一经 / 一论 与 略释 / 明释 / 详释 |
| 演示模式 | 没有 API Key 时返回本地示例结果 |
| Skill 分发 | 支持复制或下载 `speak-fojing` Skill |
| 图片导出 | 将译经或解经结果导出为图片卡片 |

## Examples

### 译经示例

Input:

```text
疯狂星期四，谁愿请我一斋才合乎佛理
```

Output style:

```text
如是我闻。一时，须菩提白佛言：“世尊，今日所谓疯狂星期四者，有人欲求友人请其一斋，此念云何？”佛告须菩提：“譬如有一人，见炸鸡之食，向众友问言：‘谁愿请我一斋，方合今日佛理？’须菩提，于意云何？彼人是真求佛理，抑或求一餐之饱？”须菩提言：“世尊，实是求食，借佛理以成其趣。”佛言：“如是。能直言所求，又以诙谐使人无迫，是名方便；若以功德逼人请客，则非方便。”
```

### 解经示例

Input:

```text
如是我闻，今日我设此山门，并非拒人千里，只是怕众人一拥而入，坏了满座清净。
```

Output style:

```text
我设次数限制不是为了故意拦人，而是怕接口被刷爆，影响正常用户使用。
```

## Quick Start

Requirements:

- Node.js 20 or newer.
- An OpenAI-compatible chat completions API key for real generation.

Run locally:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open <http://localhost:3000>.

`.env.local` example:

```env
DEEPSEEK_API_KEY=sk-your-key-here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_REVIEW_MODEL=deepseek-v4-pro
MAX_OUTPUT_TOKENS=2400
```

`DEEPSEEK_BASE_URL` is expected to be the provider base URL, not the full `/chat/completions` path. If `DEEPSEEK_API_KEY` is missing or left as a placeholder, the app falls back to demo output.

## Project Structure

```text
app/
  api/translate/route.ts       Server-side generation endpoint
  page.tsx                     Main UI and card export flow
lib/
  prompt.ts                    译经/解经 prompt assembly and perspective rules
  cardDownload.ts              Unique card download filenames
public/
  downloads/                   Public Skill assets
  images/                      Website images
scripts/
  public-audit.mjs             Public-release secret scan
  run-fojing-batch.mjs         Legacy batch regression runner
  *.test.ts                    Unit and public-asset regression tests
skill-package/
  speak-fojing/                Source Skill package
```

## Runtime Flow

1. The browser submits `text`, `direction`, `mode`, `plainMode`, `level`, and a client id to `/api/translate`.
2. The server validates input length, direction, mode, plainMode, and level.
3. A lightweight in-memory rate limiter checks the request.
4. The server builds a direction-specific system prompt plus a user prompt.
5. The API provider returns a candidate response.
6. The server cleans common failure patterns and returns JSON.

Default runtime choices:

- Model: `deepseek-v4-flash`.
- User input limit: 500 Chinese characters for 译经, 3000 Chinese characters for 解经. Longer stories should be split at natural plot boundaries and translated in multiple passes.
- Output limit: configured by `MAX_OUTPUT_TOKENS`.
- API key scope: server only, never sent to the browser.

## Speak Fojing Skill

The website ships a standalone `speak-fojing` Skill.

| Asset | Path |
| --- | --- |
| Skill source | `skill-package/speak-fojing/` |
| Website copy source | `public/downloads/speak-fojing-SKILL.md` |
| Website ZIP download | `public/downloads/speak-fojing-skill.zip` |
| Public copy URL | `/downloads/speak-fojing-SKILL.md` |
| Public ZIP URL | `/downloads/speak-fojing-skill.zip` |

After editing the Skill source, rebuild the public assets:

```bash
cp skill-package/speak-fojing/SKILL.md public/downloads/speak-fojing-SKILL.md
cd skill-package
zip -r -X ../public/downloads/speak-fojing-skill.zip speak-fojing
```

## Quality Checks

Run before release:

```bash
npm run public:audit
npm test
npm run typecheck
npm run build
```

`npm run public:audit` scans Git-tracked text files for obvious API keys, bearer tokens, private key blocks, and Cloudflare credential assignments. If Git is unavailable, it falls back to scanning workspace text files outside common build/dependency folders. It is a guardrail, not a replacement for manual review.

## Deployment

### Cloudflare Workers

```bash
npm install
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npm run deploy
```

Before deploying, replace the placeholder routes in `wrangler.jsonc` with your real domain.

### Vercel

1. Import the repository into Vercel.
2. Add `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_REVIEW_MODEL`, and `MAX_OUTPUT_TOKENS`.
3. Deploy.

### Self-Hosted Node

```bash
npm install
npm run build
npm run start
```

## Security Notes

- Never commit real `.env`, `.env.local`, or `.dev.vars` files.
- Keep private request logs and batch outputs outside Git.
- Add shared rate limiting before high-traffic public deployments.
- Configure billing alerts on the model provider and hosting platform.
- Review `OPEN_SOURCE.md` before changing repository visibility.

## License

MIT License.
