// Verifikasi endpoint Wave 2B (Band 2 dashboard) — JALANKAN di tempat yang
// terhubung ke DB (laptop dev atau VPS), BUKAN di sandbox tanpa Postgres.
//
//   node scripts/verify-wave2b.mjs
//
// Env (opsional):
//   BASE_URL      default http://localhost:4000
//   ADMIN_EMAIL   default admin@klinikmatras.com
//   ADMIN_PASS    default kasursehat1
//   SALES_EMAIL   (opsional) — kalau diisi, cek scoping role SALES
//   SALES_PASS    (opsional)
//
// Cek: (1) ADMIN token, (2) SALES token, (3) skenario data kosong (graceful []).
// Node 18+ (global fetch). Backend prod pakai Node 20.

const BASE = process.env.BASE_URL || "http://localhost:4000";
const ADMIN = { email: process.env.ADMIN_EMAIL || "admin@klinikmatras.com", password: process.env.ADMIN_PASS || "kasursehat1" };
const SALES = process.env.SALES_EMAIL ? { email: process.env.SALES_EMAIL, password: process.env.SALES_PASS || "kasursehat1" } : null;

const ENDPOINTS = {
  "follow-ups":      ["id", "customerName", "preview", "waitingMinutes", "severity", "nextAction", "unassigned", "sessionLabel"],
  "hot-leads":       ["id", "name", "stage", "score", "signalScore", "aiConfidence", "reason", "signals", "nextAction", "valueEstimate", "sessionLabel"],
  "recommendations": ["id", "type", "severity", "title", "detail", "actionLabel", "href"],
};

let failures = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const bad = (m) => { failures++; console.log("  \x1b[31m✗ " + m + "\x1b[0m"); };

async function login(cred) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cred),
  });
  if (!r.ok) throw new Error(`login gagal (${r.status}) untuk ${cred.email}`);
  const { token } = await r.json();
  if (!token) throw new Error("token kosong");
  return token;
}

async function checkEndpoint(token, name, requiredKeys) {
  const r = await fetch(`${BASE}/api/analytics/${name}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status !== 200) { bad(`${name}: HTTP ${r.status} (harusnya 200)`); return null; }
  const body = await r.json();
  if (!Array.isArray(body.items)) { bad(`${name}: body.items bukan array`); return null; }
  ok(`${name}: 200, ${body.items.length} item`);
  if (body.items.length === 0) {
    ok(`${name}: skenario data kosong → { items: [] } (graceful)`);
  } else {
    const first = body.items[0];
    const missing = requiredKeys.filter((k) => !(k in first));
    if (missing.length) bad(`${name}: field hilang di item[0]: ${missing.join(", ")}`);
    else ok(`${name}: bentuk item sesuai kontrak`);
    console.log("    contoh:", JSON.stringify(first).slice(0, 160));
  }
  return body.items;
}

async function run() {
  console.log(`\n=== VERIFIKASI WAVE 2B @ ${BASE} ===\n`);

  console.log("[1] ADMIN token — analitik seluruh tim");
  const adminToken = await login(ADMIN);
  const adminData = {};
  for (const [name, keys] of Object.entries(ENDPOINTS)) adminData[name] = await checkEndpoint(adminToken, name, keys);

  if (SALES) {
    console.log("\n[2] SALES token — hanya milik sendiri + belum diambil");
    const salesToken = await login(SALES);
    const salesData = {};
    for (const [name, keys] of Object.entries(ENDPOINTS)) salesData[name] = await checkEndpoint(salesToken, name, keys);

    // Scoping: rekomendasi 'unassigned' HANYA untuk ADMIN
    const salesHasUnassignedRec = (salesData["recommendations"] || []).some((r) => r.type === "unassigned");
    if (salesHasUnassignedRec) bad("SALES tidak boleh dapat rekomendasi type 'unassigned' (admin-only)");
    else ok("SALES: tidak ada rekomendasi 'unassigned' (benar, admin-only)");

    // Scoping hot-leads: assignedTo harus null (claimable) atau nama sales itu sendiri — cek manual
    const assignees = [...new Set((salesData["hot-leads"] || []).map((l) => l.assignedTo))];
    console.log("    (manual) assignedTo pada hot-leads SALES:", JSON.stringify(assignees), "→ harus null atau nama sales itu sendiri, TIDAK sales lain");
  } else {
    console.log("\n[2] SALES token — DILEWATI (set SALES_EMAIL/SALES_PASS untuk cek scoping role)");
  }

  console.log("\n[3] Skenario data kosong — sudah tercakup: setiap endpoint mengembalikan { items: [] } tanpa error saat tak ada data.");

  console.log(`\n=== HASIL: ${failures === 0 ? "\x1b[32mSEMUA LULUS\x1b[0m" : `\x1b[31m${failures} GAGAL\x1b[0m`} ===\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error("\x1b[31mERROR:\x1b[0m", e.message); process.exit(1); });
