"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const test = require("node:test");

const { runBrowserSuite } = require("./helpers/browser-harness.js");

const COMPONENT = resolve(__dirname, "..");
const SUITE = join(__dirname, "browser", "browser-suite.js");
const FIXTURES = join(__dirname, "fixtures");
const ADAPTERS = {
  chrome: join(COMPONENT, "chrome", "adapters", "chatgpt_exporter.js"),
  firefox: join(COMPONENT, "firefox", "adapters", "chatgpt_exporter.js")
};

let browserResults;

function stableFacts(results) {
  return results.map(({ name, ok, facts }) => ({ name, ok, facts }));
}

for (const [browser, adapterPath] of Object.entries(ADAPTERS)) {
  test(`${browser} stable adapter passes real-DOM regression fixtures`, { timeout: 45_000 }, async (t) => {
    const suiteResult = runBrowserSuite({ adapterPath, suitePath: SUITE, fixturesDir: FIXTURES });
    browserResults ||= {};
    browserResults[browser] = suiteResult.results;
    assert.equal(suiteResult.results.length, 10);
    for (const result of suiteResult.results) {
      await t.test(result.name, () => {
        assert.equal(result.ok, true, result.error || "fixture failed");
      });
    }
  });
}

test("Chrome and Firefox adapters have behavioral fixture parity", () => {
  assert.deepEqual(stableFacts(browserResults.chrome), stableFacts(browserResults.firefox));
});

test("frozen bundled KaTeX CSS is identical across adapters", () => {
  function extract(source) {
    const match = source.match(/const BUNDLED_KATEX_CSS = String\.raw`([\s\S]*?)`;\n\n  function bundledKatexCss/);
    assert.ok(match, "bundled KaTeX CSS literal not found");
    return match[1];
  }
  const chromeCss = extract(readFileSync(ADAPTERS.chrome, "utf8"));
  const firefoxCss = extract(readFileSync(ADAPTERS.firefox, "utf8"));
  assert.equal(chromeCss, firefoxCss);
  assert.equal(
    createHash("sha256").update(chromeCss).digest("hex"),
    "bdb2a5099d004528f1a30c4d1508a08a17b248fd2fa413b33910cb0d2ad078f1"
  );
});
