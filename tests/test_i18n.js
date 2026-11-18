const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadI18n(saved, language) {
  const storage = { getItem: () => saved, setItem() {} };
  const document = { documentElement: {}, querySelectorAll: () => [] };
  const window = { localStorage: storage, dispatchEvent() {} };
  const context = { window, document, navigator: { language }, CustomEvent: function () {} };
  vm.runInNewContext(fs.readFileSync("static/i18n.js", "utf8"), context);
  return context.window.I18n;
}

assert.equal(loadI18n("zh-CN", "en-US").locale, "zh-CN");
assert.equal(loadI18n("invalid", "zh-TW").locale, "zh-CN");
assert.equal(loadI18n("", "ja-JP").locale, "en");
assert.equal(loadI18n("en", "zh-CN").t("status.成功"), "Success");
assert.equal(loadI18n("en", "en-US").t("stats.insight.total", { total: 3 }), "The current view contains 3 unique RJ works.");
assert.equal(loadI18n("en", "en-US").t("missing.key"), "missing.key");

const styles = fs.readFileSync("static/library.css", "utf8");
const selectedRule = styles.match(/\.locale-switch button\[aria-pressed="true"\]\s*\{([^}]+)\}/)?.[1] || "";
assert.match(selectedRule, /background:\s*var\(--blue\)/);
assert.doesNotMatch(selectedRule, /var\(--ink\)/);
