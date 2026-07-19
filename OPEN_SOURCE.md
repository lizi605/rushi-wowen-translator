# Open Source Readiness

This repository is public. Use this checklist before each release to keep the
published source and deployment free of maintainer-owned credentials.

## Public Release Boundary

Safe to publish:

- Next.js app source code.
- DeepSeek BYOK proxy code. Each visitor supplies their own API key in the browser.
- Prompt construction logic.
- The downloadable `speak-fojing` Skill package.
- Public images and static download files.
- README, license, and example environment variables.

Do not commit or publish:

- Real `.env`, `.env.local`, or `.dev.vars` files.
- Any shared or maintainer-owned DeepSeek API key. The deployed app must remain BYOK-only.
- API keys, Cloudflare API tokens, account IDs, service tokens, or session data.
- Private test logs under `test-runs/`.
- Local build output such as `.next/`, `.open-next/`, `.wrangler/`, and `node_modules/`.
- Production-only WAF, billing, alerting, or abuse-response notes.

## Release Checklist

Run these checks immediately before setting the GitHub repository public:

```bash
npm run public:audit
npm test
npm run typecheck
npm run build
git status --short
```

Expected state:

- `npm run public:audit` reports no obvious secrets in tracked text files.
- Tests, typecheck, and build pass.
- The hosted app asks each visitor for their own DeepSeek API key and does not fall back to a server key.
- `git status --short` is clean after committing.
