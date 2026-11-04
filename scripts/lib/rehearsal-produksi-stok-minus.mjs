import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-produksi-stok-minus.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji pengecualian stok hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "Pengecualian stok tidak cukup + satuan pakai LIST WIBING": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4102, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Bagian A-C hanya membaca. Bagian D MENULIS — HANYA pada salinan restore (DB rehearsal_*, dibuang sesudahnya, dijaga di atas): pengecualian dipakai pada data nyata dan dibuktikan satu ISSUE, saldo, audit, idempotensi, penolakan tanpa izin/alasan/konfirmasi.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4102); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of semua) info.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const pembaca = info.find((x) => bisa(x.rs, P.UNIT_READ) && (bisa(x.rs, P.FINANCE_READ) || bisa(x.rs, P.UNIT_MATERIAL_WRITE)))?.u ?? await prisma.user.create({ data: { name: "REH Pembaca", email: `reh-psm-r-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
cek("akun uji berizin harga tersedia", !!pembaca);
const tP = await token(pembaca);
const get = async (url, tok = tP) => { const t0 = process.hrtime.bigint(); const r = await fetch(BASE + url, { headers: tok ? { Authorization: "Bearer " + tok } : {} }); let j = null; try { if (/json/.test(r.headers.get("content-type") ?? "")) j = await r.json(); else await r.arrayBuffer(); } catch { /* bukan JSON */ } return { status: r.status, json: j, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const C = "/api/production/material-catalog";
const TABEL = ["stock_movements", "stock_movement_biaya_operasional", "material_harga_berlaku", "material_issues", "fin_journal_entries", "units", "unit_material_declarations", "production_runs_v2", "unit_custody_handoffs_v2", "production_unit_work_progress"];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await num(`select count(*)::int n from ${t}`)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const j0 = await jejak();

// ── A. bentuk lama utuh (aditif) ──
const k = await get(`${C}?limit=80`);
cek("katalog: 200, bentuk lama utuh (total, kelompok, rows, catatan) + harga + satuanPakai per baris (aditif)", k.status === 200 && typeof k.json.total === "number" && Array.isArray(k.json.kelompok) && Array.isArray(k.json.rows) && typeof k.json.catatan === "string" && k.json.rows.every((r) => "harga" in r && "satuanPakai" in r), `${k.status}`);
// ── B. WAKTU RESPONS ──
const ukur = async (nama, url, batas, n3 = 3) => { const t = []; let st = 0; for (let i = 0; i < n3; i++) { const r = await get(url); st = r.status; t.push(r.ms); } const h = t.slice(1).sort((a, b) => a - b);
  console.log(`WAKTU ${nama.padEnd(60)} dingin=${String(Math.round(t[0])).padStart(5)} ms | hangat p50=${String(Math.round(h[Math.floor(h.length / 2)])).padStart(5)} ms maks=${String(Math.round(Math.max(...h))).padStart(5)} ms`);
  cek(`waktu ${nama} di bawah batas ${batas} ms (maks ${Math.round(Math.max(...t))} ms)`, st === 200 && Math.max(...t) < batas); };
await ukur("katalog bahan (limit 60, pemilih)", `${C}?limit=60`, 10000);
await ukur("katalog bahan (limit 300, seluruh katalog)", `${C}?limit=300`, 15000);
await ukur("aturan satuan pakai", "/api/production/satuan-pakai", 5000);
cek("endpoint baca tidak mengubah stok, biaya beku, harga, Material Issue, jurnal, unit, pernyataan, run, custody, status kerja", sama(await jejak(), j0));

// ── C. kode SMOKE pasca-switch yang sama dijalankan terhadap server rehearsal: salah harapan terdeteksi SEBELUM deploy
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));
// ── D. UJI TULIS pada SALINAN RESTORE (DB rehearsal_*): pengecualian stok tidak cukup + satuan pakai, DATA NYATA ──
const post = async (url, body, tok, kunci = null) => { const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, ...(kunci ? { "Idempotency-Key": kunci } : {}) }, body: JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch { /* kosong */ } return { status: r.status, json: j }; };
const baris = async (q, ...a) => prisma.$queryRawUnsafe(q, ...a);
const mgr = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Pengelola", email: `reh-psm-m-${stamp}@example.test`, passwordHash: "x", role: "PRODUCTION_LEAD" } });
const opr = info.find((x) => bisa(x.rs, P.UNIT_MATERIAL_WRITE) && !bisa(x.rs, P.UNIT_ROUTING_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Operator", email: `reh-psm-o-${stamp}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
const tM = await token(mgr); const tO = await token(opr);
const unit = (await baris("select id::text id from units where status = 'DELIVERED' order by created_at desc limit 1"))[0];
const mat = (await baris("select m.id::text id, m.code, coalesce(sum(sm.qty),0)::float saldo, count(sm.id)::int n from materials m join stock_movements sm on sm.material_id = m.id where m.code like 'LIST-WIBING%' and m.unit = 'ROLL' and m.active group by m.id, m.code order by m.code limit 1"))[0];
cek("data nyata tersedia: unit TERKIRIM dan bahan LIST-WIBING (ROLL) ber-ledger", !!unit && !!mat, JSON.stringify({ unit: !!unit, mat: mat?.code }));
if (unit && mat) {
  const wib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); const faktor = 90; const meter = Math.round((Math.max(mat.saldo, 0) + 2) * faktor * 10) / 10; const qtyStok = Math.round((meter / faktor) * 10000) / 10000;
  const saldoDb = async () => Number((await baris("select coalesce(sum(qty),0)::float s from stock_movements where material_id = $1::uuid", mat.id))[0].s);
  const tipe = async () => Object.fromEntries((await baris("select type, count(*)::int n from stock_movements group by type")).map((r) => [r.type, r.n]));
  const dasar = { materialId: mat.id, jenis: "TAMBAH", qty: meter, satuan: "METER", tanggalPemakaian: wib };
  const pra = await post(`/api/production/units/${unit.id}/pembetulan-bahan/pratinjau`, { ...dasar, pengecualianStokTidakCukup: true }, tM); const pj = pra.json;
  if (pj?.pengecualianStok?.bisa !== true) { console.log("INFO  pengecualian tidak berlaku pada tanggal uji (melintasi acuan opname/persediaan awal): " + String(pj?.pengecualianStok?.sebabTidakBisa).slice(0, 200)); cek("tanggal uji hari ini melintasi cutoff — bagian D dilewati secara sadar (aturan cutoff terbukti memblokir)", pj?.boleh === false); }
  else {
    const tipe0 = await tipe(); const saldo0 = await saldoDb(); const ev0 = await num("select count(*)::int n from activity_events where event_type = 'PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI'");
    const badan = { materialId: mat.id, qty: meter, satuan: "METER", alasanPembetulan: "Uji rehearsal: pemakaian lama terlewat dicatat", tanggalPemakaian: wib, saldoDilihat: pj.stok.saldoDilihat, hppSidik: pj.hppOperasional?.sidik, ...(pj.sudahTercatat?.perluKonfirmasi ? { konfirmasiBukanGanda: true } : {}) };
    const EX = { pengecualianStokTidakCukup: true, alasanPengecualianStok: "Pemakaian lama belum tercatat; saldo dibereskan lewat opname", konfirmasiSaldoMinus: true };
    const U = `/api/units/${unit.id}/materials`; const kunci = `reh-psm-${stamp}-1234567890`;
    const t1 = await post(U, badan, tM, `${kunci}-a`); cek("TANPA pengecualian: stok tidak cukup DITOLAK (400) dan saldo tidak berubah", t1.status === 400 && /tidak cukup/i.test(t1.json?.error ?? "") && (await saldoDb()) === saldo0, `${t1.status} ${t1.json?.error}`);
    const t2 = await post(U, { ...badan, ...EX }, tO, `${kunci}-b`); cek("operator lantai (tanpa izin pengelola): 403 PENGECUALIAN_STOK_TANPA_IZIN, saldo tidak berubah", t2.status === 403 && t2.json?.code === "PENGECUALIAN_STOK_TANPA_IZIN" && (await saldoDb()) === saldo0, `${t2.status} ${t2.json?.code}`);
    const t3 = await post(U, { ...badan, ...EX, alasanPengecualianStok: "habis" }, tM, `${kunci}-c`); cek("pengelola tanpa alasan layak: 400 PENGECUALIAN_STOK_ALASAN_WAJIB", t3.status === 400 && t3.json?.code === "PENGECUALIAN_STOK_ALASAN_WAJIB" && (await saldoDb()) === saldo0, `${t3.status} ${t3.json?.code}`);
    const t4 = await post(U, { ...badan, ...EX, konfirmasiSaldoMinus: false }, tM, `${kunci}-d`); cek("pengelola tanpa konfirmasi eksplisit: 400 PENGECUALIAN_STOK_KONFIRMASI_WAJIB", t4.status === 400 && t4.json?.code === "PENGECUALIAN_STOK_KONFIRMASI_WAJIB" && (await saldoDb()) === saldo0, `${t4.status} ${t4.json?.code}`);
    const t5 = await post(U, { ...badan, alasanPengecualianStok: EX.alasanPengecualianStok, konfirmasiSaldoMinus: true }, tM, `${kunci}-e`); cek("alasan + konfirmasi TANPA memilih pengecualian: tetap ditolak (aturan stok berlaku)", t5.status === 400 && (await saldoDb()) === saldo0, `${t5.status}`);
    const ok = await post(U, { ...badan, ...EX }, tM, `${kunci}-ok`); const saldo1 = await saldoDb(); const tipe1 = await tipe();
    cek("DENGAN pengecualian: 201 dan saldo turun TEPAT sebesar jumlah stok (meter ÷ 90, 4 desimal)", ok.status === 201 && Math.abs(saldo1 - (saldo0 - qtyStok)) < 0.0002, `${ok.status} ${saldo0} → ${saldo1} (diharapkan ${Math.round((saldo0 - qtyStok) * 10000) / 10000}) ${ok.json?.error ?? ""}`);
    cek("tepat SATU ISSUE baru; tidak ada RECEIPT/ADJUSTMENT/RETURN/TRANSFER otomatis", (tipe1.ISSUE ?? 0) - (tipe0.ISSUE ?? 0) === 1 && ["RECEIPT", "ADJUSTMENT", "RETURN", "TRANSFER"].every((tp) => (tipe1[tp] ?? 0) === (tipe0[tp] ?? 0)), JSON.stringify({ a: tipe0, b: tipe1 }));
    const mv = ok.json?.id ? (await baris("select type, qty::float q, unit_id::text u, reason, note from stock_movements where id = $1::uuid", ok.json.id))[0] : null;
    cek("pergerakan: ISSUE bertaut ke unit, jumlah negatif dalam ROLL, alasan pengecualian + jumlah yang diketik tercatat, tanggal dilaporkan terpisah dari waktu pencatatan", !!mv && mv.type === "ISSUE" && mv.u === unit.id && Math.abs(mv.q + qtyStok) < 0.00006 && /^Pengecualian stok tidak cukup/.test(mv.reason ?? "") && (mv.note ?? "").includes("[pakai ") && (mv.note ?? "").includes(`[dilaporkan ${wib}]`), JSON.stringify(mv)?.slice(0, 260));
    const ev = (await baris("select actor_id::text actor_id, metadata from activity_events where event_type = 'PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI' order by created_at desc limit 1"))[0]; const pe = ev?.metadata?.pengecualianStokTidakCukup;
    cek("audit: pelaku, alasan, tanggal pemakaian, saldo sebelum→sesudah, dan 'dipakai=true' tercatat; tepat satu peristiwa baru", (await num("select count(*)::int n from activity_events where event_type = 'PRODUCTION_PEMBETULAN_BAHAN_UNIT_SELESAI'")) - ev0 === 1 && ev?.actor_id === mgr.id && pe?.dipakai === true && pe?.alasan === EX.alasanPengecualianStok && pe?.tanggalPemakaian === wib && Math.abs(pe?.saldoSebelum - saldo0) < 0.0002, JSON.stringify(pe)?.slice(0, 260));
    const op = (await baris("select status from stock_movement_biaya_operasional where movement_id = $1::uuid limit 1", ok.json?.id))[0]; cek("HPP operasional dibekukan sekali mengikuti aturan harga (DINILAI atau TANPA_HARGA — tidak diisi karangan)", !!op && ["DINILAI", "TANPA_HARGA"].includes(op.status), op?.status);
    const ulang = await post(U, { ...badan, ...EX }, tM, `${kunci}-ok`); cek("retry/klik ganda (kunci sama): tidak membuat pergerakan kedua", [200, 201].includes(ulang.status) && (await saldoDb()) === saldo1 && ((await tipe()).ISSUE ?? 0) === (tipe1.ISSUE ?? 0), `${ulang.status}`);
    const beda = await post(U, { ...badan, ...EX, alasanPengecualianStok: "Alasan lain yang sengaja berbeda dari yang pertama" }, tM, `${kunci}-ok`); cek("kunci sama dengan isi berbeda ditolak (409)", beda.status === 409 && (await saldoDb()) === saldo1, `${beda.status}`);
  }
}

berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
