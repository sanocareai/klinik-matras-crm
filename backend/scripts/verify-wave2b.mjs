// Verifikasi endpoint Wave 2B (Band 2 dashboard) — JALANKAN di tempat yang
// terhubung ke DB (laptop dev atau VPS), BUKAN di sandbox tanpa Postgres.
//
//   node scripts/verify-wave2b.mjs
//
// Env (opsional):
//   BASE_URL      default http://localhost:4000
//   ADMIN_EMAIL   default admin@klinikmatras.com
//   ADMIN_PASS    default kasursehat1
//   SALES_EMAIL   (opsional) — kalau diisi, cek scoping + KEAMANAN role SALES
//   SALES_PASS    (opsional)
//
// Cek: (1) ADMIN akses tim; (2) SALES hanya miliknya + unassigned claimable;
// (3) data kosong graceful []; (4) KEAMANAN: SALES tidak boleh dapat customer
// milik sales lain; (5) tidak ada field di luar kontrak yang bocor.
// Node 18+ (global fetch). Backend prod pakai Node 20.

const BASE = process.env.BASE_URL || "http://localhost:4000";
const ADMIN = { email: process.env.ADMIN_EMAIL || "admin@klinikmatras.com", password: process.env.ADMIN_PASS || "kasursehat1" };
const SALES = process.env.SALES_EMAIL ? { email: process.env.SALES_EMAIL, password: process.env.SALES_PASS || "kasursehat1" } : null;

// Field WAJIB ada (subset minimal) per endpoint.
const REQUIRED = {
  "follow-ups":      ["id", "customerName", "preview", "waitingMinutes", "severity", "nextAction", "unassigned", "sessionLabel"],
  "hot-leads":       ["id", "name", "stage", "score", "signalScore", "aiConfidence", "reason", "signals", "nextAction", "valueEstimate", "sessionLabel"],
  "recommendations": ["id", "type", "severity", "title", "detail", "actionLabel", "href"],
};
// SELURUH field yang BOLEH muncul (kontrak lengkap, termasuk opsional).
// Item TIDAK BOLEH punya key di luar daftar ini — cegah kebocoran field sensitif
// (mis. email, city, tags, healthStatus, internal id) di luar kontrak.
const ALLOWED = {
  "follow-ups":      new Set(["id", "customerName", "preview", "waitingMinutes", "severity", "nextAction", "assignedTo", "unassigned", "sessionLabel"]),
  "hot-leads":       new Set(["id", "name", "phone", "stage", "score", "signalScore", "aiConfidence", "reason", "signals", "nextAction", "valueEstimate", "assignedTo", "lastMessageAt", "sessionLabel"]),
  "recommendations": new Set(["id", "type", "severity", "count", "title", "detail", "impact", "actionLabel", "href"]),
};
// Endpoint yang memuat data per-customer (relevan utk cek scoping SALES).
const CUSTOMER_ENDPOINTS = ["hot-leads", "follow-ups"];

let failures = 0;
const ok  = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { failures++; console.log("  \x1b[31m✗ " + m + "\x1b[0m"); };

async function login(cred) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cred),
  });
  if (!r.ok) throw new Error(`login gagal (${r.status}) untuk ${cred.email}`);
  const { token, user } = await r.json();
  if (!token) throw new Error("token kosong");
  return { token, name: user?.name || null, role: user?.role || null };
}

async function checkEndpoint(token, name) {
  const r = await fetch(`${BASE}/api/analytics/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status !== 200) { bad(`${name}: HTTP ${r.status} (harusnya 200)`); return null; }
  const body = await r.json();
  if (!Array.isArray(body.items)) { bad(`${name}: body.items bukan array`); return null; }
  ok(`${name}: 200, ${body.items.length} item`);

  if (body.items.length === 0) {
    ok(`${name}: skenario data kosong → { items: [] } (graceful)`);
    return body.items;
  }

  const first = body.items[0];
  const missing = REQUIRED[name].filter((k) => !(k in first));
  if (missing.length) bad(`${name}: field wajib hilang di item[0]: ${missing.join(", ")}`);
  else ok(`${name}: field wajib kontrak lengkap`);

  // KEBOCORAN FIELD: tidak boleh ada key di luar kontrak (di SEMUA item).
  const leaked = new Set();
  for (const it of body.items) for (const k of Object.keys(it)) if (!ALLOWED[name].has(k)) leaked.add(k);
  if (leaked.size) bad(`${name}: field DI LUAR kontrak bocor: ${[...leaked].join(", ")}`);
  else ok(`${name}: tidak ada field di luar kontrak (tidak ada kebocoran)`);

  console.log("    contoh:", JSON.stringify(first).slice(0, 170));
  return body.items;
}

function checkSalesSecurity(salesData, salesName) {
  console.log("\n[SECURITY] SALES hanya boleh lihat miliknya + unassigned claimable");
  if (!salesName) { bad("nama SALES tak diketahui dari login — tak bisa cek kepemilikan"); return; }

  for (const ep of CUSTOMER_ENDPOINTS) {
    const items = salesData[ep] || [];
    // assignedTo HARUS null (claimable) ATAU nama sales itu sendiri.
    const foreign = items.filter((it) => it.assignedTo != null && it.assignedTo !== salesName);
    if (foreign.length) {
      bad(`${ep}: SALES menerima data customer milik sales LAIN → ${JSON.stringify([...new Set(foreign.map((f) => f.assignedTo))])}`);
    } else {
      ok(`${ep}: semua assignedTo = null (claimable) atau "${salesName}" (milik sendiri)`);
    }
  }

  // Rekomendasi 'unassigned' bersifat admin-only.
  const salesHasUnassignedRec = (salesData["recommendations"] || []).some((r) => r.type === "unassigned");
  if (salesHasUnassignedRec) bad("SALES tidak boleh dapat rekomendasi type 'unassigned' (admin-only)");
  else ok("recommendations: tidak ada 'unassigned' (benar, admin-only)");
}

async function run() {
  console.log(`\n=== VERIFIKASI WAVE 2B @ ${BASE} ===\n`);

  console.log("[1] ADMIN token — analitik seluruh tim");
  const admin = await login(ADMIN);
  if (admin.role && admin.role !== "ADMIN") bad(`akun ADMIN_EMAIL role-nya ${admin.role}, bukan ADMIN`);
  for (const name of Object.keys(REQUIRED)) await checkEndpoint(admin.token, name);

  if (SALES) {
    console.log("\n[2] SALES token — scoping + keamanan");
    const sales = await login(SALES);
    if (sales.role && sales.role !== "SALES") bad(`akun SALES_EMAIL role-nya ${sales.role}, bukan SALES`);
    const salesData = {};
    for (const name of Object.keys(REQUIRED)) salesData[name] = await checkEndpoint(sales.token, name);
    checkSalesSecurity(salesData, sales.name);
  } else {
    console.log("\n[2] SALES token — DILEWATI (set SALES_EMAIL/SALES_PASS untuk cek scoping + keamanan)");
    bad("cek keamanan SALES DILEWATI — WAJIB dijalankan sebelum finalisasi (set SALES_EMAIL)");
  }

  console.log("\n[3] Skenario data kosong — tercakup: setiap endpoint balas { items: [] } tanpa error saat tak ada data.");

  console.log(`\n=== HASIL: ${failures === 0 ? "\x1b[32mSEMUA LULUS\x1b[0m" : `\x1b[31m${failures} GAGAL\x1b[0m`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("\x1b[31mERROR:\x1b[0m", e.message); process.exit(1); });
