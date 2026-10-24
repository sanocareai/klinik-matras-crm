// KOREKSI PEMAKAIAN (Okt 2026) — alur koreksi yang mudah dan berjejak untuk rekonsiliasi pemakaian bahan per order.
//
// Tiga jenis koreksi, SEMUA menyimpan nilai sebelum–sesudah, alasan, pelaku, waktu, dan hubungan ke transaksi asal. Tidak ada yang menimpa data lama:
//  1) Koreksi CATATAN historis (nilai teruraikan: jumlah/satuan/bahan/tanggal) — tidak mengubah stok. Nilai asli berkas tetap utuh (trigger). Peristiwa DIKOREKSI di unit_usage_note_events.
//  2) Koreksi PEMAKAIAN per order (efek stok): memakai tabel koreksi Gudang yang SUDAH ada (warehouse_corrections, doc_type UNIT_USAGE). Pemohon ≠ penyetuju (izin inventory:adjustment_approve),
//     lalu pergerakan pembalik/selisih (RETURN atau ISSUE bertaut unit, correctsMovementId → pemakaian asal) ditulis lewat postStockMovement: kunci bahan + invarian saldo tidak negatif.
//     Pergerakan asal TIDAK diubah/dihapus. Koreksi berulang diperbolehkan (setiap koreksi dihitung terhadap pemakaian bersih saat itu).
//  3) Koreksi SALDO bahan: lewat Stock Adjustment (review-gated) yang sudah ada — saldo tidak pernah ditimpa; lihat routes/stockAdjustment.js (penanda asal origin_type/origin_id ditambahkan).
//  Koreksi HARGA/valuasi dipisah: services/finance/koreksiValuasi.js.
import crypto from "node:crypto";
import { MaterialUnit } from "@prisma/client";
import { postStockMovement, lockRowForUpdate } from "./inventoryLedger.js";
import { KoreksiError, STATUS, bentukKoreksi } from "./warehouseCorrection.js";
import { dasarHargaRataRata } from "./finance/posting/inventory.js";
import { evaluasiUlang } from "./catatanPemakaianHistoris.js";
import { STATE, koma } from "../lib/domain/pemakaianHistoris.js";

const TIPE_DOK = "UNIT_USAGE";
const EPS = 1e-6;
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const alasanWajib = (a) => { const t = String(a ?? "").trim(); if (t.length < 5 || t.length > 500) throw new KoreksiError("Alasan koreksi wajib diisi (5–500 karakter)", 400, "ALASAN_WAJIB"); return t; };
const kunciValid = (k) => { const t = String(k ?? ""); if (t.length < 8 || t.length > 120) throw new KoreksiError("Idempotency-Key wajib (8–120 karakter)", 428, "IDEMPOTENCY_KEY_REQUIRED"); return t; };
const UOM_VALID = new Set(Object.values(MaterialUnit));
const FLAG_BOLEH_DIKONFIRMASI = new Set(["BARIS_BERULANG", "KATEGORI_KOMPLAIN"]);
const STATE_BOLEH_DIKOREKSI = new Set([STATE.PERLU_DICEK, STATE.SIAP_POSTING, STATE.TERCATAT_DI_STOK]);

const tampilCatatan = (n) => ({ id: n.id, state: n.state, qty: n.qty === null ? null : Number(n.qty), uom: n.uom, usedAt: n.usedAt, materialId: n.materialId, mapVia: n.mapVia, confirmedFlags: n.confirmedFlags ?? [] });

// ═════════════════════════ 1) KOREKSI CATATAN HISTORIS (tanpa efek stok) ═════════════════════════
async function muatCatatanTerkunci(tx, noteId) {
  await lockRowForUpdate(tx, "unit_usage_notes", noteId);
  const n = await tx.unitUsageNote.findUnique({ where: { id: noteId } });
  if (!n) throw new KoreksiError("Catatan tidak ditemukan", 404, "CATATAN_TIDAK_ADA");
  return n;
}
/** Koreksi nilai teruraikan catatan (jumlah, satuan, bahan, tanggal). Alasan wajib; sebelum–sesudah tercatat; idempoten per kunci; nilai asli berkas tidak berubah. */
export async function koreksiCatatan(prisma, { noteId, perubahan = {}, alasan, kunci, aktor, sekarang = new Date() }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  const hasil = await prisma.$transaction(async (tx) => {
    const n = await muatCatatanTerkunci(tx, noteId);
    const ulang = await tx.unitUsageNoteEvent.findFirst({ where: { noteId, idempotencyKey: idem } });
    if (ulang) return { ulang: true, catatan: tampilCatatan(n), peristiwaId: ulang.id, unitId: n.unitId };
    if (!STATE_BOLEH_DIKOREKSI.has(n.state)) throw new KoreksiError(`Catatan berstatus ${n.state} tidak bisa dikoreksi`, 409, "STATUS_FINAL");
    if (n.origin !== "EXCEL") throw new KoreksiError("Catatan ini berasal dari pengeluaran stok; koreksi lewat Koreksi Pemakaian per order", 409, "BUKAN_CATATAN_EXCEL");
    const data = {}; const sesudah = {};
    const sebelum = { qty: n.qty === null ? null : Number(n.qty), uom: n.uom, usedAt: n.usedAt, materialId: n.materialId };
    if (perubahan.qty !== undefined) { const q = Number(perubahan.qty); if (!Number.isFinite(q) || q <= 0 || q > 1_000_000) throw new KoreksiError("Jumlah koreksi harus angka lebih dari 0", 400, "QTY_TIDAK_VALID"); data.qty = r4(q); sesudah.qty = r4(q); }
    if (perubahan.uom !== undefined) { const u = String(perubahan.uom).trim().toUpperCase(); if (!UOM_VALID.has(u)) throw new KoreksiError(`Satuan "${perubahan.uom}" bukan satuan Gudang`, 400, "SATUAN_TIDAK_VALID"); data.uom = u; sesudah.uom = u; }
    if (perubahan.usedAt !== undefined) { const t = new Date(perubahan.usedAt); if (Number.isNaN(t.getTime())) throw new KoreksiError("Tanggal koreksi tidak valid", 400, "TANGGAL_TIDAK_VALID"); data.usedAt = t; sesudah.usedAt = t; }
    if (perubahan.materialId !== undefined) {
      const m = await tx.material.findUnique({ where: { id: perubahan.materialId }, select: { id: true, active: true, code: true } });
      if (!m) throw new KoreksiError("Bahan katalog tidak ditemukan", 404, "BAHAN_TIDAK_ADA"); if (!m.active) throw new KoreksiError(`Bahan ${m.code} nonaktif`, 409, "BAHAN_NONAKTIF");
      data.materialId = m.id; data.mapVia = "KOREKSI"; sesudah.materialId = m.id;
    }
    const berubah = Object.entries(sesudah).some(([k, v]) => String(v instanceof Date ? v.toISOString() : v) !== String(sebelum[k] instanceof Date ? sebelum[k]?.toISOString() : sebelum[k]));
    if (!berubah) throw new KoreksiError("Tidak ada perubahan dari catatan yang ada", 409, "TIDAK_ADA_PERUBAHAN");
    await tx.unitUsageNote.update({ where: { id: n.id }, data: { ...data, evaluatedAt: sekarang } });
    const ev = await tx.unitUsageNoteEvent.create({ data: { noteId: n.id, kind: "DIKOREKSI", before: sebelum, after: { ...sebelum, ...sesudah }, reason, actorId: aktor.id, idempotencyKey: idem } });
    return { ulang: false, catatan: tampilCatatan(await tx.unitUsageNote.findUnique({ where: { id: n.id } })), peristiwaId: ev.id, unitId: n.unitId };
  }, { timeout: 30_000, maxWait: 10_000 });
  if (!hasil.ulang && hasil.unitId) await evaluasiUlang(prisma, { actorId: aktor.id, unitIds: [hasil.unitId], sekarang });
  return { ...hasil, catatan: tampilCatatan(await prisma.unitUsageNote.findUnique({ where: { id: noteId } })) };
}
/** Konfirmasi bahwa penanda tertentu memang wajar (mis. baris berulang sah). Penanda tidak lagi menahan; nilai asli tidak berubah. */
export async function konfirmasiCatatan(prisma, { noteId, kodePenanda, alasan, kunci, aktor, sekarang = new Date() }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  if (!FLAG_BOLEH_DIKONFIRMASI.has(kodePenanda)) throw new KoreksiError(`Penanda ${kodePenanda} tidak bisa sekadar dikonfirmasi — selesaikan lewat koreksi`, 400, "PENANDA_TIDAK_BISA_DIKONFIRMASI");
  const hasil = await prisma.$transaction(async (tx) => {
    const n = await muatCatatanTerkunci(tx, noteId);
    const ulang = await tx.unitUsageNoteEvent.findFirst({ where: { noteId, idempotencyKey: idem } });
    if (ulang) return { ulang: true, unitId: n.unitId };
    if (!STATE_BOLEH_DIKOREKSI.has(n.state)) throw new KoreksiError(`Catatan berstatus ${n.state} tidak bisa dikonfirmasi`, 409, "STATUS_FINAL");
    const sebelum = Array.isArray(n.confirmedFlags) ? n.confirmedFlags : [];
    if (sebelum.includes(kodePenanda)) throw new KoreksiError("Penanda ini sudah dikonfirmasi", 409, "SUDAH_DIKONFIRMASI");
    await tx.unitUsageNote.update({ where: { id: n.id }, data: { confirmedFlags: [...sebelum, kodePenanda], evaluatedAt: sekarang } });
    await tx.unitUsageNoteEvent.create({ data: { noteId: n.id, kind: "DIKOREKSI", before: { dikonfirmasi: sebelum }, after: { dikonfirmasi: [...sebelum, kodePenanda] }, reason, actorId: aktor.id, idempotencyKey: idem } });
    return { ulang: false, unitId: n.unitId };
  }, { timeout: 30_000, maxWait: 10_000 });
  if (!hasil.ulang && hasil.unitId) await evaluasiUlang(prisma, { actorId: aktor.id, unitIds: [hasil.unitId], sekarang });
  return { ...hasil, catatan: tampilCatatan(await prisma.unitUsageNote.findUnique({ where: { id: noteId } })) };
}
/** Kecualikan catatan dari perhitungan (mis. salinan ganda). Catatan TIDAK dihapus: keadaan TIDAK_DIHITUNG + peristiwa DIKECUALIKAN (alasan wajib). */
export async function kecualikanCatatan(prisma, { noteId, alasan, kunci, aktor, sekarang = new Date() }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  const hasil = await prisma.$transaction(async (tx) => {
    const n = await muatCatatanTerkunci(tx, noteId);
    const ulang = await tx.unitUsageNoteEvent.findFirst({ where: { noteId, idempotencyKey: idem } });
    if (ulang) return { ulang: true, unitId: n.unitId };
    if (n.origin !== "EXCEL" || ![STATE.PERLU_DICEK, STATE.SIAP_POSTING].includes(n.state)) throw new KoreksiError(`Catatan berstatus ${n.state} tidak bisa dikecualikan`, 409, "STATUS_FINAL");
    await tx.unitUsageNote.update({ where: { id: n.id }, data: { state: STATE.TIDAK_DIHITUNG, evaluatedAt: sekarang } });
    await tx.unitUsageNoteEvent.create({ data: { noteId: n.id, kind: "DIKECUALIKAN", before: { state: n.state, flags: (n.flags ?? []).map((f) => f.kode) }, after: { state: STATE.TIDAK_DIHITUNG }, reason, actorId: aktor.id, idempotencyKey: idem } });
    return { ulang: false, unitId: n.unitId };
  }, { timeout: 30_000, maxWait: 10_000 });
  if (!hasil.ulang && hasil.unitId) await evaluasiUlang(prisma, { actorId: aktor.id, unitIds: [hasil.unitId], sekarang });
  return { ...hasil, catatan: tampilCatatan(await prisma.unitUsageNote.findUnique({ where: { id: noteId } })) };
}

// ═════════════════════════ 2) KOREKSI PEMAKAIAN PER ORDER (efek stok) ═════════════════════════
/** Pemakaian bersih bahan pada unit = −Σ(ISSUE + RETURN bertaut unit). */
async function pemakaianBersih(db, unitId, materialId) {
  const mv = await db.stockMovement.findMany({ where: { unitId, materialId, type: { in: ["ISSUE", "RETURN"] } }, select: { id: true, type: true, qty: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const bersih = r4(-mv.reduce((s, m) => s + Number(m.qty), 0));
  const asal = [...mv].reverse().find((m) => m.type === "ISSUE") ?? null; // pemakaian asal terbaru yang dikoreksi
  return { mv, bersih, asal };
}
async function rencanaKoreksi(db, { unitId, materialId, qtyBaru, kecualiKoreksiId = null }) {
  const penghalang = []; const qty = Number(qtyBaru);
  const unit = await db.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, order: { select: { orderNumber: true } } } });
  if (!unit) throw new KoreksiError("Unit tidak ditemukan", 404, "UNIT_TIDAK_ADA");
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true } });
  if (!m) throw new KoreksiError("Bahan tidak ditemukan", 404, "BAHAN_TIDAK_ADA");
  if (!Number.isFinite(qty) || qty < 0 || qty > 1_000_000) throw new KoreksiError("Pemakaian yang benar harus angka 0 atau lebih", 400, "QTY_TIDAK_VALID");
  const { mv, bersih, asal } = await pemakaianBersih(db, unitId, materialId);
  if (!asal) penghalang.push({ kode: "TIDAK_ADA_PEMAKAIAN_ASAL", pesan: "Unit ini belum punya pengeluaran stok untuk bahan tersebut — tidak ada yang dikoreksi. Gunakan 'Siap jadi pengeluaran stok' untuk memposting catatan baru." });
  const delta = r4(qty - bersih);
  if (asal && Math.abs(delta) < EPS) penghalang.push({ kode: "TIDAK_ADA_PERUBAHAN", pesan: "Pemakaian yang benar sama dengan yang tercatat." });
  const tertunda = await db.warehouseCorrection.count({ where: { docType: TIPE_DOK, docId: unitId, status: STATUS.PENDING, ...(kecualiKoreksiId && { id: { not: kecualiKoreksiId } }) } });
  const [{ saldo }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const saldoSesudah = r4(saldo - delta);
  if (delta > 0 && saldoSesudah < -EPS) penghalang.push({ kode: "SALDO_KURANG", pesan: `Menaikkan pemakaian ${delta} ${m.unit} membuat saldo bahan negatif (tersedia ${r4(saldo)}). Tambah stok berbukti atau ajukan koreksi saldo bahan lebih dulu.` });
  const dasar = await dasarHargaRataRata(db, materialId, { asOf: new Date() });
  const nilai = dasar.harga == null ? null : Math.round(Math.abs(delta) * Number(dasar.harga) * (delta > 0 ? 1 : -1));
  const token = crypto.createHash("sha256").update(JSON.stringify({ u: unitId, m: materialId, mv: mv.map((x) => [x.id, String(x.qty)]), q: r4(qty) })).digest("hex").slice(0, 40);
  return { boleh: penghalang.length === 0, penghalang, tertunda, unit, bahan: m, bersihSebelum: bersih, bersihSesudah: r4(qty), delta, jenis: delta > 0 ? "ISSUE" : "RETURN", pergerakanAsal: asal?.id ?? null, idPergerakan: mv.map((x) => x.id), saldoSebelum: r4(saldo), saldoSesudah, nilaiPerkiraan: nilai, hargaDasar: dasar.harga == null ? null : Number(dasar.harga), token };
}
export async function pratinjauKoreksiPemakaian(prisma, args) {
  return prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return rencanaKoreksi(tx, args); }, { timeout: 30_000, maxWait: 10_000 });
}

async function nomorKoreksi(tx, sekarang) {
  const d = new Date(sekarang.getTime() + 7 * 3600_000);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yy = String(d.getUTCFullYear()).slice(-2);
  const awal = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 7 * 3600_000);
  const n = await tx.warehouseCorrection.count({ where: { requestedAt: { gte: awal } } });
  return `KG-${dd}${mm}${yy}-${String(n + 1).padStart(2, "0")}`;
}
const sertakan = { requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } }, movements: { select: { id: true, type: true, qty: true, materialId: true, location: true, correctsMovementId: true, createdAt: true }, orderBy: { createdAt: "asc" } } };

/** Ajukan koreksi pemakaian per order. Menunggu persetujuan orang LAIN (izin inventory:adjustment_approve). Idempoten per Idempotency-Key. Satu koreksi tertunda per unit. */
export async function ajukanKoreksiPemakaian(prisma, { unitId, materialId, qtyBaru, alasan, kunci, aktor, sekarang = new Date(), tanggalEfektif = null }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  const ada = await prisma.warehouseCorrection.findUnique({ where: { idempotencyKey: idem }, include: sertakan });
  if (ada) { if (ada.docId !== unitId || ada.docType !== TIPE_DOK) throw new KoreksiError("Idempotency-Key ini sudah dipakai untuk koreksi lain", 409, "KUNCI_DIPAKAI_DOKUMEN_LAIN"); return { ...bentukKoreksi(ada), ulang: true }; }
  let efektif = null; if (tanggalEfektif) { efektif = new Date(tanggalEfektif); if (Number.isNaN(efektif.getTime()) || efektif.getTime() > sekarang.getTime() + 60_000) throw new KoreksiError("Tanggal efektif tidak valid atau di masa depan", 400, "TANGGAL_TIDAK_VALID"); }
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "units", unitId); await lockRowForUpdate(tx, "materials", materialId);
      const r = await rencanaKoreksi(tx, { unitId, materialId, qtyBaru });
      if (r.tertunda > 0) throw new KoreksiError("Masih ada koreksi pemakaian yang menunggu persetujuan untuk unit ini", 409, "KOREKSI_TERTUNDA");
      if (!r.boleh) throw new KoreksiError(`Koreksi diblokir: ${r.penghalang[0].pesan}`, 409, r.penghalang[0].kode, { penghalang: r.penghalang });
      const nomor = await nomorKoreksi(tx, sekarang);
      const k = await tx.warehouseCorrection.create({ data: {
        correctionNumber: nomor, docType: TIPE_DOK, docId: unitId, docNumber: r.unit.unitCode, kind: "STOCK", status: STATUS.PENDING, reason,
        changes: { bahan: { id: r.bahan.id, kode: r.bahan.code, nama: r.bahan.name, satuan: r.bahan.unit }, order: r.unit.order?.orderNumber ?? null, sebelum: { pemakaianBersih: r.bersihSebelum, pergerakan: r.idPergerakan }, sesudah: { pemakaianBersih: r.bersihSesudah }, selisih: r.delta, jenisPergerakan: r.jenis, pergerakanAsal: r.pergerakanAsal, tanggalEfektif: efektif ? efektif.toISOString() : null },
        preview: { saldoSebelum: r.saldoSebelum, saldoSesudah: r.saldoSesudah, nilaiPerkiraan: r.nilaiPerkiraan, hargaDasar: r.hargaDasar, catatan: "Nilai perkiraan memakai harga rata-rata tertimbang saat ini; nilai final dibekukan saat disetujui (koreksi harga terpisah)." },
        docToken: r.token, requestedById: aktor.id, requestedAt: sekarang, idempotencyKey: idem,
      }, include: sertakan });
      return { ...bentukKoreksi(k), ulang: false };
    }, { timeout: 30_000, maxWait: 10_000 });
  } catch (e) {
    if (e?.code === "P2002") { const sudah = await prisma.warehouseCorrection.findUnique({ where: { idempotencyKey: idem }, include: sertakan }); if (sudah && sudah.docId === unitId) return { ...bentukKoreksi(sudah), ulang: true }; }
    throw e;
  }
}
async function ambilKunciKoreksi(tx, id) {
  await lockRowForUpdate(tx, "warehouse_corrections", id);
  const k = await tx.warehouseCorrection.findUnique({ where: { id }, include: sertakan });
  if (!k || k.docType !== TIPE_DOK) throw new KoreksiError("Koreksi tidak ditemukan", 404, "TIDAK_DITEMUKAN");
  return k;
}
/** Setujui + terapkan. Penyetuju ≠ pemohon; keadaan pemakaian dihitung ULANG di dalam kunci dan token dicocokkan; invarian saldo ditegakkan oleh postStockMovement. */
export async function setujuiKoreksiPemakaian(prisma, { koreksiId, aktor, catatan = null, sekarang = new Date() }) {
  const hasil = await prisma.$transaction(async (tx) => {
    let k = await ambilKunciKoreksi(tx, koreksiId);
    if (k.status === STATUS.POSTED) return { koreksi: { ...bentukKoreksi(k), ulang: true }, unitId: k.docId, materialId: k.changes?.bahan?.id, baru: false };
    if (k.status !== STATUS.PENDING) throw new KoreksiError(`Koreksi berstatus ${k.status} tidak bisa disetujui`, 409, "STATUS_FINAL");
    if (k.requestedById && k.requestedById === aktor.id) throw new KoreksiError("Pemohon tidak boleh menyetujui koreksinya sendiri — minta penyetuju lain", 403, "PEMOHON_SAMA");
    const materialId = k.changes.bahan.id; const qtyBaru = k.changes.sesudah.pemakaianBersih;
    await lockRowForUpdate(tx, "units", k.docId); await lockRowForUpdate(tx, "materials", materialId);
    const r = await rencanaKoreksi(tx, { unitId: k.docId, materialId, qtyBaru, kecualiKoreksiId: k.id });
    if (r.token !== k.docToken) throw new KoreksiError("Pemakaian unit ini sudah berubah sejak koreksi diajukan — ajukan ulang dengan data terbaru", 409, "KEADAAN_BERUBAH");
    if (!r.boleh) throw new KoreksiError(`Koreksi tidak lagi bisa diterapkan: ${r.penghalang[0].pesan}`, 409, r.penghalang[0].kode, { penghalang: r.penghalang });
    const efektif = k.changes.tanggalEfektif ? new Date(k.changes.tanggalEfektif) : undefined;
    const mv = await postStockMovement(tx, {
      materialId, type: r.jenis, qty: r.delta > 0 ? -r.delta : Math.abs(r.delta), unitId: k.docId, correctionId: k.id, correctsMovementId: r.pergerakanAsal, createdAt: efektif,
      reason: `Koreksi ${k.correctionNumber}: ${k.reason}`.slice(0, 480), note: `Koreksi pemakaian ${k.correctionNumber} atas ${r.unit.unitCode} (${koma(r.bersihSebelum)} → ${koma(r.bersihSesudah)} ${r.bahan.unit})`, createdById: aktor.id,
    });
    const hasilPost = { pergerakanId: mv.id, jenis: r.jenis, selisih: r.delta, pemakaianSebelum: r.bersihSebelum, pemakaianSesudah: r.bersihSesudah, saldoSebelum: r.saldoSebelum, saldoSesudah: r.saldoSesudah };
    await tx.warehouseCorrection.update({ where: { id: k.id }, data: { status: STATUS.POSTED, decidedById: aktor.id, decidedAt: sekarang, decisionNote: catatan ? String(catatan).slice(0, 500) : null, result: hasilPost } });
    // hubungan ke catatan historis unit+bahan: peristiwa DIKOREKSI (sebelum–sesudah, alasan, pelaku) pada setiap catatan yang belum final
    const catatan2 = await tx.unitUsageNote.findMany({ where: { unitId: k.docId, materialId, state: { in: [STATE.PERLU_DICEK, STATE.SIAP_POSTING, STATE.TERCATAT_DI_STOK] } }, select: { id: true } });
    for (const c of catatan2) await tx.unitUsageNoteEvent.create({ data: { noteId: c.id, kind: "DIKOREKSI", before: { pemakaianStok: r.bersihSebelum }, after: { pemakaianStok: r.bersihSesudah, koreksi: k.correctionNumber, pergerakanId: mv.id }, reason: k.reason, actorId: aktor.id } });
    k = await tx.warehouseCorrection.findUnique({ where: { id: k.id }, include: sertakan });
    return { koreksi: { ...bentukKoreksi(k), ulang: false }, unitId: k.docId, materialId, baru: true };
  }, { timeout: 30_000, maxWait: 10_000 });
  if (hasil.baru) await evaluasiUlang(prisma, { actorId: aktor.id, unitIds: [hasil.unitId], sekarang });
  return hasil.koreksi;
}
async function akhiri(prisma, { koreksiId, aktor, catatan, sekarang, status, hanyaPemohon }) {
  return prisma.$transaction(async (tx) => {
    const k = await ambilKunciKoreksi(tx, koreksiId);
    if (k.status === status) return { ...bentukKoreksi(k), ulang: true };
    if (k.status !== STATUS.PENDING) throw new KoreksiError(`Koreksi berstatus ${k.status} tidak bisa diubah`, 409, "STATUS_FINAL");
    if (hanyaPemohon && k.requestedById !== aktor.id) throw new KoreksiError("Hanya pemohon yang dapat membatalkan koreksinya", 403, "BUKAN_PEMOHON");
    if (!hanyaPemohon && k.requestedById && k.requestedById === aktor.id) throw new KoreksiError("Pemohon tidak memutuskan koreksinya sendiri — gunakan Batalkan", 403, "PEMOHON_SAMA");
    await tx.warehouseCorrection.update({ where: { id: k.id }, data: { status, decidedById: aktor.id, decidedAt: sekarang, decisionNote: catatan ? String(catatan).slice(0, 500) : null } });
    return { ...bentukKoreksi(await tx.warehouseCorrection.findUnique({ where: { id: k.id }, include: sertakan })), ulang: false };
  }, { timeout: 30_000, maxWait: 10_000 });
}
export const tolakKoreksiPemakaian = (prisma, a) => { if (String(a.catatan ?? "").trim().length < 5) throw new KoreksiError("Alasan penolakan wajib diisi (min 5 karakter)", 400, "ALASAN_WAJIB"); return akhiri(prisma, { ...a, sekarang: a.sekarang ?? new Date(), status: STATUS.REJECTED, hanyaPemohon: false }); };
export const batalkanKoreksiPemakaian = (prisma, a) => akhiri(prisma, { ...a, sekarang: a.sekarang ?? new Date(), status: STATUS.CANCELLED, hanyaPemohon: true });

export async function daftarKoreksiPemakaian(db, { status = null, unitId = null, limit = 100 } = {}) {
  const rows = await db.warehouseCorrection.findMany({ where: { docType: TIPE_DOK, ...(status ? { status } : {}), ...(unitId ? { docId: unitId } : {}) }, include: sertakan, orderBy: { requestedAt: "desc" }, take: Math.min(limit, 200) });
  return rows.map(bentukKoreksi);
}
/** Entri Riwayat unit untuk koreksi pemakaian: diajukan / disetujui / ditolak, lengkap sebelum–sesudah dan pelaku. */
export async function riwayatKoreksiPemakaian(db, unitId) {
  const rows = await db.warehouseCorrection.findMany({ where: { docType: TIPE_DOK, docId: unitId }, include: sertakan, orderBy: { requestedAt: "asc" } });
  const out = [];
  for (const k of rows) {
    const c = k.changes ?? {}; const uraian = `${c.bahan?.nama ?? c.bahan?.kode ?? "bahan"}: ${koma(c.sebelum?.pemakaianBersih)} → ${koma(c.sesudah?.pemakaianBersih)} ${c.bahan?.satuan ?? ""}`.trim();
    out.push({ kind: "KOREKSI_PEMAKAIAN_DIAJUKAN", sumber: "KOREKSI_PEMAKAIAN", at: k.requestedAt, actor: k.requestedBy?.name ?? null, label: `Koreksi pemakaian ${k.correctionNumber} diajukan — ${uraian}. Alasan: ${k.reason}`, before: c.sebelum, after: c.sesudah });
    if (k.decidedAt) out.push({ kind: `KOREKSI_PEMAKAIAN_${k.status}`, sumber: "KOREKSI_PEMAKAIAN", at: k.decidedAt, actor: k.decidedBy?.name ?? null, label: `Koreksi pemakaian ${k.correctionNumber} ${k.status === "POSTED" ? "disetujui dan diterapkan" : k.status === "REJECTED" ? "ditolak" : "dibatalkan"}${k.decisionNote ? ` — ${k.decisionNote}` : ""}`, before: c.sebelum, after: k.status === "POSTED" ? c.sesudah : c.sebelum });
  }
  return out;
}
