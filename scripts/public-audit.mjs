import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const fallbackIgnoreDirectories = new Set([
  ".git",
  ".next",
  ".open-next",
  ".wrangler",
  "node_modules",
  "out",
  "test-runs",
]);

const fallbackIgnoreFiles = new Set([".env", ".env.local", ".dev.vars"]);

function isLocalSecretFile(name) {
  return fallbackIgnoreFiles.has(name) || /^\.env\..+\.local$/i.test(name);
}

const binaryExtensions = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

function tryGitTrackedFiles() {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    const rawFiles = execFileSync("git", ["ls-files", "-z"], { cwd: root });
    const files = rawFiles.toString("utf8").split("\0").filter(Boolean);
    return { root, files, source: "git" };
  } catch {
    return null;
  }
}

async function walkFiles(root, directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && fallbackIgnoreDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      if (isLocalSecretFile(entry.name)) continue;
      files.push(path.relative(root, absolutePath).replaceAll(path.sep, "/"));
    }
  }

  return files;
}

const gitFiles = tryGitTrackedFiles();
const root = gitFiles?.root ?? process.cwd();
const trackedFiles = gitFiles?.files ?? (await walkFiles(root));
const fileSource = gitFiles?.source ?? "filesystem";

const checks = [
  {
    name: "OpenAI/DeepSeek-style API key",
    pattern: /sk-(?!your-key-here\b)[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: "literal bearer token",
    pattern: /Bearer\s+(?!\$\{apiKey\}\b|YOUR_|your-)[A-Za-z0-9._-]{30,}/g,
  },
  {
    name: "private key block",
    pattern: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g,
  },
  {
    name: "Cloudflare credential assignment",
    pattern:
      /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|CF_ACCOUNT_ID)\s*=\s*(?!your-|xxx|<)[^\s#]+/gi,
  },
];

const findings = [];
let scanned = 0;

for (const file of trackedFiles) {
  const ext = path.extname(file).toLowerCase();
  if (binaryExtensions.has(ext)) continue;

  const absolutePath = path.join(root, file);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) continue;

  const text = buffer.toString("utf8");
  scanned += 1;

  for (const check of checks) {
    check.pattern.lastIndex = 0;
    for (const match of text.matchAll(check.pattern)) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${file}:${line} ${check.name}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Public audit failed. Review these potential secrets:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Public audit passed via ${fileSource}: scanned ${scanned} text files, no obvious secrets found.`,
);
