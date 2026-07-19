import assert from "node:assert/strict";
import test from "node:test";

import { buildCardDownloadFilename } from "../lib/cardDownload.ts";

test("builds distinct card download filenames for repeated exports", () => {
  const first = buildCardDownloadFilename(
    "一经",
    new Date("2026-07-03T00:50:12+08:00"),
    "第一篇译经结果",
  );
  const second = buildCardDownloadFilename(
    "一经",
    new Date("2026-07-03T00:50:13+08:00"),
    "第二篇译经结果",
  );

  assert.match(first, /^「如是我闻」翻译器-一经-20260703-005012-[a-z0-9]{6}\.png$/);
  assert.match(second, /^「如是我闻」翻译器-一经-20260703-005013-[a-z0-9]{6}\.png$/);
  assert.notEqual(first, second);
});

test("sanitizes level titles in card download filenames", () => {
  const filename = buildCardDownloadFilename(
    "一/论?",
    new Date("2026-07-03T00:50:12+08:00"),
    "译经结果",
  );

  assert.equal(filename.startsWith("「如是我闻」翻译器-一论-20260703-005012-"), true);
  assert.equal(filename.endsWith(".png"), true);
});
