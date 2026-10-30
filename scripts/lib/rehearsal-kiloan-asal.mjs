import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-kiloan-asal.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji D1/KILOAN hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "KILOAN asal + D1": kode BARU dijalankan sebagai SERVER sungguhan (index.js, port 4101, tanpa job latar, variabel eksternal dinetralkan) terhadap SALINAN RESTORE production.
// Semua tulisan (HANYA koreksi D1) ada di DB sementara ini. Pada salinan inilah catatan KILOAN nyata (BUKAN_STOK) dikoreksi lewat HTTP; tabel lain harus identik apa pun yang dilakukan uji.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4101); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const token = async (u) => jwt.sign({ id: u.id, name: u.name, role: u.role, roles: [...(await rolesDari(u))] }, process.env.JWT_SECRET, { expiresIn: "25m" });
const pakai = async (u, m, p, body, kunci) => { const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await token(u)), ...(kunci ? { "Idempotency-Key": kunci } : {}) }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch { /* bukan JSON */ } return { status: r.status, json: j }; };
const users = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const info = []; for (const u of users) info.push({ u, rs: await rolesDari(u) });
const pemberiIzin = info.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u; const adminBiasa = info.find((x) => bisa(x.rs, P.INVENTORY_WRITE) && !bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE))?.u; const tanpaBaca = info.find((x) => !bisa(x.rs, P.INVENTORY_READ))?.u;
cek("akun pemberi izin persetujuan (OWNER/FINANCE) tersedia di salinan", !!pemberiIzin); if (!pemberiIzin) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const R = "/api/production/catatan-historis/koreksi-kiloan";
const SQL_MD5 = (t, kunci = "id") => `select coalesce(md5(string_agg(x::text, '|' order by x.${kunci}::text)), '-') as n from ${t} x`;
const strN = async (q, ...a) => String((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const TABEL = ["stock_movements", "fin_journal_entries", "fin_journal_lines", "fin_stock_movement_valuations", "material_harga_berlaku", "materials", "material_issues", "fin_inventory_openings", "goods_receipts", "fin_purchases", "stock_movement_biaya_operasional", "units", '"Order"'];
const sidikLain = async () => Object.fromEntries(await Promise.all(TABEL.map(async (t) => [t, await strN(SQL_MD5(t))])));
const ids = (await prisma.$queryRawUnsafe("select id::text id from unit_usage_notes where origin = 'EXCEL' and state = 'BUKAN_STOK' and raw_name ~* 'kiloan' and raw_name !~* '\\mlama\\M|buang kasur' order by source_row, id")).map((r) => r.id);
const N0 = ids.length; console.log(`INFO catatan KILOAN BUKAN_STOK (kandidat D1) pada salinan: ${N0}`);
const dalam = (arr) => (arr.length ? arr.map((x) => `'${x}'`).join(",") : "'00000000-0000-0000-0000-000000000000'");
const sidikCatatanTarget = () => strN(`select coalesce(md5(string_agg(n::text, '|' order by n.id::text)), '-') as n from unit_usage_notes n where n.id in (${dalam(ids)})`);
const sidikCatatanLain = () => strN(`select coalesce(md5(string_agg(n::text, '|' order by n.id::text)), '-') as n from unit_usage_notes n where n.id not in (${dalam(ids)})`);
const rawTarget = () => strN(`select coalesce(md5(string_agg(concat_ws('|', n.id, n.raw_name, n.raw_spec, n.raw_qty, n.raw_uom, n.raw_category, n.raw_date, n.raw_price, n.raw_total, n.raw_row::text, n.source_key, n.source_row, n.order_number, n.qty, n.uom, n.used_at), E'\\n' order by n.id::text)), '-') as n from unit_usage_notes n where n.id in (${dalam(ids)})`);

// ── A. smoke pasca-switch (kode yang sama dengan fase 8b) pada KEADAAN AWAL: D1 belum dijalankan, tidak ada yang berubah
const tidakSeimbang = await num("select count(*)::int n from (select e.id from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id group by e.id having sum(l.debit) <> sum(l.credit)) x");
const smk = async () => spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 240000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP, BASE_TIDAK_SEIMBANG: String(tidakSeimbang), ORDER_N: String(0), JOB_N: String(0), BASE_KILOAN_N: String(await num("select count(*)::int n from unit_usage_notes where origin = 'EXCEL' and state = 'BUKAN_STOK' and raw_name ~* 'kiloan'")), BASE_KILOAN_DIKOREKSI: String(await num("select count(*)::int n from unit_usage_note_events e join unit_usage_notes n on n.id = e.note_id where n.raw_name ~* 'kiloan' and e.kind = 'DIKOREKSI'")) } });
const sm = await smk(); const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap server rehearsal pada keadaan awal: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. DEPLOY KODE SAJA TIDAK MENGOREKSI: server baru sudah hidup dan melayani pembacaan; keenam belas catatan tetap BUKAN_STOK tanpa peristiwa baru
const tgt0 = await sidikCatatanTarget(); const ev0 = await num(`select count(*)::int n from unit_usage_note_events where note_id in (${dalam(ids)})`);
const unitIds = (await prisma.$queryRawUnsafe(`select distinct unit_id::text id from unit_usage_notes where id in (${dalam(ids)}) and unit_id is not null`)).map((r) => r.id);
for (const uid of unitIds.slice(0, 20)) await pakai(pemberiIzin, "GET", `/api/production/units/${uid}/catatan-historis`);
const svc = await imp("src/services/catatanPemakaianHistoris.js"); svc.resetKeadaanEfektif(); await svc.keadaanEfektif(prisma);
cek(`deploy kode saja TIDAK mengoreksi: ${N0} catatan KILOAN tetap BUKAN_STOK, tanpa peristiwa baru, setelah server hidup + pembacaan catatan unit + keadaan efektif`, (await sidikCatatanTarget()) === tgt0 && (await num(`select count(*)::int n from unit_usage_note_events where note_id in (${dalam(ids)})`)) === ev0);

if (N0 === 0) { console.log("SKIP uji D1 (tidak ada catatan KILOAN BUKAN_STOK pada salinan)"); }
else {
  // ── C. izin dan pratinjau (baca-saja)
  if (tanpaBaca) cek("akun tanpa izin baca inventori: pratinjau D1 = 403", (await pakai(tanpaBaca, "GET", `${R}/pratinjau`)).status === 403); else console.log("SKIP izin tanpa-baca: tidak ada akun contoh");
  if (adminBiasa) cek("ADMIN biasa (tanpa izin persetujuan): terapkan D1 = 403 dan tidak menulis", (await pakai(adminBiasa, "POST", `${R}/terapkan`, { manifest: [{ id: ids[0], sidik: "0".repeat(64) }], alasan: "uji izin tanpa persetujuan" }, "reh-kla-izin-0001")).status === 403 && (await sidikCatatanTarget()) === tgt0); else console.log("SKIP izin ADMIN biasa: tidak ada akun contoh");
  cek("tanpa Idempotency-Key: terapkan D1 = 428", (await pakai(pemberiIzin, "POST", `${R}/terapkan`, { manifest: [{ id: ids[0], sidik: "0".repeat(64) }], alasan: "uji tanpa kunci idempotensi" })).status === 428);
  const pv = await pakai(pemberiIzin, "GET", `${R}/pratinjau`); const jum = pv.json?.manifest?.length ?? -1;
  cek(`pratinjau D1: ${N0} catatan (id + keadaan awal + sidik), semuanya layak, total KG = jumlah SQL`, pv.status === 200 && jum === N0 && pv.json.layak === N0 && pv.json.manifest.every((m) => m.keadaanAwal.state === "BUKAN_STOK" && JSON.stringify(m.keadaanAwal.peristiwa) === '["IMPOR"]' && /^[0-9a-f]{64}$/.test(m.sidik)) && Math.abs(pv.json.totalQty - Number(await strN(`select coalesce(sum(qty),0)::float8 as n from unit_usage_notes where id in (${dalam(ids)})`))) < 1e-6, `${pv.status} jumlah=${jum} layak=${pv.json?.layak} totalQty=${pv.json?.totalQty}`);
  cek("pratinjau tidak menulis: catatan sasaran identik", (await sidikCatatanTarget()) === tgt0);
  const manifest = (pv.json?.manifest ?? []).map((m) => ({ id: m.id, sidik: m.sidik }));
  // ── D. penahanan: sidik palsu / id tak dikenal = ditahan, tidak menulis
  const tp = await pakai(pemberiIzin, "POST", `${R}/terapkan`, { manifest: [{ id: ids[0], sidik: "f".repeat(64) }, { id: "00000000-0000-4000-8000-000000000000", sidik: "f".repeat(64) }], alasan: "uji penahanan sidik palsu dan id tak dikenal" }, "reh-kla-tahan-0001");
  cek("manifest dengan sidik palsu / id tak dikenal: DITAHAN seluruhnya, tidak ada yang berubah", tp.status === 200 && tp.json?.ringkas?.dikoreksi === 0 && tp.json?.ringkas?.ditahan === 2 && (await sidikCatatanTarget()) === tgt0, JSON.stringify(tp.json?.ringkas));
  // ── E. terapkan D1 pada salinan
  const S = await sidikLain(); const lain0 = await sidikCatatanLain(); const raw0 = await rawTarget(); const evAll0 = await num("select count(*)::int n from unit_usage_note_events");
  const alasan = "Uji rehearsal D1: KILOAN bukan penanda komponen lama; bahan dibeli per kg"; const kunci = "reh-kla-d1-0001";
  const ap = await pakai(pemberiIzin, "POST", `${R}/terapkan`, { manifest, alasan }, kunci);
  cek(`terapkan D1: ${N0} catatan dikoreksi (201), 0 ditahan`, ap.status === 201 && ap.json?.ringkas?.dikoreksi === N0 && ap.json?.ringkas?.ditahan === 0, `${ap.status} ${JSON.stringify(ap.json?.ringkas)} ${JSON.stringify(ap.json?.ditahan ?? [])}`);
  cek("semua catatan sasaran kini PERLU_DICEK dengan penanda NAMA_TIDAK_DI_KATALOG + tepat SATU penanda asal (bukti pembelian tertulis ATAU asal perlu dicek); tanpa bahan/pergerakan stok", (await num(`select count(*)::int n from unit_usage_notes where id in (${dalam(ids)}) and state = 'PERLU_DICEK' and material_id is null and stock_movement_id is null and (flags @> '[{"kode":"NAMA_TIDAK_DI_KATALOG"}]') and ((flags @> '[{"kode":"ASAL_PEMBELIAN_BERTULIS"}]')::int + (flags @> '[{"kode":"ASAL_BAHAN_PERLU_DICEK"}]')::int) = 1`)) === N0);
  const adaBukti = await num(`select count(*)::int n from unit_usage_notes where id in (${dalam(ids)}) and flags @> '[{"kode":"ASAL_PEMBELIAN_BERTULIS"}]'`);
  const sqlBukti = await num(`select count(*)::int n from unit_usage_notes u where u.id in (${dalam(ids)}) and exists (select 1 from fin_purchases p where p.description ilike '%kiloan%' and p.description ~* 'memory' and p.description ~* 'foam' and p.date <= u.used_at + interval '1 day')`);
  cek(`penanda asal sesuai bukti pembelian di salinan (bukti tertulis ${adaBukti} dari ${N0}; SQL mandiri ${sqlBukti})`, adaBukti === sqlBukti || N0 === 0, `${adaBukti}/${sqlBukti}`);
  cek(`peristiwa: tepat +${N0} (semuanya DIKOREKSI) dengan alasan, pelaku, kunci per catatan, keadaan lama (BUKAN_STOK + sidik) dan baru (PERLU_DICEK + bukti sumber)`, (await num("select count(*)::int n from unit_usage_note_events")) === evAll0 + N0 && (await num(`select count(*)::int n from unit_usage_note_events e where e.note_id in (${dalam(ids)}) and e.kind = 'DIKOREKSI' and e.reason = $1 and e.actor_id = $2 and e.idempotency_key = ($3 || ':' || e.note_id::text) and e.before->>'state' = 'BUKAN_STOK' and (e.before->>'sidik') ~ '^[0-9a-f]{64}$' and e.after->>'state' = 'PERLU_DICEK' and e.after ? 'buktiAsal' and e.after->>'catatanBukti' ilike '%bukan bukti berat%'`, alasan, pemberiIzin.id, kunci)) === N0);
  cek("nilai ASLI (raw_*, kunci sumber, order, jumlah, satuan, tanggal) seluruh catatan sasaran tidak berubah", (await rawTarget()) === raw0);
  const S1 = await sidikLain(); const beda = TABEL.filter((t) => S[t] !== S1[t]);
  cek("D1 TIDAK membuat/mengubah master, stok, penerimaan, harga, valuasi, jurnal, pembelian, biaya operasional, unit, order (isi LENGKAP tabel identik)", beda.length === 0, beda.join(",") || "identik");
  cek("catatan di luar sasaran tidak tersentuh (isi lengkap identik)", (await sidikCatatanLain()) === lain0);
  // ── F. idempotensi dan kestabilan
  const e1 = await num("select count(*)::int n from unit_usage_note_events");
  const u1 = await pakai(pemberiIzin, "POST", `${R}/terapkan`, { manifest, alasan }, kunci);
  cek("ulang dengan kunci SAMA: tidak ada peristiwa baru, semua dilaporkan sebagai ulang", u1.status === 200 && u1.json?.ringkas?.ulang === N0 && u1.json?.ringkas?.dikoreksi === 0 && (await num("select count(*)::int n from unit_usage_note_events")) === e1, JSON.stringify(u1.json?.ringkas));
  const u2 = await pakai(pemberiIzin, "POST", `${R}/terapkan`, { manifest, alasan }, "reh-kla-d1-0002");
  cek("ulang dengan kunci BARU: seluruhnya ditahan (bukan lagi BUKAN_STOK), tanpa duplikat", u2.status === 200 && u2.json?.ringkas?.ditahan === N0 && u2.json.ditahan.every((x) => x.kode === "BUKAN_LAGI_BUKAN_STOK") && (await num("select count(*)::int n from unit_usage_note_events")) === e1);
  const dievaluasi0 = await num(`select count(*)::int n from unit_usage_note_events where note_id in (${dalam(ids)}) and kind = 'DIEVALUASI'`);
  await svc.evaluasiUlang(prisma, {}); // evaluasi global (HANYA pada salinan): hasil D1 harus stabil
  cek("kestabilan: evaluasi ulang global sesudah D1 tidak membalik/menulis ulang catatan hasil D1", (await num(`select count(*)::int n from unit_usage_notes where id in (${dalam(ids)}) and state = 'PERLU_DICEK'`)) === N0 && (await num(`select count(*)::int n from unit_usage_note_events where note_id in (${dalam(ids)}) and kind = 'DIEVALUASI'`)) === dievaluasi0);
}
// ── G. temuan alias untuk D5 (informasi, bukan syarat lulus): pengeluaran stok bernama lain pada unit-unit ini
const aliasN = await num(`select count(*)::int n from stock_movements s where s.type::text = 'ISSUE' and s.unit_id in (select unit_id from unit_usage_notes where id in (${dalam(ids)}) and unit_id is not null)`);
console.log(`INFO alias D5: pengeluaran stok (ISSUE) pada unit sasaran = ${aliasN}; periksa daftar per unit sebelum mengusulkan posting D5`);
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
