import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const LIVE = process.env.LIVE_VIEWER_URL || "https://matthew.mccluster.org/equity-uprise-building-core-v2-3d.html";
const OUT = process.env.ACCEPTANCE_OUT || "acceptance-artifacts";
await fs.mkdir(OUT, { recursive: true });

const results = [];
const push = (name, ok, detail = "") => {
  const row = { name, ok: !!ok, detail: String(detail || "") };
  results.push(row);
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? " · " + detail : ""}`);
};
const expect = (name, cond, detail = "") => push(name, !!cond, detail);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function pageCase(name, url, viewport, fn) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const pageErrors = [];
  const coreRequestFailures = [];
  page.on("pageerror", e => pageErrors.push(e.message));
  page.on("console", msg => {
    if (msg.type() === "error") pageErrors.push("console: " + msg.text());
  });
  page.on("requestfailed", req => {
    const u = req.url();
    if (/matthew\.mccluster\.org\/equity-uprise-preview|cdn\.jsdelivr\.net\/npm\/three/i.test(u)) {
      coreRequestFailures.push(`${u} :: ${req.failure()?.errorText || "failed"}`);
    }
  });

  console.log("\n=== " + name + " ===");
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    expect(name + ": HTTP document loaded", !!response && response.ok(), response ? `status=${response.status()}` : "no response");
    await page.locator("canvas").waitFor({ state: "visible", timeout: 60000 });
    expect(name + ": WebGL canvas mounted", await page.locator("canvas").count() === 1);
    await page.locator("#status").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(() => /Working stack loaded/.test(document.querySelector("#status")?.textContent || ""), null, { timeout: 180000 });
    expect(name + ": full B1-F7 stack finished loading", /Working stack loaded/.test(await page.locator("#status").innerText()));
    await fn(page);
    await page.screenshot({ path: path.join(OUT, name.replace(/[^a-z0-9_-]+/gi, "-") + ".png"), fullPage: true });
  } catch (e) {
    push(name + ": execution", false, e.stack || e.message);
    try { await page.screenshot({ path: path.join(OUT, name.replace(/[^a-z0-9_-]+/gi, "-") + "-FAIL.png"), fullPage: true }); } catch {}
  } finally {
    expect(name + ": no browser/runtime errors", pageErrors.length === 0, pageErrors.join(" | "));
    expect(name + ": no core asset request failures", coreRequestFailures.length === 0, coreRequestFailures.join(" | "));
    await context.close();
  }
}

await pageCase("desktop-normal", LIVE, { width: 1440, height: 1000 }, async page => {
  expect("normal: default Labs panel is closed", await page.locator("#labPanel").isHidden());
  expect("normal: stack is active", await page.locator('[data-f="stack"]').getAttribute("class").then(x => /active/.test(x || "")));
  expect("normal: services starts off", /Off/.test(await page.locator("#services").innerText()));
  expect("normal: solar status resolved", !/syncing/.test(await page.locator("#solarStatus").innerText()));

  await page.locator('[data-f="1"]').click();
  expect("normal: floor 1 isolation active", await page.locator('[data-f="1"]').getAttribute("class").then(x => /active/.test(x || "")));
  await page.locator('[data-f="facade"]').click();
  expect("normal: facade isolation active", await page.locator('[data-f="facade"]').getAttribute("class").then(x => /active/.test(x || "")));
  await page.locator('[data-f="stack"]').click();
  expect("normal: stack restores after isolation", await page.locator('[data-f="stack"]').getAttribute("class").then(x => /active/.test(x || "")));

  await page.locator("#services").click();
  expect("normal: services exposes", /Exposed/.test(await page.locator("#services").innerText()));
  expect("normal: services status reports EXPOSED", /EXPOSED/.test(await page.locator("#serviceStatus").innerText()));
  await page.locator("#services").click();
  expect("normal: services hides again", /Off/.test(await page.locator("#services").innerText()));

  await page.locator("#wire").click();
  expect("normal: wireframe toggles to Solid control", /Solid/.test(await page.locator("#wire").innerText()));
  await page.locator("#wire").click();
  expect("normal: solid mode toggles back to Wireframe control", /Wireframe/.test(await page.locator("#wire").innerText()));

  await page.locator("#sunmode").click();
  expect("normal: sun manual Day mode", /Day/.test(await page.locator("#sunmode").innerText()));
  await page.locator("#sunmode").click();
  expect("normal: sun manual Night mode", /Night/.test(await page.locator("#sunmode").innerText()));
  await page.locator("#sunmode").click();
  expect("normal: sun returns to device-clock Auto", /Auto/.test(await page.locator("#sunmode").innerText()));

  await page.locator("#labs").click();
  await page.locator("#labPanel").waitFor({ state: "visible" });
  expect("normal: Labs button opens panel lazily", await page.locator("#labPanel").isVisible());
  expect("normal: lab catalog populated", await page.locator("#labSelect option").count() >= 10);
  expect("normal: difficulty catalog populated", await page.locator("#labDifficulty option").count() >= 3);
});

await pageCase("desktop-it039-foundation", LIVE + "?lab=IT-LAB-039&difficulty=FOUNDATION", { width: 1440, height: 1000 }, async page => {
  await page.waitForFunction(() => /RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""), null, { timeout: 120000 });
  const scenario = await page.locator("#labScenario").innerText();
  const guidance = await page.locator("#labGuidance").innerText();
  expect("IT039 Foundation: correct scenario", /Cross-System Building Incident Response/.test(scenario), scenario);
  expect("IT039 Foundation: SANDBOX boundary visible", /SANDBOX/.test(scenario));
  expect("IT039 Foundation: objectives visible", !/Objectives Hidden by difficulty/.test(guidance), guidance);
  expect("IT039 Foundation: faults visible", !/Fault view Hidden by difficulty/.test(guidance), guidance);
  expect("IT039 Foundation: actions rendered", await page.locator("#labActions button").count() === 8);
  expect("IT039 Foundation: hint available", !(await page.locator("#labHint").isDisabled()));
  const before = guidance.match(/Hints\s+(\d+)\/(\d+)/);
  await page.locator("#labHint").click();
  await page.waitForFunction(() => /Supported hint usage recorded/.test(document.querySelector("#labMessage")?.textContent || ""));
  const afterGuidance = await page.locator("#labGuidance").innerText();
  const after = afterGuidance.match(/Hints\s+(\d+)\/(\d+)/);
  expect("IT039 Foundation: hint budget decrements", !!before && !!after && Number(after[1]) === Number(before[1]) - 1, `${guidance} -> ${afterGuidance}`);
  await page.locator("#labReset").click();
  await page.waitForFunction(() => /CREATED · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""));
  expect("IT039 Foundation: reset returns CREATED", /CREATED · SANDBOX/.test(await page.locator("#labScenario").innerText()));
  expect("IT039 Foundation: reset message confirms canonical baseline", /canonical simulated baseline restored/.test(await page.locator("#labMessage").innerText()));
  await page.locator("#labStart").click();
  await page.waitForFunction(() => /RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""));
  expect("IT039 Foundation: can restart after reset", /RUNNING/.test(await page.locator("#labScenario").innerText()));
});

await pageCase("desktop-it039-expert", LIVE + "?lab=IT-LAB-039&difficulty=EXPERT", { width: 1440, height: 1000 }, async page => {
  await page.waitForFunction(() => /RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""), null, { timeout: 120000 });
  const guidance = await page.locator("#labGuidance").innerText();
  const assessment = await page.locator("#labAssessment").innerText();
  expect("IT039 Expert: objectives hidden", /Objectives Hidden by difficulty/.test(guidance), guidance);
  expect("IT039 Expert: faults hidden", /Fault view Hidden by difficulty/.test(guidance), guidance);
  expect("IT039 Expert: zero hint budget", /Hints 0\/0 remaining/.test(guidance), guidance);
  expect("IT039 Expert: hint button disabled", await page.locator("#labHint").isDisabled());
  expect("IT039 Expert: assessment automation ceiling Demonstrated", /Automation ceiling: Demonstrated/.test(assessment), assessment);
  expect("IT039 Expert: no automated Verified/Applied/Mentor", !/Verified|Applied|Mentor/.test(assessment), assessment);
  const labels = await page.locator("#labActions button").allInnerTexts();
  expect("IT039 Expert: action labels are ID-only", labels.every(x => /^039-[a-z0-9-]+$/i.test(x.trim())), labels.join(" | "));
});

await pageCase("desktop-ops-blocked-stair", LIVE + "?lab=blocked_stair_a&difficulty=FOUNDATION", { width: 1440, height: 1000 }, async page => {
  await page.waitForFunction(() => /RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""), null, { timeout: 120000 });
  const scenario = await page.locator("#labScenario").innerText();
  expect("OPS blocked stair: correct scenario", /Blocked Stair A/.test(scenario), scenario);
  expect("OPS blocked stair: five canonical actions", await page.locator("#labActions button").count() === 5);
  expect("OPS blocked stair: modeled system state present", !/Modeled systems at baseline/.test(await page.locator("#labSystems").innerText()));
});

await pageCase("desktop-public-vita", LIVE + "?lab=EU-PSC-VITA-INTAKE-V1&difficulty=TECHNICIAN", { width: 1440, height: 1000 }, async page => {
  await page.waitForFunction(() => /RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent || ""), null, { timeout: 120000 });
  const scenario = await page.locator("#labScenario").innerText();
  const body = (await page.locator("#labPanel").innerText()).toLowerCase();
  expect("Public VITA: correct scenario", /VITA\/TCE Intake/.test(scenario), scenario);
  expect("Public VITA: public service family visible", /PUBLIC_SERVICE/.test(scenario), scenario);
  expect("Public VITA: seven canonical actions", await page.locator("#labActions button").count() === 7);
  expect("Public VITA: no obvious real PII rendered", !/\b\d{3}-\d{2}-\d{4}\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/i.test(body), body);
});

await pageCase("mobile-normal", LIVE, { width: 390, height: 844 }, async page => {
  expect("mobile: canvas visible", await page.locator("canvas").isVisible());
  expect("mobile: HUD visible", await page.locator(".hud").isVisible());
  await page.locator("#labs").click();
  await page.locator("#labPanel").waitFor({ state: "visible" });
  expect("mobile: lab panel visible", await page.locator("#labPanel").isVisible());
  const box = await page.locator("#labPanel").boundingBox();
  expect("mobile: lab panel stays inside viewport width", !!box && box.x >= 0 && box.x + box.width <= 390.5, JSON.stringify(box));
  expect("mobile: lab panel does not consume entire viewport", !!box && box.height < 844, JSON.stringify(box));
});

await browser.close();

const summary = {
  live_url: LIVE,
  generated_at: new Date().toISOString(),
  checks_total: results.length,
  passed: results.filter(x => x.ok).length,
  failed: results.filter(x => !x.ok).length,
  results,
};
await fs.writeFile(path.join(OUT, "acceptance-results.json"), JSON.stringify(summary, null, 2));
await fs.writeFile(path.join(OUT, "acceptance-summary.md"), [
  "# Equity Uprise live acceptance",
  "",
  `- Target: ${LIVE}`,
  `- Checks: ${summary.checks_total}`,
  `- Passed: ${summary.passed}`,
  `- Failed: ${summary.failed}`,
  "",
  ...results.map(r => `- ${r.ok ? "PASS" : "FAIL"} — ${r.name}${r.detail ? " — " + r.detail : ""}`)
].join("\n"));

if (summary.failed) {
  console.error(`\nLIVE ACCEPTANCE FAILED: ${summary.failed}/${summary.checks_total} checks failed`);
  process.exit(1);
}
console.log(`\nLIVE ACCEPTANCE PASS: ${summary.passed}/${summary.checks_total} checks passed`);
