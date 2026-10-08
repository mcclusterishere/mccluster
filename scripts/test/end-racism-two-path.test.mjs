import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const spec = fs.readFileSync(new URL("../../docs/END-RACISM-TWO-PATH-CAMPAIGN.md", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../../end-racism.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../../css/gateway.css", import.meta.url), "utf8");
const sale = fs.readFileSync(new URL("../../js/end-racism-sale.js", import.meta.url), "utf8");
const recoveryPage = fs.readFileSync(new URL("../../wigger-recovery.html", import.meta.url), "utf8");

test("End Racism declaration remains self-declared satire, never an inferred identity", () => {
  assert.match(spec, /must never assign this status/i);
  assert.match(spec, /Never infer or algorithmically assign/i);
  assert.match(html, /Self-declared satire/);
  assert.match(html, /does not infer or assign either label to your identity/);
  assert.doesNotMatch(sale, /racist\s*[:=]|not.?racist\s*[:=]|declaration|self_declared/i);
});

test("the public gateway is now choose, one-dollar track, act", () => {
  assert.match(html, /I&rsquo;M NOT RACIST/);
  assert.match(html, /I&rsquo;M RACIST/);
  assert.doesNotMatch(html, /NO\.\s*I&rsquo;M RACIST/i);
  assert.match(html, /id="track"/);
  assert.match(html, /Niggy Nigg Niggr/);
  assert.match(html, /GET FULL MP3[\s\S]*\$1/);
  assert.match(html, /id="act"/);
  assert.match(html, /Now do something/);
  assert.match(html, /action\/\?c=end-racism/);
  assert.match(html, /wigger-recovery\.html/);
  assert.doesNotMatch(html, /Act I|Act II|Act III|Act IV|Act V/);
  assert.doesNotMatch(html, /HOMO[\s\S]*SAPIENS/);
});

test("the two declaration cards have equal structure and explicit white/red color semantics", () => {
  assert.match(html, /class="er-choice er-choice--not"/);
  assert.match(html, /class="er-choice er-choice--racist"/);
  assert.match(css, /\.er-choice--not\{background:#f7f4ef;color:#111\}/);
  assert.match(css, /\.er-choice--racist\{background:#c51b1f;color:#fff\}/);
  assert.match(css, /\.er-choice\{[\s\S]*min-height:150px/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("the full track is a fixed $1 server-priced purchase with private fulfillment", () => {
  const migration = fs.readFileSync(new URL("../../supabase/migrations/20261006232625_music_direct_track_sales_v1.sql", import.meta.url), "utf8");
  const checkout = fs.readFileSync(new URL("../../supabase/functions/music-direct-checkout/index.ts", import.meta.url), "utf8");
  const access = fs.readFileSync(new URL("../../supabase/functions/music-direct-access/index.ts", import.meta.url), "utf8");
  assert.match(migration, /'end-racism-niggy-nigg-full'[\s\S]*100,'usd'[\s\S]*'mcc-gated-audio'[\s\S]*'niggy-nigg\/niggy-nigg\.mp3'/);
  assert.match(checkout, /music_direct_offers/);
  assert.match(checkout, /unit_amount:offer\.price_cents/);
  assert.doesNotMatch(checkout, /body\.price|body\.amount|unit_amount:\s*body/);
  assert.match(access, /payment_status!=="paid"/);
  assert.match(access, /createSignedUrl\(offer\.asset_path,900/);
  assert.match(html, /assets\/audio\/niggy-nigg-preview\.mp3/);
  assert.doesNotMatch(html, /mcc-gated-audio|niggy-nigg\/niggy-nigg\.mp3/);
});

test("the purchase is described as support, not as a tax-deductible donation", () => {
  assert.match(html, /music purchase that supports End Racism/i);
  assert.match(html, /not represented as a tax-deductible charitable contribution/i);
});

test("Racist Tax or satire status cannot buy Action reputation or abusive permission", () => {
  assert.match(spec, /buys no exemption, permission, moderation privilege, mission credit, points/i);
  assert.match(spec, /payments award zero Action points and zero mission completions/i);
  assert.match(spec, /No slur permission, harassment waiver, discrimination waiver, or moderation exemption exists/i);
});

test("campaign does not fork the Mission Engine", () => {
  assert.match(spec, /reference the canonical mission\/assignment\/points primitives/i);
  assert.match(spec, /rather than inventing a parallel reward system/i);
});

test("extended recovery lore remains on the recovery surface instead of blocking the gateway", () => {
  assert.match(recoveryPage, /WIGGERS ANONYMOUS/);
  assert.match(recoveryPage, /STOP A WHITE FRIEND FROM FREESTYLING AT THE FUNCTION/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/wiggers-anonymous\.svg/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/freestyle-containment\.svg/);
  assert.match(recoveryPage, /assets\/img\/end-racism\/counter-freestyle\.svg/);
  assert.doesNotMatch(html, /wiggers-anonymous\.svg|freestyle-containment\.svg/);
});

test("Freestyle Containment keeps exactly three authorized staged levels", () => {
  const authorized = recoveryPage.match(/<article class="wrp-level(?:\s[^"]*)?"/g) || [];
  assert.equal(authorized.length, 3);
  assert.match(recoveryPage, /Level 1[\s\S]*TALK HIM DOWN/);
  assert.match(recoveryPage, /Level 2[\s\S]*CONTAIN THE VERSE/);
  assert.match(recoveryPage, /Level 3[\s\S]*COUNTER-WIGGER DEPLOYMENT/);
  assert.match(recoveryPage, /Stage it with friends who are in on the joke/);
  assert.match(recoveryPage, /Do not secretly film or humiliate somebody/);
});

test("Level 4 remains forbidden lore, not a playable escalation", () => {
  assert.match(recoveryPage, /LEVEL 4[\s\S]*TOTAL WIGGER EVENT[\s\S]*NOT AUTHORIZED/);
  assert.match(spec, /Do not expand Level 4 into a normal playable escalation/);
});
