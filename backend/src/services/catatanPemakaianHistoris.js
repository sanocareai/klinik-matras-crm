// CATATAN PEMAKAIAN HISTORIS (Okt 2026) — impor idempoten, klasifikasi, evaluasi ulang, dan bacaan untuk Produksi.
//
// Aturan produk (keputusan Owner):
//  • Berkas (CSV Admin Sales) = sumber catatan historis. Nilai ASLI disimpan apa adanya (raw_*, tidak bisa diubah); angka janggal TIDAK diperbaiki otomatis — hanya diberi penanda "Perlu dicek" + catatan singkat.
//  • Semua order yang punya baris bahan di berkas menampilkan catatannya di Produksi, walau sebagian belum/tidak bisa menjadi pengeluaran stok. Catatan yang SUDAH sama dengan pengeluaran stok lama ditautkan (tidak digandakan).
//  • Layanan ini TIDAK menulis stock_movements, Material Issue, saldo, biaya, atau jurnal. Perubahan keadaan selalu menulis peristiwa append-only (sebelum–sesudah, alasan, pelaku, waktu).
//  • Impor ulang berkas yang sama = nol perubahan (kunci sumber = hash isi baris + urutan kemunculan).
import {
  bacaCsvPemakaian, kunciSumber, sha256, angkaId, tanggalId, awalHariWIB, satuanBaku, petakanBahan, FLAG, STATE, SUMBER_EXCEL, flagMemblok, catatanSingkat,
  KOMPONEN_LAMA_RE, petunjukKemasanKg, normNama, r4, labelState,
} from "../lib/domain/pemakaianHistoris.js";

export class CatatanError extends Error {
  constructor(message, statusCode = 400, code = "CATATAN_TIDAK_VALID", extra = {}) { super(message); this.statusCode = statusCode; this.code = code; Object.assign(this, extra); }
}
const EPS = 1e-4;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const NOTE_IMPOR_LAMA = "Impor pemakaian Sept 2026"; // impor lama (254 ISSUE); BUKAN "Impor pemakaian historis…" (posting terpadu)
const FIXED = new Set([STATE.DIPOSTING, STATE.BUKAN_STOK, STATE.TIDAK_DIHITUNG, STATE.DIKOREKSI]);

// ───────────────────────────── konteks (baca-saja) ─────────────────────────────
async function muatKonteks(db, { orderNumbers, unitIds = [], materialIds = [] }) {
  const orders = orderNumbers.length ? await db.order.findMany({ where: { orderNumber: { in: orderNumbers } }, select: { id: true, orderNumber: true, units: { select: { id: true, unitCode: true, status: true } } } }) : [];
  const orderBy = new Map(orders.map((o) => [o.orderNumber, o]));
  const katalog = await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true, kind: true } });
  const idUnit = [...new Set([...unitIds, ...orders.flatMap((o) => o.units.map((u) => u.id))])];
  const pakai = idUnit.length ? await db.stockMovement.findMany({ where: { unitId: { in: idUnit }, type: { in: ["ISSUE", "RETURN"] } }, select: { id: true, unitId: true, materialId: true, type: true, qty: true, createdAt: true, note: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }) : [];
  const lama = await db.stockMovement.findMany({ where: { type: "ISSUE", note: { startsWith: NOTE_IMPOR_LAMA }, unitId: { not: null } }, select: { id: true, unitId: true, materialId: true, type: true, qty: true, createdAt: true, note: true, unit: { select: { unitCode: true, order: { select: { orderNumber: true } } } } } });
  return { orderBy, katalog, katalogById: new Map(katalog.map((m) => [m.id, m])), pakai, lama, materialIds };
}
async function muatGarisWaktu(db, materialIds) {
  const ev = new Map();
  if (!materialIds.length) return ev;
  const rows = await db.stockMovement.findMany({ where: { materialId: { in: materialIds } }, select: { materialId: true, qty: true, createdAt: true } });
  for (const m of rows) (ev.get(m.materialId) ?? ev.set(m.materialId, []).get(m.materialId)).push({ d: wibTgl(m.createdAt), q: Number(m.qty) });
  return ev;
}
const urut = (l) => [...l].sort((a, b) => a.d.localeCompare(b.d) || b.q - a.q);
function garis(l) { let run = 0; let min = 0; let at = null; for (const e of urut(l)) { run = r4(run + e.q); if (run < min - 1e-9) { min = run; at = e.d; } } return { min, fin: run, at }; }
const saldoSd = (l, d) => r4(l.filter((e) => e.d <= d).reduce((s, e) => s + e.q, 0));

// ───────────────────────────── klasifikasi ─────────────────────────────
/**
 * Item = bentuk seragam untuk draf impor DAN catatan yang sudah ada:
 *  { key, origin, orderNumber, orderFound, units:[{id}], unitId, rawName, rawSpec, rawQty, rawUom, kategori, qty, uom, usedAt, materialId, via, dupKey, tetap? }
 * Mengembalikan Map(key → { state, flags, linkKind, stockMovementId, linkIds }). Tidak menulis apa pun.
 */
function klasifikasi(items, ctx, garisWaktu, { sekarang = new Date() } = {}) {
  const hasil = new Map(); const excel = items.filter((i) => i.origin === "EXCEL");
  // 1) penanda tingkat baris
  const dupHitung = new Map(); for (const i of excel) if (i.dupKey) dupHitung.set(i.dupKey, (dupHitung.get(i.dupKey) ?? 0) + 1);
  for (const i of excel) {
    const flags = []; const m = i.materialId ? ctx.katalogById.get(i.materialId) : null;
    const qtyRaw = angkaId(i.rawQty);
    if (i.tetap) { hasil.set(i.key, { state: i.tetap, flags: [], linkKind: null, stockMovementId: null }); continue; }
    if (qtyRaw.jenis === "angka" && qtyRaw.v === 0) { hasil.set(i.key, { state: STATE.TIDAK_DIHITUNG, flags: [FLAG.QTY_NOL()], linkKind: null, stockMovementId: null }); continue; }
    if (!m && KOMPONEN_LAMA_RE.test(i.rawName ?? "")) { hasil.set(i.key, { state: STATE.BUKAN_STOK, flags: [FLAG.KOMPONEN_LAMA()], linkKind: null, stockMovementId: null }); continue; }
    if (!i.orderFound) flags.push(FLAG.ORDER_TIDAK_ADA({ orderNumber: i.orderNumber }));
    else if (!i.unitId) flags.push(FLAG.UNIT_TIDAK_PASTI({ jumlahUnit: i.units.length }));
    if (i.qty === null || i.qty === undefined || !(Number(i.qty) > 0)) flags.push(FLAG.QTY_TIDAK_VALID({ rawQty: i.rawQty }));
    if (!i.usedAt) flags.push(FLAG.TANGGAL_TIDAK_VALID({ rawDate: i.rawDate }));
    if (!m) { const g = i.pemetaan; flags.push(g?.galat === "BAHAN_GANDA" ? FLAG.BAHAN_GANDA({ rawName: i.rawName, kandidat: g.kandidat }) : FLAG.NAMA_TIDAK_DI_KATALOG({ rawName: i.rawName, kandidat: g?.kandidat ?? [] })); }
    else {
      if (!m.active) flags.push(FLAG.BAHAN_NONAKTIF({ kode: m.code }));
      if (!i.uom) flags.push(FLAG.SATUAN_TAK_DIKENAL({ rawUom: i.rawUom }));
      else if (i.uom !== m.unit) flags.push(FLAG.SATUAN_BEDA_MASTER({ rawUom: i.rawUom, rawQty: i.rawQty, masterUom: m.unit, kemasanKg: petunjukKemasanKg(m.name) }));
    }
    if ((dupHitung.get(i.dupKey) ?? 0) > 1) flags.push(FLAG.BARIS_BERULANG({ jumlah: dupHitung.get(i.dupKey) }));
    if (/komplain/i.test(i.kategori ?? "")) flags.push(FLAG.KATEGORI_KOMPLAIN());
    // penanda yang SUDAH dikonfirmasi orang (mis. baris berulang memang sah) tidak muncul lagi sebagai penahan
    const konfirm = new Set(i.dikonfirmasi ?? []);
    hasil.set(i.key, { state: STATE.PERLU_DICEK, flags: flags.filter((f) => !konfirm.has(f.kode)), linkKind: null, stockMovementId: null });
  }
  // 2) kelompok unit × bahan terhadap pergerakan stok yang ADA (ISSUE − RETURN bertaut unit)
  const kel = new Map();
  const tetapPosting = new Map(); // catatan yang SUDAH jadi pengeluaran stok: ikut dijumlahkan (ledger memuatnya), tidak dinilai ulang
  for (const i of excel) { const h = hasil.get(i.key); if (!i.unitId || !i.materialId) continue; const kk = `${i.unitId}|${i.materialId}`; if (h.state === STATE.DIPOSTING) { tetapPosting.set(kk, (tetapPosting.get(kk) ?? 0) + Number(i.qty ?? 0)); if (!kel.has(kk)) kel.set(kk, []); continue; } if (FIXED.has(h.state)) continue; (kel.get(kk) ?? kel.set(kk, []).get(kk)).push(i); }
  const adaDiExcel = new Set(); for (const k of kel.keys()) adaDiExcel.add(k);
  const pakaiPer = new Map(); for (const m of ctx.pakai) (pakaiPer.get(`${m.unitId}|${m.materialId}`) ?? pakaiPer.set(`${m.unitId}|${m.materialId}`, []).get(`${m.unitId}|${m.materialId}`)).push(m);
  const calon = [];
  for (const [k, isi] of kel) {
    const mv = pakaiPer.get(k) ?? []; const adaIssue = mv.some((m) => m.type === "ISSUE");
    if (!isi.length) continue;
    const mat = ctx.katalogById.get(isi[0].materialId);
    const jumlah = r4(isi.reduce((s, i) => s + Number(i.qty ?? 0), 0) + (tetapPosting.get(k) ?? 0));
    if (adaIssue) {
      const net = r4(-mv.reduce((s, m) => s + Number(m.qty), 0)); const pertama = mv.find((m) => m.type === "ISSUE");
      const satuanBeda = isi.some((i) => hasil.get(i.key).flags.some((f) => f.kode === "SATUAN_BEDA_MASTER" || f.kode === "SATUAN_TAK_DIKENAL"));
      if (!satuanBeda && Math.abs(jumlah - net) <= EPS) {
        for (const i of isi) hasil.set(i.key, { state: STATE.TERCATAT_DI_STOK, flags: hasil.get(i.key).flags.filter((f) => f.tingkat === "INFO"), linkKind: "ISSUE_LAMA_SAMA", stockMovementId: pertama.id, linkIds: mv.map((m) => m.id) });
      } else if (satuanBeda) {
        const f = FLAG.ISSUE_LAMA_SATUAN_BEDA({ ledger: net, rawQty: isi.map((i) => i.rawQty).join(" + "), rawUom: isi[0].rawUom, masterUom: mat.unit });
        for (const i of isi) { const h = hasil.get(i.key); h.flags.push(f); h.linkKind = "ISSUE_LAMA_BEDA"; h.linkIds = mv.map((m) => m.id); }
      } else {
        const f = FLAG.ISSUE_LAMA_BERBEDA({ ledger: net, excel: jumlah, satuan: mat.unit });
        for (const i of isi) { const h = hasil.get(i.key); h.flags.push(f); h.linkKind = "ISSUE_LAMA_BEDA"; h.linkIds = mv.map((m) => m.id); }
      }
    } else calon.push({ k, isi, mat, jumlah });
  }
  // 3) pergerakan ISSUE lama (impor) yang tidak punya pasangan di berkas → catatan LEDGER; unit yang terkena menahan calon lain
  const unitTertahan = new Set(); const ledgerBaru = [];
  for (const m of ctx.lama) {
    const k = `${m.unitId}|${m.materialId}`; if (adaDiExcel.has(k)) continue;
    const ordNo = m.unit?.order?.orderNumber ?? null; const mat = ctx.katalogById.get(m.materialId);
    const sudahPunyaExcel = items.some((i) => i.origin === "EXCEL" && i.unitId === m.unitId);
    const net = r4(-(pakaiPer.get(k) ?? []).reduce((s, x) => s + Number(x.qty), 0));
    ledgerBaru.push({ key: `LEDGER:${m.id}`, origin: "LEDGER", orderNumber: ordNo, unitId: m.unitId, materialId: m.materialId, stockMovementId: m.id, qty: net, uom: mat?.unit, usedAt: m.createdAt, flags: [FLAG.ISSUE_TANPA_PASANGAN({ qty: Number(-Number(m.qty)), satuan: mat?.unit, ordeAdaDiExcel: sudahPunyaExcel })] });
    unitTertahan.add(m.unitId);
  }
  for (const l of ledgerBaru) { if (!hasil.has(l.key)) hasil.set(l.key, { state: STATE.PERLU_DICEK, flags: l.flags, linkKind: "ISSUE_TANPA_PASANGAN", stockMovementId: l.stockMovementId, ledger: l }); }
  // 4) calon pengeluaran stok: urut tanggal → simulasi garis waktu di atas ledger APA ADANYA
  const garisMat = new Map(); const mulai = (id) => { if (!garisMat.has(id)) garisMat.set(id, [...(garisWaktu.get(id) ?? [])]); return garisMat.get(id); };
  const urutan = calon.map((c) => ({ ...c, tgl: wibTgl(c.isi.map((i) => i.usedAt).filter(Boolean).sort((a, b) => a - b)[0] ?? sekarang) })).sort((a, b) => a.tgl.localeCompare(b.tgl) || (a.isi[0].orderNumber ?? "").localeCompare(b.isi[0].orderNumber ?? "") || a.mat.code.localeCompare(b.mat.code));
  for (const c of urutan) {
    const adaBlok = c.isi.some((i) => flagMemblok(hasil.get(i.key).flags));
    if (adaBlok) continue;
    if (unitTertahan.has(c.isi[0].unitId)) { for (const i of c.isi) hasil.get(i.key).flags.push(FLAG.BERGANTUNG_ISSUE_LAMA()); continue; }
    const L = mulai(c.mat.id); const awalAda = (garisWaktu.get(c.mat.id) ?? []).length > 0;
    let flag = null;
    if (!awalAda) flag = FLAG.TANPA_SALDO_PEMBUKA();
    else {
      const sblm = garis(L); const uji = garis([...L, { d: c.tgl, q: -c.jumlah }]);
      if (uji.min >= -1e-6) { L.push({ d: c.tgl, q: -c.jumlah }); }
      else if (sblm.min < -1e-6) flag = FLAG.SALDO_NEGATIF({ minimum: sblm.min, tanggal: sblm.at });
      else if (uji.fin >= -1e-6) flag = FLAG.MENDAHULUI_GR({ tanggal: c.tgl, saldo: saldoSd(L, c.tgl), butuh: c.jumlah });
      else flag = FLAG.SALDO_TIDAK_CUKUP({ butuh: c.jumlah, saldoAkhir: sblm.fin });
    }
    for (const i of c.isi) {
      const h = hasil.get(i.key);
      if (flag) h.flags.push(flag); else { h.state = STATE.SIAP_POSTING; h.saldo = { tanggal: c.tgl }; }
    }
  }
  return hasil;
}

// ───────────────────────────── bentuk draf dari CSV ─────────────────────────────
function susunDraf(parsed, ctx) {
  const kemunculan = new Map(); const drafs = [];
  const dupHitung = new Map();
  for (const b of parsed.baris) { const dk = [b.order, normNama(b.nama), normNama(b.spek), b.qtyTeks, normNama(b.satuan)].join("|"); dupHitung.set(dk, (dupHitung.get(dk) ?? 0) + 1); }
  for (const b of parsed.baris) {
    const dasar = [b.order, normNama(b.nama), normNama(b.spek), b.qtyTeks, normNama(b.satuan), normNama(b.kategori), b.tglTeks].join("|");
    const n = (kemunculan.get(dasar) ?? 0) + 1; kemunculan.set(dasar, n);
    const order = ctx.orderBy.get(b.order); const units = order?.units ?? [];
    const peta = b.nama ? petakanBahan({ nama: b.nama, spek: b.spek }, ctx.katalog) : { galat: "NAMA_TIDAK_DI_KATALOG", kandidat: [] };
    const q = angkaId(b.qtyTeks); const iso = tanggalId(b.tglTeks);
    const dk = [b.order, normNama(b.nama), normNama(b.spek), b.qtyTeks, normNama(b.satuan)].join("|");
    drafs.push({
      key: kunciSumber(b, n), origin: "EXCEL", sourceRow: b.baris, orderNumber: b.order, orderFound: !!order, orderId: order?.id ?? null, units, unitId: units.length === 1 ? units[0].id : null,
      rawName: b.nama, rawSpec: b.spek, rawQty: b.qtyTeks, rawUom: b.satuan, kategori: b.kategori, rawCategory: b.kategori, rawDate: b.tglTeks, rawMonth: b.bulan, rawPic: b.pic, rawQc: b.ket, rawPrice: b.hargaTeks, rawTotal: b.totalTeks, rawRow: b.raw,
      qty: q.jenis === "angka" ? q.v : null, uom: satuanBaku(b.satuan), usedAt: iso ? awalHariWIB(iso) : null, materialId: peta.bahan?.id ?? null, via: peta.via ?? null, pemetaan: peta, dupKey: dupHitung.get(dk) > 1 ? dk : null,
    });
  }
  return drafs;
}

// ───────────────────────────── rencana impor (baca-saja) ─────────────────────────────
/** Susun rencana impor TANPA menulis apa pun: draf catatan + klasifikasi + laporan kejanggalan. */
export async function rencanakanImpor(db, { csvText, namaBerkas = "pemakaian.csv", sekarang = new Date() }) {
  const parsed = bacaCsvPemakaian(csvText);
  const orderNumbers = [...new Set(parsed.baris.map((b) => b.order))];
  const ctx = await muatKonteks(db, { orderNumbers });
  const drafs = susunDraf(parsed, ctx);
  const idMat = [...new Set([...drafs.map((d) => d.materialId), ...ctx.lama.map((m) => m.materialId)].filter(Boolean))];
  const gw = await muatGarisWaktu(db, idMat);
  const klas = klasifikasi(drafs, ctx, gw, { sekarang });
  const ledger = [...klas.entries()].filter(([k]) => k.startsWith("LEDGER:")).map(([k, v]) => ({ key: k, ...v }));
  return { sha256: sha256(Buffer.from(csvText, "utf8")), namaBerkas, parsed, drafs, klas, ledger, ctx, gw };
}
function ringkasRencana(r) {
  const state = {}; const flag = {}; const orderPer = new Map();
  for (const d of r.drafs) { const h = r.klas.get(d.key); state[h.state] = (state[h.state] ?? 0) + 1; for (const f of h.flags) flag[f.kode] = (flag[f.kode] ?? 0) + 1; const o = orderPer.get(d.orderNumber) ?? new Set(); o.add(h.state); orderPer.set(d.orderNumber, o); }
  for (const l of r.ledger) { state[`LEDGER_${l.state}`] = (state[`LEDGER_${l.state}`] ?? 0) + 1; for (const f of l.flags) flag[f.kode] = (flag[f.kode] ?? 0) + 1; }
  return { barisCsv: r.parsed.baris.length, tanpaOrder: r.parsed.tanpaOrder.length, orderUnik: orderPer.size, state, flag };
}
export { ringkasRencana };

// ───────────────────────────── terapkan impor (menulis HANYA tabel catatan) ─────────────────────────────
/** Impor idempoten: batch dicari lewat sidik jari berkas; catatan yang kuncinya sudah ada TIDAK diubah/ditulis ulang. Mengembalikan jumlah dibuat/dilewati. */
export async function terapkanImpor(prisma, rencana, { actorId = null } = {}) {
  const { sha256: sha, namaBerkas, drafs, klas, ledger } = rencana;
  return prisma.$transaction(async (tx) => {
    let batch = await tx.usageImportBatch.findUnique({ where: { sourceKind_fileSha256: { sourceKind: SUMBER_EXCEL, fileSha256: sha } } });
    const batchBaru = !batch;
    if (!batch) batch = await tx.usageImportBatch.create({ data: { sourceKind: SUMBER_EXCEL, fileName: namaBerkas, fileSha256: sha, rowCount: rencana.parsed.baris.length, summary: ringkasRencana(rencana), createdById: actorId } });
    const ada = new Set((await tx.unitUsageNote.findMany({ where: { sourceKey: { in: [...drafs.map((d) => d.key), ...ledger.map((l) => l.key)] } }, select: { sourceKey: true } })).map((n) => n.sourceKey));
    let dibuat = 0; let dilewati = 0; const pesan = (h) => ({ state: h.state, flags: h.flags.map((f) => f.kode) });
    for (const d of drafs) {
      if (ada.has(d.key)) { dilewati++; continue; }
      const h = klas.get(d.key);
      const note = await tx.unitUsageNote.create({ data: {
        batchId: batch.id, origin: "EXCEL", sourceKey: d.key, sourceRow: d.sourceRow, orderNumber: d.orderNumber, orderId: d.orderId, unitId: d.unitId,
        rawName: d.rawName, rawSpec: d.rawSpec, rawQty: d.rawQty, rawUom: d.rawUom, rawCategory: d.rawCategory, rawDate: d.rawDate, rawMonth: d.rawMonth, rawPic: d.rawPic, rawQc: d.rawQc, rawPrice: d.rawPrice, rawTotal: d.rawTotal, rawRow: d.rawRow,
        qty: d.qty, uom: d.uom, usedAt: d.usedAt, materialId: d.materialId, mapVia: d.via, state: h.state, flags: h.flags, stockMovementId: h.stockMovementId ?? null, linkKind: h.linkKind ?? null, evaluatedAt: new Date(),
      } });
      await tx.unitUsageNoteEvent.create({ data: { noteId: note.id, kind: "IMPOR", before: null, after: pesan(h), reason: `Impor ${namaBerkas} baris ${d.sourceRow}`, actorId } });
      if (h.state === STATE.TERCATAT_DI_STOK) await tx.unitUsageNoteEvent.create({ data: { noteId: note.id, kind: "DITAUTKAN", before: null, after: { stockMovementIds: h.linkIds ?? [h.stockMovementId], jenis: h.linkKind }, reason: "Sama dengan pengeluaran stok yang sudah ada — tidak digandakan", actorId } });
      dibuat++;
    }
    for (const l of ledger) {
      if (ada.has(l.key)) { dilewati++; continue; }
      const it = l.ledger; const mv = await tx.stockMovement.findUnique({ where: { id: it.stockMovementId }, select: { unitId: true, materialId: true, createdAt: true, unit: { select: { order: { select: { id: true, orderNumber: true } } } } } });
      const note = await tx.unitUsageNote.create({ data: {
        batchId: batch.id, origin: "LEDGER", sourceKey: l.key, orderNumber: mv.unit?.order?.orderNumber ?? it.orderNumber ?? "(tanpa order)", orderId: mv.unit?.order?.id ?? null, unitId: mv.unitId,
        qty: it.qty, uom: it.uom, usedAt: mv.createdAt, materialId: mv.materialId, mapVia: "PERGERAKAN_STOK", state: l.state, flags: l.flags, stockMovementId: it.stockMovementId, linkKind: "ISSUE_TANPA_PASANGAN", evaluatedAt: new Date(),
      } });
      await tx.unitUsageNoteEvent.create({ data: { noteId: note.id, kind: "IMPOR", before: null, after: pesan(l), reason: `Pengeluaran stok lama tanpa pasangan di ${namaBerkas}`, actorId } });
      dibuat++;
    }
    return { batchId: batch.id, batchBaru, dibuat, dilewati };
  }, { maxWait: 20_000, timeout: 120_000 });
}

// ───────────────────────────── evaluasi ulang (setelah koreksi/posting/penerimaan) ─────────────────────────────
/** JSON stabil (kunci terurut) — jsonb Postgres mengurutkan ulang kunci, jadi perbandingan penanda tidak boleh bergantung urutan kunci. */
const stabil = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const noteKeItem = (n, units) => ({
  key: n.sourceKey, origin: n.origin, orderNumber: n.orderNumber, orderFound: !!n.orderId, units, unitId: n.unitId, rawName: n.rawName, rawSpec: n.rawSpec, rawQty: n.rawQty, rawUom: n.rawUom, kategori: n.rawCategory,
  qty: n.qty === null ? null : Number(n.qty), uom: n.uom, usedAt: n.usedAt, materialId: n.materialId, via: n.mapVia, dupKey: null, tetap: FIXED.has(n.state) ? n.state : null, id: n.id, dikonfirmasi: Array.isArray(n.confirmedFlags) ? n.confirmedFlags : [],
});
/** Hitung ulang keadaan catatan yang belum final terhadap ledger SEKARANG. Menulis peristiwa DIEVALUASI hanya bila state/penanda berubah. Idempoten. */
export async function evaluasiUlang(prisma, { actorId = null, unitIds = null, sekarang = new Date() } = {}) {
  const notes = await prisma.unitUsageNote.findMany({ where: { origin: "EXCEL", ...(unitIds ? { unitId: { in: unitIds } } : {}) }, orderBy: { sourceRow: "asc" } });
  if (!notes.length) return { diperiksa: 0, berubah: 0 };
  const ledgerNotes = await prisma.unitUsageNote.findMany({ where: { origin: "LEDGER", state: STATE.PERLU_DICEK, ...(unitIds ? { unitId: { in: unitIds } } : {}) } });
  const ctx = await muatKonteks(prisma, { orderNumbers: [...new Set(notes.map((n) => n.orderNumber))], unitIds: ledgerNotes.map((l) => l.unitId).filter(Boolean) });
  // baris berulang dihitung dari nilai asli (tidak bergantung koreksi)
  const dk = (n) => [n.orderNumber, normNama(n.rawName), normNama(n.rawSpec), n.rawQty, normNama(n.rawUom)].join("|");
  const hit = new Map(); for (const n of notes) { if (n.state === STATE.TIDAK_DIHITUNG) continue; hit.set(dk(n), (hit.get(dk(n)) ?? 0) + 1); } // baris yang sudah dikecualikan tidak lagi dihitung berulang
  const items = notes.map((n) => { const it = noteKeItem(n, ctx.orderBy.get(n.orderNumber)?.units ?? []); if ((hit.get(dk(n)) ?? 0) > 1) it.dupKey = dk(n); if (!n.materialId && n.rawName) it.pemetaan = petakanBahan({ nama: n.rawName, spek: n.rawSpec }, ctx.katalog); return it; });
  const idMat = [...new Set([...items.map((i) => i.materialId), ...ctx.lama.map((m) => m.materialId)].filter(Boolean))];
  const gw = await muatGarisWaktu(prisma, idMat);
  const klas = klasifikasi(items, ctx, gw, { sekarang });
  let berubah = 0; const detail = [];
  for (const n of notes) {
    if (FIXED.has(n.state)) continue;
    const h = klas.get(n.sourceKey); if (!h) continue;
    const sama = h.state === n.state && stabil(h.flags.map((f) => [f.kode, f.data])) === stabil((n.flags ?? []).map((f) => [f.kode, f.data])) && (h.stockMovementId ?? null) === (n.stockMovementId ?? null);
    if (sama) continue;
    detail.push({ baris: n.sourceRow, dari: { state: n.state, flags: (n.flags ?? []).map((f) => f.kode) }, ke: { state: h.state, flags: h.flags.map((f) => f.kode) } });
    await prisma.$transaction(async (tx) => {
      await tx.unitUsageNote.update({ where: { id: n.id }, data: { state: h.state, flags: h.flags, linkKind: h.linkKind ?? n.linkKind, stockMovementId: n.stockMovementId ?? h.stockMovementId ?? null, evaluatedAt: new Date() } });
      await tx.unitUsageNoteEvent.create({ data: { noteId: n.id, kind: "DIEVALUASI", before: { state: n.state, flags: (n.flags ?? []).map((f) => f.kode) }, after: { state: h.state, flags: h.flags.map((f) => f.kode) }, reason: "Evaluasi ulang terhadap ledger", actorId } });
    });
    berubah++;
  }
  // Catatan LEDGER (pengeluaran stok lama tanpa pasangan): selesai bila pemakaiannya dikoreksi menjadi 0 atau kini punya pasangan di berkas.
  const net = (u, m) => r4(-ctx.pakai.filter((x) => x.unitId === u && x.materialId === m).reduce((s, x) => s + Number(x.qty), 0));
  for (const l of ledgerNotes) {
    const adaPasangan = items.some((i) => i.unitId === l.unitId && i.materialId === l.materialId);
    const habis = net(l.unitId, l.materialId) <= EPS;
    if (!habis && !adaPasangan) continue;
    const alasan = habis ? "Pemakaian bahan ini pada unit sudah dikoreksi menjadi 0" : "Pengeluaran stok ini kini punya pasangan di berkas (dinilai pada catatan Excel)";
    await prisma.$transaction(async (tx) => {
      await tx.unitUsageNote.update({ where: { id: l.id }, data: { state: STATE.DIKOREKSI, evaluatedAt: new Date() } });
      await tx.unitUsageNoteEvent.create({ data: { noteId: l.id, kind: "DIEVALUASI", before: { state: l.state }, after: { state: STATE.DIKOREKSI }, reason: alasan, actorId } });
    });
    berubah++; detail.push({ ledger: l.id, ke: STATE.DIKOREKSI, alasan });
  }
  return { diperiksa: notes.length + ledgerNotes.length, berubah, detail };
}

// ───────────────────────────── bacaan untuk Produksi ─────────────────────────────
const tampilNote = (n, mat, mv) => ({
  id: n.id, origin: n.origin, sumber: n.origin === "EXCEL" ? "Excel Admin Sales" : "Pengeluaran stok lama", baris: n.sourceRow,
  nama: n.rawName ?? mat?.name ?? null, spesifikasi: n.rawSpec || null, kategori: n.rawCategory || null,
  qtyAsli: n.rawQty ?? null, satuanAsli: n.rawUom ?? null, qty: n.qty === null ? null : Number(n.qty), satuan: n.uom ?? null, tanggal: n.usedAt,
  bahan: mat ? { id: mat.id, kode: mat.code, nama: mat.name, satuan: mat.unit } : null,
  state: n.state, label: labelState(n.state), perluDicek: n.state === STATE.PERLU_DICEK, flags: n.flags ?? [], catatan: catatanSingkat(n.flags),
  pergerakan: mv ? { id: mv.id, ref: `MV-${mv.id.slice(0, 8).toUpperCase()}`, tanggal: mv.createdAt } : null, linkKind: n.linkKind, evaluatedAt: n.evaluatedAt,
});
/** Catatan historis satu unit untuk Bahan/Ringkasan/Riwayat/Excel. Nilai asli tampil apa adanya. Catatan jumlah 0 disembunyikan dari daftar (tetap dihitung di ringkasan). */
export async function ambilCatatanHistoris(db, unitId) {
  const rows = await db.unitUsageNote.findMany({ where: { unitId }, orderBy: [{ origin: "asc" }, { sourceRow: "asc" }, { createdAt: "asc" }], include: { material: { select: { id: true, code: true, name: true, unit: true } }, stockMovement: { select: { id: true, createdAt: true } } } });
  const items = rows.filter((n) => n.state !== STATE.TIDAK_DIHITUNG).map((n) => tampilNote(n, n.material, n.stockMovement));
  const hitung = (s) => rows.filter((n) => n.state === s).length;
  const urutPrioritas = { PERLU_DICEK: 0, SIAP_POSTING: 1, DIPOSTING: 2, TERCATAT_DI_STOK: 3, DIKOREKSI: 4, BUKAN_STOK: 5 };
  items.sort((a, b) => (urutPrioritas[a.state] ?? 9) - (urutPrioritas[b.state] ?? 9));
  return { items, ringkas: { total: rows.length, ditampilkan: items.length, perluDicek: hitung(STATE.PERLU_DICEK), siapPosting: hitung(STATE.SIAP_POSTING), tercatatDiStok: hitung(STATE.TERCATAT_DI_STOK), diposting: hitung(STATE.DIPOSTING), bukanStok: hitung(STATE.BUKAN_STOK), dikoreksi: hitung(STATE.DIKOREKSI), tidakDihitung: hitung(STATE.TIDAK_DIHITUNG) } };
}
/** Ringkasan per unit untuk banyak unit sekaligus (daftar Order Produksi + Excel). */
export async function ringkasCatatanUnits(db, unitIds) {
  const out = new Map(); if (!unitIds?.length) return out;
  const g = await db.unitUsageNote.groupBy({ by: ["unitId", "state"], where: { unitId: { in: unitIds } }, _count: { _all: true } });
  for (const r of g) { const o = out.get(r.unitId) ?? { total: 0, perluDicek: 0, siapPosting: 0, tercatatDiStok: 0, diposting: 0 }; o.total += r._count._all; if (r.state === "PERLU_DICEK") o.perluDicek = r._count._all; if (r.state === "SIAP_POSTING") o.siapPosting = r._count._all; if (r.state === "TERCATAT_DI_STOK") o.tercatatDiStok = r._count._all; if (r.state === "DIPOSTING") o.diposting = r._count._all; out.set(r.unitId, o); }
  return out;
}
/** Peristiwa catatan untuk Riwayat Order Produksi (sebelum–sesudah dengan pelaku). Peristiwa IMPOR/DIEVALUASI diringkas, bukan satu per baris. */
export async function riwayatCatatanUnit(db, unitId) {
  const ev = await db.unitUsageNoteEvent.findMany({ where: { note: { unitId } }, orderBy: { createdAt: "asc" }, include: { note: { select: { rawName: true, orderNumber: true, material: { select: { code: true, name: true } } } } } });
  const ids = [...new Set(ev.map((e) => e.actorId).filter(Boolean))];
  const nama = ids.length ? new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();
  const impor = ev.filter((e) => e.kind === "IMPOR");
  const out = [];
  if (impor.length) out.push({ kind: "CATATAN_HISTORIS", sumber: "CATATAN_HISTORIS", at: impor[0].createdAt, actor: nama.get(impor[0].actorId) ?? null, label: `Catatan pemakaian historis dari Excel Admin Sales dimuat: ${impor.length} catatan (bukan pengeluaran stok baru).` });
  for (const e of ev.filter((x) => ["DIKOREKSI", "DIPOSTING", "DIKECUALIKAN", "DITAUTKAN"].includes(x.kind))) {
    const bahan = e.note.material?.name ?? e.note.rawName ?? "bahan";
    out.push({ kind: `CATATAN_${e.kind}`, sumber: "CATATAN_HISTORIS", at: e.createdAt, actor: nama.get(e.actorId) ?? null, label: `Catatan pemakaian ${bahan}: ${e.kind === "DIKOREKSI" ? "dikoreksi" : e.kind === "DIPOSTING" ? "dijadikan pengeluaran stok" : e.kind === "DITAUTKAN" ? "ditautkan ke pengeluaran stok yang sudah ada" : "dikecualikan"}${e.reason ? ` — ${e.reason}` : ""}`, before: e.before, after: e.after });
  }
  return out;
}
