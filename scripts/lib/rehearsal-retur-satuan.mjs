import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const APP = process.env.APP_DIR ?? "/app"; // lokal (uji skrip ini): APP_DIR menunjuk ke folder backend; di kontainer rilis = /app
const imp = (p) => import(pathToFileURL(path.join(APP, p)).href);
const { ROLE_PERMISSIONS, PERMISSIONS: P } = await imp("src/constants/permissions.js");
let gagal = 0; let n = 0;
const cek = (nama, ok, d = "") => { n += 1; if (!ok) gagal += 1; console.log(`${ok ? "OK   " : "GAGAL"} ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const info = (nama, d = "") => console.log(`INFO  ${nama}${d ? " — " + String(d).slice(0, 260) : ""}`);
const num = async (q, ...a) => Number((await prisma.$queryRawUnsafe(q, ...a))[0].n);
const SMOKE_SRC = "@@SMOKE_SRC@@"; // diganti generator dengan isi smoke-retur-satuan.mjs
const nm = process.env.REH_DB_NAME ?? (await prisma.$queryRawUnsafe("select current_database() as n"))[0].n;
if (!/^rehearsal_/.test(nm)) { cek("uji penjaga satuan hanya pada DB rehearsal", false, nm); await prisma.$disconnect(); process.exit(1); }
// REHEARSAL "penjaga satuan berubah sejak penerimaan": kode BARU berjalan sebagai SERVER terhadap SALINAN RESTORE production (DB rehearsal_*, dibuang). Bagian A = kode SMOKE yang sama dengan fase 8b (tidak menulis).
// Bagian B MENULIS — HANYA pada salinan: tujuh transisi (bahan dan saldo hasil SO yang disetujui) lalu penjaga diuji pada baris penerimaan NYATA (retur supplier, koreksi GR) dan tidak ada tulisan lain.
const { neutralizeExternalEnv } = await imp("src/lib/stagingGuard.js"); neutralizeExternalEnv(process.env);
const PORT = Number(process.env.REH_PORT ?? 4103); const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ["src/index.js"], { cwd: APP, env: { ...process.env, PORT: String(PORT), DISABLE_BACKGROUND_JOBS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
const berhenti = () => { try { child.kill("SIGTERM"); } catch { /* sudah mati */ } };
let sehat = false; for (let i = 0; i < 60 && !sehat; i++) { try { sehat = (await fetch(BASE + "/api/health")).ok; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
cek("server kode baru hidup pada salinan restore (/api/health)", sehat, sehat ? "" : log.slice(-300)); if (!sehat) { berhenti(); await prisma.$disconnect(); process.exit(1); }

const rolesDari = async (u) => new Set([u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)]);
const bisa = (rs, izin) => [...rs].some((r) => (ROLE_PERMISSIONS[r] ?? []).includes(izin));
const semua = await prisma.user.findMany({ where: { active: true }, orderBy: { id: "asc" } }); const infoU = []; for (const u of semua) infoU.push({ u, rs: await rolesDari(u) });
const stamp = Date.now().toString(36);
const penyetuju = infoU.find((x) => bisa(x.rs, P.INVENTORY_ADJUSTMENT_APPROVE) && bisa(x.rs, P.INVENTORY_WRITE))?.u ?? await prisma.user.create({ data: { name: "REH Penyetuju", email: `reh-rsb-a-${stamp}@example.test`, passwordHash: "x", role: "OWNER" } });
const aktor = { id: penyetuju.id, name: penyetuju.name, roles: [...(await rolesDari(penyetuju))] };
const TABEL = [["harga_berlaku", "select count(*)::int n from material_harga_berlaku"], ["jurnal", "select count(*)::int n from fin_journal_entries"], ["valuasi", "select count(*)::int n from fin_stock_movement_valuations"], ["penyesuaian", "select count(*)::int n from stock_adjustment_requests"],
  ["goods_receipts", "select count(*)::int n from goods_receipts"], ["gr_lines", "select count(*)::int n from goods_receipt_lines"], ["po_lines", "select count(*)::int n from fin_purchase_order_lines"], ["retur_supplier", "select count(*)::int n from supplier_returns"], ["retur_pelanggan", "select count(*)::int n from return_records"],
  ["pernyataan", "select count(*)::int n from activity_events where event_type = 'SO_HISTORIS_DINYATAKAN'"], ["issue", "select count(*)::int n from stock_movements where type::text = 'ISSUE'"], ["catatan_diposting", "select count(*)::int n from unit_usage_notes where state::text = 'DIPOSTING'"]];
const jejak = async () => Object.fromEntries(await Promise.all(TABEL.map(async ([k, q]) => [k, await num(q)])));
const sama = (a, b) => Object.keys(a).every((k) => a[k] === b[k]);
const j0 = await jejak();

// ── A. SMOKE pasca-switch (kode yang sama dengan fase 8b) terhadap salinan restore ──
const sm = spawnSync(process.execPath, ["--input-type=module", "-"], { input: SMOKE_SRC, cwd: APP, encoding: "utf8", timeout: 600000, env: { ...process.env, SMOKE_BASE: BASE, APP_DIR: APP } });
const smokeLine = (String(sm.stdout).match(/^SMOKE_HASIL .*$/m) ?? [""])[0]; const smokeGagal = String(sm.stdout).split("\n").filter((l) => /^\s+FAIL/.test(l)).join(" | ");
console.log(String(sm.stdout).split("\n").filter((l) => /^\s+(PASS|FAIL|SKIP|INFO)/.test(l)).join("\n"));
cek("SMOKE pasca-switch (kode yang sama dengan fase 8b) lulus terhadap salinan restore: 0 gagal", sm.status === 0 && /^SMOKE_HASIL fail=0 /.test(smokeLine), smokeLine + " " + smokeGagal + " " + String(sm.stderr).slice(-150));

// ── B. TUJUH TRANSISI pada salinan lalu penjaga diuji pada baris penerimaan nyata ──
const { pratinjauTransisi, terapkanTransisi } = await imp("src/services/transisiSatuanBahan.js");
const { kapasitasBaris, pratinjauRetur } = await imp("src/services/finance/returSupplier.js");
const { rencanaKoreksiGR } = await imp("src/services/warehouseCorrection.js");
const KODE = "SATUAN_BERUBAH_SEJAK_PENERIMAAN";
const RENCANA = [["LIST-WIBING-PUTIH", "METER", 1080], ["LIST-WIBING-ABU", "METER", 540], ["LIST-WIBING-COKLAT", "METER", 270], ["BUSA-REBONDED-BATU", "SHEET", 22], ["STREPLES-10-13", "ROD", 250], ["BENANG-KATUN-PUTIH", "PCS", 5], ["PE-ENCASEMENT-200X18X4CM", "PCS", 1]];
const KEWAJIBAN = { "BENANG-KATUN-PUTIH": [{ rujukan: "GR-051126-02", jumlah: 4, satuan: "PACK", keterangan: "TERBUKA: +4 PACK belum dikonversi ke PCS (isi per PACK belum diketahui); BELUM tuntas, tidak ikut saldo 5 PCS" }] };
const ada = []; for (const [kode, baru, saldo] of RENCANA) { const m = (await prisma.$queryRawUnsafe("select id::text id, code, unit::text unit from materials where code = $1", kode))[0]; if (m && m.unit !== baru) ada.push({ ...m, baru, saldo }); }
if (!ada.length) info("uji transisi dilewati", "tidak ada bahan rencana yang masih perlu transisi di salinan restore");
else {
  const idList = ada.map((m) => m.id);
  const barisGR = await prisma.$queryRawUnsafe("select l.id::text lid, g.id::text gid, g.receipt_number no, m.code, l.accepted_qty::float diterima from goods_receipt_lines l join goods_receipts g on g.id = l.goods_receipt_id join materials m on m.id = l.material_id where l.material_id = any($1::uuid[]) and g.status::text = 'COMPLETED' and g.purchase_order_id is not null and l.purchase_order_line_id is not null order by m.code, g.receipt_number", idList);
  info("baris penerimaan PO selesai pada bahan rencana (salinan restore)", `${barisGR.length} baris`);
  const sebelum = {}; for (const b of barisGR) { const k = await kapasitasBaris(prisma, b.lid); sebelum[b.lid] = { boleh: k.bolehDiretur, blokir: k.blokir.map((x) => x.kode) }; }
  cek("SEBELUM transisi: tidak ada baris yang diblokir oleh penjaga satuan (penjaga tidak positif palsu)", barisGR.every((b) => !sebelum[b.lid].blokir.includes(KODE)), "");
  const minta = ada.map((m) => ({ materialId: m.id, satuanBaru: m.baru, saldoBaru: m.saldo, kewajibanTerbuka: KEWAJIBAN[m.code] ?? [] }));
  const pr = await pratinjauTransisi(prisma, { aktor, transisi: minta });
  cek("pratinjau transisi pada salinan: tanpa penghalang", pr.bolehDiterapkan, pr.transisi.map((t) => t.kode + ":" + t.penghalang.map((p) => p.kode).join("+")).join(" "));
  if (pr.bolehDiterapkan) {
    const mv0 = await num("select count(*)::int n from stock_movements");
    const hasil = await terapkanTransisi(prisma, { aktor, transisi: minta.map((x, i) => ({ ...x, hashPratinjau: pr.transisi[i].hash })), sumber: "Uji rehearsal (salinan restore) — hasil SO 4 Nov 2026", alasan: "Uji rehearsal penjaga satuan berubah sejak penerimaan pada salinan restore", rujukanHash: "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d", tautan: { soTanggal: "2026-11-04", sumber: "Uji rehearsal (salinan restore)", alasan: "Tautan uji pada salinan restore untuk transisi", rujukanHash: "3f57dc90c790cf3389ad51de128cc5bbd6149e1669812470b665df4bfc5c9283" }, kunci: `reh-rsb-${stamp}-0001` }).catch((e) => ({ galat: `${e.code ?? e.kode ?? ""} ${e.message}` }));
    cek("tujuh transisi diterapkan pada salinan (satu transaksi)", !hasil.galat && hasil.transisi?.length === ada.length, hasil.galat ?? `${hasil.transisi.length} transisi; tautan ${hasil.tautanBaru.length}`);
    if (!hasil.galat) {
      const mv1 = await num("select count(*)::int n from stock_movements"); info("pergerakan baru oleh transisi (penutup + pembuka)", String(mv1 - mv0));
      // penjaga pada baris penerimaan NYATA sesudah transisi
      let tak = []; let koreksiBocor = []; let boleh = [];
      for (const b of barisGR) {
        const k = await kapasitasBaris(prisma, b.lid); const kode0 = k.blokir[0]?.kode;
        if (kode0 !== KODE || k.bolehDiretur !== 0) tak.push(`${b.code} ${b.no}:${kode0 ?? "boleh " + k.bolehDiretur}`);
        if (sebelum[b.lid].boleh === 0 && k.bolehDiretur > 0) boleh.push(b.no);
        const kg = await rencanaKoreksiGR(prisma, { receiptId: b.gid, perubahan: { baris: [{ barisId: b.lid, jumlahBaik: Math.max(0, b.diterima - 1) }] } }).then((r) => r.boleh, () => false);
        if (kg) koreksiBocor.push(b.no);
      }
      cek(`SESUDAH transisi: SEMUA ${barisGR.length} baris penerimaan bahan bertransisi ditolak oleh penjaga satuan (alasan pertama ${KODE}, boleh diretur 0)`, barisGR.length > 0 && tak.length === 0, tak.join(" | "));
      cek("SESUDAH transisi: tidak ada baris yang terbuka untuk retur (di kode lama: LIST WIBING terbuka dengan angka mentah ROLL)", boleh.length === 0, boleh.join(","));
      cek("koreksi GR (Gudang) tetap menolak semua baris penerimaan bahan bertransisi", koreksiBocor.length === 0, koreksiBocor.join(","));
      const sampel = barisGR.find((b) => b.code === "LIST-WIBING-PUTIH") ?? barisGR[0];
      if (sampel) { const pv = await pratinjauRetur(prisma, { reasonCode: "RUSAK", reason: "Uji rehearsal", lines: [{ goodsReceiptLineId: sampel.lid, qty: 1 }] }).catch((e) => ({ galat: e.message })); cek(`pratinjau retur ${sampel.code} ${sampel.no}: ditolak dengan kode ${KODE} dan pesan satuan lama`, !pv.galat && pv.boleh === false && pv.baris[0].blokir[0].kode === KODE && /satuan lama/.test(pv.baris[0].blokir[0].pesan), pv.galat ?? pv.baris?.[0]?.blokir?.[0]?.pesan); }
      // bahan LAIN (tanpa transisi) tidak terpengaruh
      const lain = await prisma.$queryRawUnsafe("select l.id::text lid from goods_receipt_lines l join goods_receipts g on g.id = l.goods_receipt_id where g.status::text = 'COMPLETED' and g.purchase_order_id is not null and l.purchase_order_line_id is not null and l.material_id <> all($1::uuid[]) order by g.created_at desc limit 25", idList);
      let positifPalsu = 0; for (const x of lain) { const k = await kapasitasBaris(prisma, x.lid); if (k.blokir.some((y) => y.kode === KODE)) positifPalsu += 1; }
      cek("bahan tanpa transisi tidak terpengaruh penjaga (0 positif palsu)", positifPalsu === 0, `${lain.length} baris diperiksa`);
      const j2 = await jejak(); const beda = Object.keys(j0).filter((k) => j0[k] !== j2[k]);
      cek("transisi + uji penjaga tidak membuat ISSUE, jurnal, valuasi, harga, PO/GR, penyesuaian, retur supplier/pelanggan, deklarasi, atau posting historis", beda.length === 0, beda.map((k) => `${k}:${j0[k]}→${j2[k]}`).join(" "));
    }
  }
}
berhenti(); await prisma.$disconnect();
console.log("PEMERIKSAAN=" + n + " gagal=" + gagal);
process.exit(gagal === 0 ? 0 : 1);
