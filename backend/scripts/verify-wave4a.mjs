// Verifikasi Wave 4A (Intelligence Engine API) — JALANKAN di tempat yang
// terhubung ke DB (dev/VPS), BUKAN sandbox tanpa Postgres.
//
//   SALES_EMAIL=risel@klinikmatras.com SALES_PASS=kasursehat1 node scripts/verify-wave4a.mjs
//
// Cek: kontrak API · rentang skor 0–100 · reasons/signals ada · tanpa kebocoran
// field · akses ADMIN/SALES · customer tak boleh → 403 · output konsisten (deterministik).

const BASE = process.env.BASE_URL || "http://localhost:4000";
const ADMIN = { email: process.env.ADMIN_EMAIL || "admin@klinikmatras.com", password: process.env.ADMIN_PASS || "kasursehat1" };
const SALES = process.env.SALES_EMAIL ? { email: process.env.SALES_EMAIL, password: process.env.SALES_PASS || "kasursehat1" } : null;

const ALLOWED = {
  priority:    new Set(["id", "name", "phone", "priorityScore", "reasons", "recommendedAction", "urgency", "stage", "assignedTo", "sessionLabel"]),
  opportunity: new Set(["id", "name", "phone", "opportunityScore", "signals", "stage", "valueEstimate", "assignedTo", "sessionLabel"]),
  customer:    new Set(["health", "priority", "opportunity", "nextAction", "insight", "signals", "meta"]),
};

let failures = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { failures++; console.log("  \x1b[31m✗ " + m + "\x1b[0m"); };
const inRange = (n) => Number.isInteger(n) && n >= 0 && n <= 100;

async function login(cred) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cred) });
  if (!r.ok) throw new Error(`login gagal (${r.status}) untuk ${cred.email}`);
  const { token, user } = await r.json();
  return { token, name: user?.name || null, id: user?.id || null, role: user?.role || null };
}
const get = (token, path) => fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });

function checkList(name, body, kind) {
  if (!Array.isArray(body.items)) { bad(`${name}: items bukan array`); return []; }
  ok(`${name}: 200, ${body.items.length} item`);
  for (const it of body.items) {
    const leak = Object.keys(it).filter((k) => !ALLOWED[kind].has(k));
    if (leak.length) { bad(`${name}: field bocor: ${leak.join(", ")}`); break; }
    const score = kind === "priority" ? it.priorityScore : it.opportunityScore;
    if (!inRange(score)) { bad(`${name}: skor di luar 0–100: ${score}`); break; }
    const arr = kind === "priority" ? it.reasons : it.signals;
    if (!Array.isArray(arr)) { bad(`${name}: reasons/signals bukan array`); break; }
  }
  if (body.items.length) ok(`${name}: field OK, skor 0–100, reasons/signals array`);
  return body.items;
}

async function run() {
  console.log(`\n=== VERIFIKASI WAVE 4A @ ${BASE} ===\n`);

  console.log("[1] ADMIN — daftar intelligence (tim)");
  const admin = await login(ADMIN);
  const aPri = checkList("priority", await (await get(admin.token, "/api/intelligence/priority")).json(), "priority");
  checkList("opportunities", await (await get(admin.token, "/api/intelligence/opportunities")).json(), "opportunity");

  console.log("\n[2] Per-customer intelligence + konsistensi (deterministik)");
  const sampleId = aPri[0]?.id;
  if (!sampleId) {
    console.log("  (lewati — tak ada customer priority untuk diuji; data mungkin kosong)");
  } else {
    const r1 = await get(admin.token, `/api/customers/${sampleId}/intelligence`);
    if (r1.status !== 200) bad(`customer intelligence: HTTP ${r1.status}`);
    else {
      const b1 = await r1.json();
      const leak = Object.keys(b1).filter((k) => !ALLOWED.customer.has(k));
      if (leak.length) bad(`customer intelligence: field bocor: ${leak.join(", ")}`);
      else ok("customer intelligence: field top-level sesuai kontrak");
      const scores = [b1.health?.score, b1.priority?.score, b1.opportunity?.score];
      if (scores.every(inRange)) ok(`skor 0–100: health=${scores[0]} priority=${scores[1]} opportunity=${scores[2]}`);
      else bad(`skor di luar 0–100: ${JSON.stringify(scores)}`);
      if (Array.isArray(b1.priority?.reasons) && Array.isArray(b1.opportunity?.signals) && typeof b1.insight === "string") ok("reasons/signals/insight ada");
      else bad("reasons/signals/insight tidak lengkap");
      if (b1.meta?.engineVersion) ok(`trace engineVersion: ${b1.meta.engineVersion}`);
      // konsistensi
      const b2 = await (await get(admin.token, `/api/customers/${sampleId}/intelligence`)).json();
      if (b1.health.score === b2.health.score && b1.priority.score === b2.priority.score && b1.opportunity.score === b2.opportunity.score)
        ok("konsisten (2 panggilan → skor sama, deterministik)");
      else bad("output TIDAK konsisten antar panggilan");
    }
  }

  if (SALES) {
    console.log("\n[3] SALES — scoping + akses");
    const sales = await login(SALES);
    const sPri = checkList("priority(SALES)", await (await get(sales.token, "/api/intelligence/priority")).json(), "priority");
    const foreignAssigned = sPri.filter((x) => x.assignedTo && x.assignedTo !== sales.name);
    if (foreignAssigned.length) bad(`SALES priority berisi customer sales lain: ${[...new Set(foreignAssigned.map((f) => f.assignedTo))]}`);
    else ok("SALES priority: hanya milik sendiri / belum diambil");

    // 403: cari (dari daftar ADMIN) customer yang di-assign ke sales LAIN
    const foreign = aPri.find((x) => x.assignedTo && x.assignedTo !== sales.name);
    if (foreign) {
      const r = await get(sales.token, `/api/customers/${foreign.id}/intelligence`);
      if (r.status === 403) ok(`customer tak boleh diakses SALES → 403 (${foreign.assignedTo})`);
      else bad(`SALES akses customer sales lain: HTTP ${r.status} (harusnya 403)`);
    } else {
      console.log("  (lewati cek 403 — tak ada customer ter-assign ke sales lain di sampel)");
    }
    // 200: customer yang boleh (dari daftar SALES sendiri)
    const mine = sPri[0]?.id;
    if (mine) {
      const r = await get(sales.token, `/api/customers/${mine}/intelligence`);
      if (r.status === 200) ok("customer yang boleh diakses SALES → 200");
      else bad(`SALES akses customer sendiri: HTTP ${r.status} (harusnya 200)`);
    }
  } else {
    bad("SALES DILEWATI — WAJIB untuk cek scoping + 403 (set SALES_EMAIL)");
  }

  console.log(`\n=== HASIL: ${failures === 0 ? "\x1b[32mSEMUA LULUS\x1b[0m" : `\x1b[31m${failures} GAGAL\x1b[0m`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("\x1b[31mERROR:\x1b[0m", e.message); process.exit(1); });
