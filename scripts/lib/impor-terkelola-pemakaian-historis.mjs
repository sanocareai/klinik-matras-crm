// IMPOR TERKELOLA catatan pemakaian historis (CSV Admin Sales) — HANYA tabel catatan. Tidak ada pergerakan stok, saldo, valuasi, jurnal, atau posting.
// Dijalankan DI DALAM container backend (atau lokal pada salinan) lewat stdin, tanpa deploy:  node --input-type=module - --mode=... < scripts/lib/impor-terkelola-pemakaian-historis.mjs
// Mode:
//   pratinjau  (baca-saja)  susun rencana dari CSV + data, tulis manifest JSON (hitungan, hash rencana, daftar order, kegagalan pemetaan, dst.)
//   sebelum    (baca-saja)  prasyarat (tabel rekonsiliasi KOSONG, 268 migrasi) + potret data bisnis sebelum impor
//   terapkan   (MENULIS)    HANYA bila: sha256 CSV = manifest, hash rencana (dihitung ulang dari production) = manifest = --hash-disetujui, tabel masih kosong, potret 'sebelum' ada. Satu transaksi + evaluasi ulang.
//   sesudah    (baca-saja)  bukti sesudah impor terhadap manifest + potret: hitungan, hash akhir, nilai asli = CSV, tanpa pergerakan/valuasi/jurnal baru, 254 ISSUE lama utuh, impor ulang = nol perubahan
// Argumen: --csv=<Pemakaian Bahan.csv> --rekap=<Rekapitulasi Order.csv> --manifest=<berkas> --potret=<berkas> --keluar=<berkas> --hash-disetujui=<sha256> --aktor-email=<email>
// Lokal: SRC_ROOT=file:///C:/tmp/km-rekon-wt/backend/src/ dengan cwd=backend dan DATABASE_URL ke salinan.
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
const SRC = process.env.SRC_ROOT || "/app/src/";
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : ""; };
const MODE = arg("mode") || "pratinjau";
// Sidik jari BYTE alat ini sendiri (hanya bila dijalankan sebagai berkas, bukan stdin). Mode menulis ('terapkan') dan 'lanjut' WAJIB berjalan dari berkas dengan sha256 = --sha-alat = manifest.alat.sha256.
const ALAT_SHA = (() => { try { return crypto.createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).digest("hex"); } catch { return null; } })();
const SUMBER_LABEL = "Excel Admin Sales yang dikonfirmasi Owner"; // dicatat di peristiwa; TIDAK mengatasnamakan PIC pemakaian historis
const cat = await import(SRC + "services/catatanPemakaianHistoris.js");
const dom = await import(SRC + "lib/domain/pemakaianHistoris.js");
const { prisma } = await import(SRC + "db.js");
const { STATE, parseCsv, bacaCsvPemakaian } = dom;
const NAMA_BERKAS = `${SUMBER_LABEL} — Rekapitulasi Pemakaian Bahan SANO - 2026 (Pemakaian Bahan.csv)`; // masuk ke alasan peristiwa IMPOR: "Impor <label> baris N"
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const stabilJson = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const hitung = async (q) => Number((await prisma.$queryRawUnsafe(q))[0].n);
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 300) : "")); };
const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Aktor audit = akun ADMIN aktif yang benar-benar menjalankan impor; email DAN id harus cocok dengan yang disetujui. */
async function ambilAktor() {
  const email = arg("aktor-email"); const id = arg("aktor-id");
  if (!email || !id) return { ok: false, alasan: "--aktor-email dan --aktor-id wajib" };
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, role: true, active: true } });
  if (!u) return { ok: false, alasan: "akun " + email + " tidak ditemukan" };
  const roles = [u.role, ...(await prisma.userRole.findMany({ where: { userId: u.id }, select: { role: true } })).map((r) => r.role)];
  const ok = u.active && u.id === id && roles.includes("ADMIN");
  return { ok, u, roles, alasan: ok ? "" : (u.active ? (u.id !== id ? "id akun tidak cocok dengan yang disetujui" : "akun bukan ADMIN") : "akun nonaktif") };
}
const tampilAktor = (a) => (a.u ? a.u.name + " <" + a.u.email + "> id " + a.u.id + " peran " + a.roles.join(",") : a.alasan);

function bacaMasukan() {
  const csvPath = arg("csv"); if (!csvPath) throw new Error("--csv wajib");
  const buf = fs.readFileSync(csvPath); const csvText = buf.toString("utf8");
  const rekapPath = arg("rekap"); const rekapText = rekapPath ? fs.readFileSync(rekapPath, "utf8") : null;
  return { csvText, csvSha: sha(buf), csvBytes: buf.length, rekapText, rekapSha: rekapText ? sha(Buffer.from(rekapText, "utf8")) : null };
}

/** Hash rencana (sebelum ditulis): kunci baris + tautan + keadaan + penanda + bahan/unit/jumlah. Berubah bila ledger/katalog/order production berubah → rencana harus ditinjau ulang. */
function hashRencana(r) {
  const ex = r.drafs.map((d) => { const h = r.klas.get(d.key); return ["E", d.key, d.orderNumber, d.orderId, d.unitId, d.materialId, d.qty, d.uom, iso(d.usedAt), h.state, h.flags.map((f) => f.kode).sort().join(","), h.stockMovementId ?? null, h.linkKind ?? null]; });
  const lg = r.ledger.map((l) => ["L", l.key, l.ledger.stockMovementId, l.state, l.flags.map((f) => f.kode).sort().join(",")]);
  return sha(Buffer.from(stabilJson([...ex, ...lg].sort((a, b) => String(a[1]).localeCompare(String(b[1]))))));
}
/** Hash keadaan AKHIR dari tabel (setelah impor + evaluasi ulang) — dipakai fase 'sesudah' untuk membuktikan hasil = yang direview. */
async function hashAkhir() {
  const rows = await prisma.unitUsageNote.findMany({ select: { sourceKey: true, origin: true, state: true, flags: true, unitId: true, materialId: true, qty: true, uom: true, usedAt: true, stockMovementId: true, linkKind: true, orderNumber: true } });
  const t = rows.map((n) => [n.origin[0], n.sourceKey, n.orderNumber, n.unitId, n.materialId, n.qty === null ? null : Number(n.qty), n.uom, iso(n.usedAt), n.state, (n.flags ?? []).map((f) => f.kode).sort().join(","), n.stockMovementId, n.linkKind]);
  return { hash: sha(Buffer.from(stabilJson(t.sort((a, b) => String(a[1]).localeCompare(String(b[1])))))), n: rows.length };
}
const hitungState = (arr) => arr.reduce((o, s) => { o[s] = (o[s] ?? 0) + 1; return o; }, {});
const nol = (d) => /^0([,.]0+)?$/.test(String(d.rawQty ?? "").trim());

async function susunManifest() {
  const m = bacaMasukan();
  const parsed = bacaCsvPemakaian(m.csvText);
  const r = await cat.rencanakanImpor(prisma, { csvText: m.csvText, namaBerkas: NAMA_BERKAS });
  const ex = r.drafs.map((d) => ({ d, h: r.klas.get(d.key) }));
  const flagTotal = {}; for (const { h } of ex) for (const f of h.flags) flagTotal[f.kode] = (flagTotal[f.kode] ?? 0) + 1;
  const flagLedger = {}; for (const l of r.ledger) for (const f of l.flags) flagLedger[f.kode] = (flagLedger[f.kode] ?? 0) + 1;
  // ── order & unit ──
  const perOrder = new Map();
  for (const { d, h } of ex) { const o = perOrder.get(d.orderNumber) ?? { order: d.orderNumber, ditemukan: d.orderFound, unit: d.units.map((u) => u.unitCode ?? u.id).join(","), jumlahUnit: d.units.length, baris: 0, positif: 0, nol: 0, state: {}, terhubungUnit: !!d.unitId }; o.baris++; if (nol(d)) o.nol++; else o.positif++; o.state[h.state] = (o.state[h.state] ?? 0) + 1; perOrder.set(d.orderNumber, o); }
  const orders = [...perOrder.values()];
  const orderTampil = orders.filter((o) => o.terhubungUnit && o.positif > 0);
  const orderTidakAda = orders.filter((o) => !o.ditemukan); const orderUnitTakPasti = orders.filter((o) => o.ditemukan && !o.terhubungUnit);
  const orderHanyaNol = orders.filter((o) => o.positif === 0);
  // ── 254 ISSUE lama ──
  const lama = await prisma.stockMovement.findMany({ where: { type: "ISSUE", unitId: { not: null }, note: { startsWith: "Impor pemakaian Sept 2026" } }, select: { id: true, unitId: true, materialId: true } });
  const kel = new Map(); for (const { d } of ex) if (d.unitId && d.materialId) kel.set(`${d.unitId}|${d.materialId}`, (kel.get(`${d.unitId}|${d.materialId}`) ?? 0) + 1);
  const berpasangan = lama.filter((x) => kel.has(`${x.unitId}|${x.materialId}`)).length;
  const tercatat = ex.filter(({ h }) => h.state === STATE.TERCATAT_DI_STOK).length;
  // ── gagal dipetakan ──
  const gagalPeta = ex.filter(({ d, h }) => !d.materialId && !["BUKAN_STOK", "TIDAK_DIHITUNG"].includes(h.state) || h.flags.some((f) => ["NAMA_TIDAK_DI_KATALOG", "ORDER_TIDAK_ADA", "UNIT_TIDAK_PASTI"].includes(f.kode)))
    .map(({ d, h }) => ({ baris: d.sourceRow, order: d.orderNumber, nama: d.rawName, spek: d.rawSpec, qty: d.rawQty, satuan: d.rawUom, kategori: d.rawCategory, state: h.state, penanda: h.flags.map((f) => f.kode).join(","), catatan: h.flags.map((f) => f.teks).join(" | ") }));
  const bukanStok = ex.filter(({ h }) => h.state === STATE.BUKAN_STOK).map(({ d }) => ({ baris: d.sourceRow, order: d.orderNumber, nama: d.rawName, qty: d.rawQty, satuan: d.rawUom, kategori: d.rawCategory }));
  // ── order tanpa baris bahan ──
  let rekapOrders = []; let rekapTanpaBaris = []; let oktTanpaBaris = [];
  if (m.rekapText) {
    const R = parseCsv(m.rekapText); const hi = R.findIndex((x) => x.some((c) => /no\. resi \/ order/i.test(c))); const iO = R[hi].findIndex((h) => /no\. resi/i.test(h)); const iT = R[hi].findIndex((h) => /tgl selesai/i.test(h));
    rekapOrders = R.slice(hi + 1).map((x) => ({ order: (x[iO] ?? "").trim(), tgl: (x[iT] ?? "").trim() })).filter((x) => x.order);
    const csvOrders = new Set(parsed.baris.map((b) => b.order));
    rekapTanpaBaris = rekapOrders.filter((x) => !csvOrders.has(x.order));
    const dbR = await prisma.order.findMany({ where: { orderNumber: { in: rekapTanpaBaris.map((x) => x.order) } }, select: { orderNumber: true, status: true, units: { select: { unitCode: true, status: true } } } });
    const peta = new Map(dbR.map((o) => [o.orderNumber, o])); rekapTanpaBaris = rekapTanpaBaris.map((x) => ({ ...x, di_sistem: peta.has(x.order), statusOrder: peta.get(x.order)?.status ?? null, unit: (peta.get(x.order)?.units ?? []).map((u) => `${u.unitCode}:${u.status}`).join(",") }));
    // order TERKIRIM Oktober di sistem yang tidak punya baris bahan dan tidak ada di rekap
    const rekapSet = new Set(rekapOrders.map((x) => x.order));
    const okt = await prisma.order.findMany({ where: { status: "DELIVERED", deliveryConfirmedDate: { gte: new Date("2026-10-01T00:00:00+07:00"), lt: new Date("2026-11-01T00:00:00+07:00") } }, select: { orderNumber: true, deliveryConfirmedDate: true, units: { select: { unitCode: true, status: true } } }, orderBy: { orderNumber: "asc" } });
    oktTanpaBaris = okt.filter((o) => !csvOrders.has(o.orderNumber)).map((o) => ({ order: o.orderNumber, terkirim: iso(o.deliveryConfirmedDate), unit: o.units.map((u) => u.unitCode).join(","), diRekap: rekapSet.has(o.orderNumber) }));
  }
  const tglCsv = parsed.baris.map((b) => b.tglTeks).filter(Boolean);
  const manifest = {
    versi: 1, dibuat: new Date().toISOString(), mode: "pratinjau",
    sumber: { pemakaianBahan: { berkas: NAMA_BERKAS, sha256: m.csvSha, bytes: m.csvBytes, rekordSetelahHeader: parsed.baris.length + parsed.tanpaOrder.length, barisHeader: parsed.barisHeader }, rekapitulasiOrder: m.rekapSha ? { sha256: m.rekapSha } : null },
    hitungan: { catatanExcel: ex.length, berjumlahNol: ex.filter(({ d }) => nol(d)).length, berjumlahPositif: ex.filter(({ d }) => !nol(d)).length, barisPengisiNA_diabaikan: parsed.tanpaOrder.length, referensiIssueLama_LEDGER: r.ledger.length, totalCatatan: ex.length + r.ledger.length,
      orderBerbaris: orders.length, orderBerbarisPositif: orders.length - orderHanyaNol.length, orderTampilDiProduksi: orderTampil.length, orderTidakDitemukanDiSistem: orderTidakAda.length, orderUnitTakPasti: orderUnitTakPasti.length, orderHanyaBarisNol: orderHanyaNol.map((o) => o.order) },
    stateRencanaExcel: hitungState(ex.map(({ h }) => h.state)), stateRencanaLedger: hitungState(r.ledger.map((l) => l.state)), penandaExcel: flagTotal, penandaLedger: flagLedger,
    issueLama: { total: lama.length, berpasanganDenganBarisExcel: berpasangan, tanpaPasangan_LEDGER: lama.length - berpasangan, referensiLedgerDibuat: r.ledger.length, excelTercatatDiStok: tercatat, pergerakanBaruDariImpor: 0 },
    gagalDipetakan: gagalPeta, bukanStok, orderTidakDitemukan: orderTidakAda.map((o) => o.order), orderUnitTakPasti: orderUnitTakPasti.map((o) => ({ order: o.order, jumlahUnit: o.jumlahUnit, unit: o.unit })),
    rekapTanpaBarisBahan: rekapTanpaBaris, terkirimOktoberTanpaBarisBahan: oktTanpaBaris, rekapJumlahOrder: rekapOrders.length,
    tanggalSelesaiCsv: { n: tglCsv.length },
    hashRencana: hashRencana(r), perOrder: orders,
  };
  return { manifest, rencana: r };
}

async function potretBisnis() {
  const t0 = (await prisma.$queryRawUnsafe(`select to_char((now() at time zone 'utc') - interval '5 minutes', 'YYYY-MM-DD HH24:MI:SS.MS') t`))[0].t;
  const Q = {
    pergerakan_stok: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from stock_movements x where x.created_at < '${t0}'::timestamp`,
    valuasi: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from fin_stock_movement_valuations x where x.valued_at < '${t0}'::timestamp`,
    jurnal_induk: `select count(*)::int n, md5(coalesce(string_agg(x.id::text, '' order by x.id),'')) h from fin_journal_entries x where x.created_at < '${t0}'::timestamp`,
    koreksi_gudang: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from warehouse_corrections x where x.requested_at < '${t0}'::timestamp`,
    penyesuaian: `select count(*)::int n, md5(coalesce(string_agg(md5((to_jsonb(x) - 'origin_type' - 'origin_id')::text), '' order by x.id),'')) h from stock_adjustment_requests x where x.created_at < '${t0}'::timestamp and x.updated_at < '${t0}'::timestamp`,
    material_issue: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from material_issues x where x.created_at < '${t0}'::timestamp and x.updated_at < '${t0}'::timestamp`,
    bahan: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from materials x where x.created_at < '${t0}'::timestamp`,
    pemakaian_sementara: `select count(*)::int n, md5(coalesce(string_agg(x.id::text, '' order by x.id),'')) h from unit_provisional_usages x where x.recorded_at < '${t0}'::timestamp`,
  };
  const out = { t0, tabel: {} };
  for (const [k, q] of Object.entries(Q)) { const r = (await prisma.$queryRawUnsafe(q))[0]; out.tabel[k] = { n: Number(r.n), h: r.h }; }
  out.issueLama = await hitung(`select count(*)::int n from stock_movements where type = 'ISSUE' and note like 'Impor pemakaian Sept 2026%'`);
  out.totalPergerakan = await hitung(`select count(*)::int n from stock_movements`); out.totalJurnal = await hitung(`select count(*)::int n from fin_journal_entries`);
  out.migrasi = await hitung(`select count(*)::int n from _prisma_migrations where finished_at is not null and rolled_back_at is null`);
  return out;
}
const tabelBaruIsi = async () => ({
  batch: await hitung("select count(*)::int n from usage_import_batches"), catatan: await hitung("select count(*)::int n from unit_usage_notes"), peristiwa: await hitung("select count(*)::int n from unit_usage_note_events"),
  koreksiHarga: await hitung("select count(*)::int n from fin_stock_movement_valuation_corrections"), koreksiPemakaian: await hitung("select count(*)::int n from warehouse_corrections where doc_type = 'UNIT_USAGE'"), penyesuaianAsal: await hitung("select count(*)::int n from stock_adjustment_requests where origin_type is not null"),
});

async function main() {
  console.log("ALAT_SHA256 " + (ALAT_SHA ?? "(stdin: tidak dapat dihitung)") + " mode=" + MODE);
  if (MODE === "pratinjau") {
    const { manifest } = await susunManifest(); const keluar = arg("keluar");
    if (keluar) fs.writeFileSync(keluar, JSON.stringify(manifest, null, 1)); else console.log(JSON.stringify(manifest, null, 1));
    const h = manifest.hitungan; console.log(`PRATINJAU: Excel ${h.catatanExcel} (nol ${h.berjumlahNol}, positif ${h.berjumlahPositif}) + LEDGER ${h.referensiIssueLama_LEDGER} = ${h.totalCatatan}; order tampil ${h.orderTampilDiProduksi}; hashRencana ${manifest.hashRencana}`); return;
  }
  if (MODE === "status") { // BACA-SAJA: keadaan tabel untuk memutuskan langkah setelah koneksi/proses terputus
    const isi = await tabelBaruIsi(); const excel = await hitung("select count(*)::int n from unit_usage_notes where origin = 'EXCEL'"); const ledger = await hitung("select count(*)::int n from unit_usage_notes where origin = 'LEDGER'");
    const manifest = arg("manifest") ? JSON.parse(fs.readFileSync(arg("manifest"), "utf8")) : null; const h = manifest?.hitungan;
    let k = "TIDAK_DIKENAL";
    if (Object.values(isi).every((v) => v === 0)) k = "KOSONG";
    else if (h && isi.batch === 1 && excel === h.catatanExcel && ledger === h.referensiIssueLama_LEDGER) k = "PENUH";
    else k = "SEBAGIAN_ATAU_LAIN";
    console.log("STATUS " + k + " " + JSON.stringify({ ...isi, excel, ledger }));
    console.log(k === "KOSONG" ? "→ transaksi impor TIDAK ter-commit: aman mengulang 'sebelum' lalu 'terapkan' dengan argumen yang sama." : k === "PENUH" ? "→ transaksi impor ter-commit: JANGAN terapkan lagi. Jalankan --mode=lanjut lalu --mode=sesudah." : "→ STOP: keadaan tak terduga (impor satu transaksi seharusnya tidak sebagian). Jangan ubah apa pun; laporkan.");
    process.exitCode = k === "KOSONG" ? 0 : k === "PENUH" ? 10 : 20; return;
  }
  if (MODE === "lanjut") { // PEMULIHAN MAJU bila proses berhenti SETELAH transaksi impor berhasil tetapi sebelum evaluasi ulang selesai: hanya evaluasi ulang (idempoten) + hash akhir. TIDAK menulis catatan baru.
    const n = await hitung("select count(*)::int n from unit_usage_notes"); if (n === 0) { console.log("TIDAK ADA catatan: impor belum terjadi — jalankan alur normal (sebelum → terapkan), bukan 'lanjut'."); process.exitCode = 2; return; }
    const aktor = await ambilAktor(); cek("aktor = akun Admin aktif yang disetujui", aktor.ok, tampilAktor(aktor));
    cek("alat dijalankan dari berkas dengan sha256 = yang disetujui (--sha-alat)", !!ALAT_SHA && ALAT_SHA === arg("sha-alat"), String(ALAT_SHA).slice(0, 16));
    if (gagal) { console.log("LANJUT DITOLAK — tidak ada yang ditulis."); process.exitCode = 3; return; }
    const ev = await cat.evaluasiUlang(prisma, { actorId: aktor.u.id }); console.log(`EVALUASI ULANG (lanjut): diperiksa ${ev.diperiksa}, berubah ${ev.berubah}`); const ha = await hashAkhir(); console.log(`HASH_AKHIR ${ha.hash} (${ha.n} catatan)`); return;
  }
  if (MODE === "rekam-akhir") { // dijalankan HANYA pada salinan sesudah impor percobaan: menulis hash + distribusi keadaan AKHIR ke manifest final
    const manifest = JSON.parse(fs.readFileSync(arg("manifest"), "utf8")); const ha = await hashAkhir();
    const g = await prisma.unitUsageNote.groupBy({ by: ["origin", "state"], _count: { _all: true } }); manifest.stateAkhir = Object.fromEntries(g.map((x) => [x.origin + ":" + x.state, x._count._all])); manifest.hashAkhir = ha.hash; manifest.catatanAkhir = ha.n;
    const flags = await prisma.unitUsageNote.findMany({ select: { origin: true, flags: true } }); const pf = {}; for (const n of flags) for (const fl of n.flags ?? []) pf[n.origin + ":" + fl.kode] = (pf[n.origin + ":" + fl.kode] ?? 0) + 1; manifest.penandaAkhir = pf;
    fs.writeFileSync(arg("keluar") || arg("manifest"), JSON.stringify(manifest, null, 1)); console.log("REKAM_AKHIR " + ha.hash + " " + ha.n); return;
  }
  if (MODE === "sebelum") {
    const isi = await tabelBaruIsi(); const p = await potretBisnis();
    cek("migrasi terpasang 268", p.migrasi === 268, `${p.migrasi}`);
    cek("semua tabel/jejak rekonsiliasi KOSONG sebelum impor", Object.values(isi).every((v) => v === 0), JSON.stringify(isi));
    cek("254 ISSUE lama ada di ledger (tidak akan digandakan)", p.issueLama === 254, `${p.issueLama}`);
    cek("tidak ada pergerakan hasil posting historis", await hitung("select count(*)::int n from stock_movements where note like 'Impor pemakaian historis%'") === 0);
    const k = arg("potret"); if (k) fs.writeFileSync(k, JSON.stringify(p, null, 1)); console.log("POTRET " + JSON.stringify({ t0: p.t0, pergerakan: p.totalPergerakan, jurnal: p.totalJurnal }));
    console.log(`SEBELUM_HASIL gagal=${gagal}`); process.exitCode = gagal ? 1 : 0; return;
  }
  if (MODE === "terapkan") {
    const manifest = JSON.parse(fs.readFileSync(arg("manifest"), "utf8")); const setuju = arg("hash-disetujui"); const m = bacaMasukan();
    cek("sha256 Pemakaian Bahan.csv = manifest", m.csvSha === manifest.sumber.pemakaianBahan.sha256, m.csvSha.slice(0, 16));
    cek("hash rencana yang disetujui = hash di manifest", !!setuju && setuju === manifest.hashRencana, setuju.slice(0, 16));
    const isi = await tabelBaruIsi(); cek("tabel rekonsiliasi masih KOSONG (impor belum pernah jalan)", Object.values(isi).every((v) => v === 0), JSON.stringify(isi));
    cek("potret 'sebelum' ada", !!arg("potret") && fs.existsSync(arg("potret")));
    cek("alat dijalankan dari BERKAS dengan sha256 = --sha-alat = manifest.alat.sha256 (byte sama dengan yang diuji pada salinan)", !!ALAT_SHA && ALAT_SHA === arg("sha-alat") && ALAT_SHA === manifest.alat?.sha256, String(ALAT_SHA).slice(0, 16));
    const aktor = await ambilAktor(); cek("aktor audit = akun ADMIN aktif yang disetujui (email + id cocok)", aktor.ok, tampilAktor(aktor));
    const { manifest: baru, rencana } = await susunManifest();
    cek("rencana dihitung ulang dari data production = manifest (hash sama)", baru.hashRencana === manifest.hashRencana, `${baru.hashRencana.slice(0, 16)} vs ${manifest.hashRencana.slice(0, 16)}`);
    cek("hitungan rencana (catatan Excel + referensi LEDGER) = manifest", baru.hitungan.catatanExcel === manifest.hitungan.catatanExcel && baru.hitungan.referensiIssueLama_LEDGER === manifest.hitungan.referensiIssueLama_LEDGER);
    if (gagal) { console.log(`GATE DITOLAK (${gagal} pemeriksaan gagal) — TIDAK ada yang ditulis.`); process.exitCode = 3; return; }
    const t = Date.now();
    const hasil = await cat.terapkanImpor(prisma, rencana, { actorId: aktor.u.id });
    console.log(`TERAPKAN: batch ${hasil.batchBaru ? "baru" : "sudah ada"} ${hasil.batchId}; dibuat ${hasil.dibuat}, dilewati ${hasil.dilewati} (${Date.now() - t} ms, satu transaksi)`);
    if (process.env.IMPOR_UJI_BERHENTI_SETELAH_COMMIT === "1") { console.log("UJI: proses sengaja dihentikan SETELAH commit (hanya untuk menguji pemulihan --mode=lanjut)"); process.exit(9); }
    const ev = await cat.evaluasiUlang(prisma, { actorId: aktor.u.id }); console.log(`EVALUASI ULANG: diperiksa ${ev.diperiksa}, berubah ${ev.berubah}`);
    const ha = await hashAkhir(); console.log(`HASH_AKHIR ${ha.hash} (${ha.n} catatan)`); return;
  }
  if (MODE === "sesudah") {
    const manifest = JSON.parse(fs.readFileSync(arg("manifest"), "utf8")); const potret = JSON.parse(fs.readFileSync(arg("potret"), "utf8")); const m = bacaMasukan(); const h = manifest.hitungan;
    const batch = await prisma.usageImportBatch.findMany(); cek("tepat 1 batch impor, sha256 = CSV, jumlah baris sesuai", batch.length === 1 && batch[0].fileSha256 === manifest.sumber.pemakaianBahan.sha256 && batch[0].rowCount === h.catatanExcel, batch.map((b) => `${b.fileSha256.slice(0, 12)} ${b.rowCount}`).join());
    const excel = await hitung("select count(*)::int n from unit_usage_notes where origin = 'EXCEL'"); const ledger = await hitung("select count(*)::int n from unit_usage_notes where origin = 'LEDGER'");
    cek(`catatan Excel = ${h.catatanExcel} (nol ${h.berjumlahNol} + positif ${h.berjumlahPositif})`, excel === h.catatanExcel && await hitung("select count(*)::int n from unit_usage_notes where origin = 'EXCEL' and state = 'TIDAK_DIHITUNG'") === h.berjumlahNol, `${excel}`);
    cek(`referensi ISSUE lama (LEDGER) = ${h.referensiIssueLama_LEDGER}`, ledger === h.referensiIssueLama_LEDGER, `${ledger}`);
    const ha = await hashAkhir(); const arq = manifest.hashAkhir; cek("hash keadaan akhir tabel = hash akhir yang direview (impor di salinan)", !arq || ha.hash === arq, `${ha.hash.slice(0, 16)} vs ${(arq ?? "-").slice(0, 16)}`);
    const states = await prisma.unitUsageNote.groupBy({ by: ["origin", "state"], _count: { _all: true } }); const peta = Object.fromEntries(states.map((s) => [`${s.origin}:${s.state}`, s._count._all]));
    if (manifest.stateAkhir) cek("distribusi keadaan akhir = manifest", stabilJson(peta) === stabilJson(manifest.stateAkhir), JSON.stringify(peta));
    const ak = await ambilAktor(); cek("aktor sesudah impor = akun ADMIN aktif yang disetujui", ak.ok, tampilAktor(ak));
    if (ak.u) {
      cek("batch impor dibuat oleh akun aktor", batch.length === 1 && batch[0].createdById === ak.u.id);
      const evs = await prisma.unitUsageNoteEvent.findMany({ select: { kind: true, reason: true, actorId: true } });
      cek("SEMUA peristiwa (IMPOR, DITAUTKAN) dicatat atas akun aktor Admin", evs.length > 0 && evs.every((e) => e.actorId === ak.u.id), `${evs.length} peristiwa`);
      cek(`setiap peristiwa IMPOR menyebut sumber "${SUMBER_LABEL}"`, evs.filter((e) => e.kind === "IMPOR").every((e) => String(e.reason).includes(SUMBER_LABEL)), (evs.find((e) => e.kind === "IMPOR")?.reason ?? "").slice(0, 120));
      const pics = [...new Set((await prisma.unitUsageNote.findMany({ where: { origin: "EXCEL" }, select: { rawPic: true } })).map((n) => String(n.rawPic ?? "").trim().toLowerCase()).filter((p) => p.length > 2))];
      cek("tidak ada peristiwa yang mengatasnamakan PIC pemakaian historis", !evs.some((e) => pics.some((p) => String(e.reason ?? "").toLowerCase().includes(p))), `${pics.length} nama PIC diperiksa`);
    }
    const evImpor = await hitung("select count(*)::int n from unit_usage_note_events where kind = 'IMPOR'"); cek("setiap catatan punya peristiwa IMPOR", evImpor === excel + ledger, `${evImpor}`);
    cek("tidak ada catatan DIPOSTING dan tidak ada pergerakan hasil posting historis", await hitung("select count(*)::int n from unit_usage_notes where state = 'DIPOSTING'") === 0 && await hitung("select count(*)::int n from stock_movements where note like 'Impor pemakaian historis%'") === 0);
    cek("tidak ada koreksi pemakaian/harga/saldo ber-asal", Object.entries(await tabelBaruIsi()).filter(([k]) => ["koreksiHarga", "koreksiPemakaian", "penyesuaianAsal"].includes(k)).every(([, v]) => v === 0));
    // nilai asli = CSV
    const parsed = bacaCsvPemakaian(m.csvText); const per = new Map(parsed.baris.map((b) => [b.baris, b]));
    const notes = await prisma.unitUsageNote.findMany({ where: { origin: "EXCEL" }, select: { sourceRow: true, rawQty: true, rawUom: true, rawName: true, orderNumber: true } });
    const beda = notes.filter((n) => { const b = per.get(n.sourceRow); return !b || b.qtyTeks !== n.rawQty || b.satuan !== n.rawUom || b.nama !== n.rawName || b.order !== n.orderNumber; });
    cek("nilai asli setiap catatan Excel = baris CSV (jumlah, satuan, nama, order)", beda.length === 0 && notes.length === parsed.baris.length, `${beda.length} berbeda`);
    // data bisnis tidak berubah
    const now = {}; const t0 = potret.t0;
    for (const [k, v] of Object.entries(potret.tabel)) {
      const q = { pergerakan_stok: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from stock_movements x where x.created_at < '${t0}'::timestamp`, valuasi: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from fin_stock_movement_valuations x where x.valued_at < '${t0}'::timestamp`, jurnal_induk: `select count(*)::int n, md5(coalesce(string_agg(x.id::text, '' order by x.id),'')) h from fin_journal_entries x where x.created_at < '${t0}'::timestamp`, koreksi_gudang: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from warehouse_corrections x where x.requested_at < '${t0}'::timestamp`, penyesuaian: `select count(*)::int n, md5(coalesce(string_agg(md5((to_jsonb(x) - 'origin_type' - 'origin_id')::text), '' order by x.id),'')) h from stock_adjustment_requests x where x.created_at < '${t0}'::timestamp and x.updated_at < '${t0}'::timestamp`, material_issue: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from material_issues x where x.created_at < '${t0}'::timestamp and x.updated_at < '${t0}'::timestamp`, bahan: `select count(*)::int n, md5(coalesce(string_agg(md5(to_jsonb(x)::text), '' order by x.id),'')) h from materials x where x.created_at < '${t0}'::timestamp`, pemakaian_sementara: `select count(*)::int n, md5(coalesce(string_agg(x.id::text, '' order by x.id),'')) h from unit_provisional_usages x where x.recorded_at < '${t0}'::timestamp` }[k];
      const r = (await prisma.$queryRawUnsafe(q))[0]; now[k] = { n: Number(r.n), h: r.h }; cek(`sidik jari ${k} (data sebelum T0) identik sebelum vs sesudah impor`, now[k].n === v.n && now[k].h === v.h, `${v.n} baris`);
    }
    cek("254 ISSUE lama tetap 254 dan tidak digandakan", await hitung(`select count(*)::int n from stock_movements where type = 'ISSUE' and note like 'Impor pemakaian Sept 2026%'`) === 254);
    const lamaIds = new Set((await prisma.stockMovement.findMany({ where: { type: "ISSUE", note: { startsWith: "Impor pemakaian Sept 2026" } }, select: { id: true } })).map((x) => x.id));
    const ref = (await prisma.unitUsageNote.findMany({ where: { origin: "LEDGER" }, select: { stockMovementId: true } })).map((x) => x.stockMovementId);
    cek("setiap referensi LEDGER menunjuk ISSUE lama yang unik (tanpa pergerakan baru)", ref.length === new Set(ref).size && ref.every((id) => lamaIds.has(id)), `${ref.length}`);
    // idempoten: impor ulang = nol perubahan (baca-saja)
    const r2 = await cat.rencanakanImpor(prisma, { csvText: m.csvText, namaBerkas: NAMA_BERKAS }); const ada = new Set((await prisma.unitUsageNote.findMany({ select: { sourceKey: true } })).map((x) => x.sourceKey));
    const kurang = [...r2.drafs.map((d) => d.key), ...r2.ledger.map((l) => l.key)].filter((k) => !ada.has(k)); cek("impor ulang berkas yang sama = NOL perubahan (semua kunci sudah ada)", kurang.length === 0, `${kurang.length} kunci belum ada`);
    console.log(`SESUDAH_HASIL gagal=${gagal}`); process.exitCode = gagal ? 1 : 0; return;
  }
  throw new Error("mode tidak dikenal: " + MODE);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
