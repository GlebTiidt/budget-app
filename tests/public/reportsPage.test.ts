import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

test("master report page offers animated chart choices without inline scripts", () => {
  const html = readFileSync("public/reports.html", "utf8");

  assert.match(html, /data-chart="bar"/);
  assert.match(html, /data-chart="line"/);
  assert.match(html, /data-chart="doughnut"/);
  assert.match(html, /\/vendor\/chart\.umd\.min\.js/);
  assert.match(html, /x-telegram-init-data|reports\.js/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.ok(statSync("public/vendor/chart.umd.min.js").size > 100_000);
});
