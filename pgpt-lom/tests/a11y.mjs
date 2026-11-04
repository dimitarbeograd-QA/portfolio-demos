// Accessibility audit with axe-core in a real browser (Playwright). Runs in GitHub Actions (see
// .github/workflows/pgpt-lom-tests.yml) or locally:
//   npm i --no-save playwright @axe-core/playwright && npx playwright install chromium
//   python -m http.server 8000   (from the pgpt-lom folder, in another terminal)
//   node tests/a11y.mjs
// Fails (exit 1) when a "serious" or "critical" WCAG 2.0/2.1 A/AA violation is found.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8000/";
const ROUTES = ["", "#/za-nas", "#/specialnosti", "#/spec-elektrotehnika", "#/dokumenti", "#/novini", "#/stem"];
const SIZES = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch();
let blocking = 0;
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: "reduce" });
  const page = await context.newPage();
  for (const route of ROUTES) {
    await page.goto(`${BASE}index.html${route}`, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = result.violations.filter((v) => ["serious", "critical"].includes(v.impact));
    const label = `${size.name.padEnd(7)} ${route || "(home)"}`;
    if (!bad.length) {
      console.log(`ok    ${label}  (${result.violations.length} minor/moderate)`);
      continue;
    }
    blocking += bad.length;
    console.log(`FAIL  ${label}`);
    for (const v of bad) {
      console.log(`      [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} elements)`);
      for (const n of v.nodes.slice(0, 3)) console.log(`        - ${n.target.join(" ")}`);
    }
  }
  await context.close();
}
await browser.close();
if (blocking) {
  console.error(`\n${blocking} serious/critical accessibility violation(s).`);
  process.exit(1);
}
console.log("\nNo serious or critical accessibility violations.");
