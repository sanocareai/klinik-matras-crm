// KOREKSI PENERIMAAN BARANG YANG SUDAH MASUK STOK (Okt 2026) — dokumen koreksi bertaut ke Goods Receipt asal.
//
// Aturan produk (lihat services/warehouseCoverage.js untuk jalur per menu):
//  • Catatan asal (GR, baris, pergerakan RECEIPT) TIDAK diubah/dihapus. Koreksi = dokumen WarehouseCorrection + pergerakan BARU bertaut (correction_id, corrects_movement_id).
//  • Koreksi METADATA (supplier, referensi, surat jalan, catatan, tanggal dokumen, kondisi/catatan baris) tidak mengubah stok: langsung POSTED, alasan wajib, sebelum–sesudah tercatat.
//  • Koreksi yang mengubah STOK (jumlah baik, bahan, lokasi): pratinjau dampak → alasan wajib → diajukan (PENDING_APPROVAL) → disetujui orang LAIN (izin inventory:adjustment_approve) →
//    pergerakan pembalik/selisih tertulis lewat postStockMovement (invarian saldo tidak negatif tetap berlaku). Pemohon tidak pernah menyetujui koreksinya sendiri (layanan + CHECK DB).
//  • Idempoten: Idempotency-Key pada pengajuan (kunci unik); persetujuan/penolakan/pembatalan berulang mengembalikan hasil yang sama tanpa menulis ulang. Satu koreksi tertunda per penerimaan.
//  • Keadaan basi ditolak: token keadaan penerimaan (status, baris, pergerakan, header) dibandingkan saat disetujui; berubah → 409 KEADAAN_BERUBAH.
//  • Batas lintas domain: penerimaan dari PO diarahkan ke Koreksi Kedatangan (resmi, Finance-aware). Penerimaan yang sudah dijurnal / tertaut tagihan DIBLOKIR dengan arah ke Finance. Koreksi
//    TIDAK menulis jurnal/pembayaran/tagihan, TIDAK menciptakan QC/penerimaan fisik/pemakaian Produksi, dan tidak menambah stok pada baris yang tidak punya jumlah baik tercatat.
import crypto from "node:crypto";
import { postStockMovement, lockRowForUpdate, RESERVED_STATUSES } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { PENGHALANG } from "./warehouseCoverage.js";
import { findEntryByKey } from "./finance/journal.js";
import { KEY as KEY_SUPPLIER } from "./finance/posting/supplier.js";
import { statusCutoverUntuk } from "./finance/persediaanAwal.js";

export class KoreksiError extends Error {
  constructor(message, statusCode = 409, code = null, extra = {}) { super(message); this.statusCode = statusCode; if (code) this.code = code; Object.assign(this, extra); }
}

export const STATUS = Object.freeze({ PENDING: "PENDING_APPROVAL", POSTED: "POSTED", REJECTED: "REJECTED", CANCELLED: "CANCELLED" });
export const FIELD_METADATA_NON_PO = ["supplier", "sourceReference", "deliveryNote", "notes", "receivedDate"];
export const FIELD_METADATA_PO = ["notes"];
const FIELD_BARIS_METADATA = ["kondisi", "catatan"];
const FIELD_BARIS_STOK = ["jumlahBaik", "bahanId", "lokasi"];
const TIPE_DOK = "GOODS_RECEIPT";
const EPS = 1e-6;
const r4 = (v) => Math.round(Number(v ?? 0) * 10000) / 10000;
const sama = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < EPS;
const teks = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const tglWIB = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);

const penghalang = (kode, extra = {}) => ({ kode, ...PENGHALANG[kode], ...extra });

// ───────────────────────────── keadaan penerimaan ─────────────────────────────
async function muatKeadaan(db, receiptId, { kecualiKoreksiId = null } = {}) {
  const receipt = await db.goodsReceipt.findUnique({
    where: { id: receiptId },
    include: { lines: { include: { material: { select: { id: true, code: true, name: true, unit: true, active: true } } }, orderBy: { id: "asc" } } },
  });
  if (!receipt) throw new KoreksiError("Penerimaan tidak ditemukan", 404, "TIDAK_DITEMUKAN");
  const movements = await db.stockMovement.findMany({ where: { goodsReceiptId: receiptId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, materialId: true, type: true, qty: true, location: true, createdAt: true, correctionId: true, correctsMovementId: true } });
  const koreksiTertunda = await db.warehouseCorrection.count({ where: { docType: TIPE_DOK, docId: receiptId, status: STATUS.PENDING, ...(kecualiKoreksiId && { id: { not: kecualiKoreksiId } }) } });
  const token = crypto.createHash("sha256").update(JSON.stringify({
    s: receipt.status, h: [receipt.supplier, receipt.sourceReference, receipt.deliveryNote, receipt.notes, receipt.receivedDate && tglWIB(receipt.receivedDate)],
    l: receipt.lines.map((l) => [l.id, l.materialId, l.acceptedQty, l.condition, l.notes]), m: movements.map((m) => [m.id, String(m.qty), m.location]),
  })).digest("hex").slice(0, 40);
  return { receipt, movements, koreksiTertunda, token };
}

// Pergerakan "asal" per baris (tanpa koreksi) dan saldo bersih per bahan di penerimaan ini (asal + koreksi).
function petaBaris(keadaan) {
  const { receipt, movements } = keadaan;
  const hitungBahan = new Map();
  for (const l of receipt.lines) if (Number(l.acceptedQty ?? 0) > 0) hitungBahan.set(l.materialId, (hitungBahan.get(l.materialId) ?? 0) + 1);
  return receipt.lines.map((l) => {
    const asal = movements.filter((m) => m.materialId === l.materialId && m.type === "RECEIPT" && !m.correctionId);
    const asalQty = r4(asal.reduce((n, m) => n + Number(m.qty), 0));
    const bersih = r4(movements.filter((m) => m.materialId === l.materialId).reduce((n, m) => n + Number(m.qty), 0));
    return { baris: l, asal, asalQty, bersih, lokasi: asal[0]?.location ?? "GUDANG_UTAMA", ganda: (hitungBahan.get(l.materialId) ?? 0) > 1 };
  });
}

async function tersedia(db, materialId) {
  const [{ balance }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS balance FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  const [{ reserved }] = await db.$queryRaw`
    SELECT COALESCE(SUM(qty), 0)::float AS reserved FROM (
      SELECT mil.requested_qty AS qty FROM material_issue_lines mil JOIN material_issues mi ON mi.id = mil.material_issue_id
      WHERE mil.material_id = ${materialId}::uuid AND mi.status = ANY(${RESERVED_STATUSES}::"IssueStatus"[]) AND mi.production_plan_id IS NULL
      UNION ALL
      SELECT r.qty::float FROM material_reservations_v2 r WHERE r.material_id = ${materialId}::uuid AND r.status = 'ACTIVE'
    ) u`;
  return { balance: r4(balance), reserved: r4(reserved), tersedia: r4(balance - reserved) };
}

// ───────────────────────────── rencana & pratinjau ─────────────────────────────
function validasiMasukan(perubahan) {
  if (!perubahan || typeof perubahan !== "object") throw new KoreksiError("Perubahan wajib diisi", 400, "NILAI_TIDAK_VALID");
  const meta = perubahan.metadata ?? {};
  const baris = perubahan.baris ?? [];
  if (typeof meta !== "object" || Array.isArray(meta) || !Array.isArray(baris)) throw new KoreksiError("Bentuk perubahan tidak valid", 400, "NILAI_TIDAK_VALID");
  for (const k of Object.keys(meta)) if (!FIELD_METADATA_NON_PO.includes(k)) throw new KoreksiError(`Bidang metadata tidak dikenal: ${k}`, 400, "NILAI_TIDAK_VALID");
  const lihat = new Set();
  for (const b of baris) {
    if (!b?.barisId) throw new KoreksiError("Setiap baris koreksi wajib menyebut barisId", 400, "NILAI_TIDAK_VALID");
    if (lihat.has(b.barisId)) throw new KoreksiError("Baris yang sama dikoreksi lebih dari sekali", 400, "NILAI_TIDAK_VALID");
    lihat.add(b.barisId);
    for (const k of Object.keys(b)) if (k !== "barisId" && !FIELD_BARIS_METADATA.includes(k) && !FIELD_BARIS_STOK.includes(k)) throw new KoreksiError(`Bidang baris tidak dikenal: ${k}`, 400, "NILAI_TIDAK_VALID");
  }
  return { meta, baris };
}

/** Murni baca. Mengembalikan rencana lengkap: jenis (METADATA/STOCK), penghalang, sebelum/sesudah, operasi pergerakan, dampak. Tidak menulis apa pun. */
export async function rencanaKoreksiGR(db, { receiptId, perubahan, sekarang = new Date(), kecualiKoreksiId = null }) {
  const { meta, baris: inputBaris } = validasiMasukan(perubahan);
  const keadaan = await muatKeadaan(db, receiptId, { kecualiKoreksiId });
  const { receipt } = keadaan;
  const blok = [];
  const dariPO = !!receipt.purchaseOrderId;

  if (receipt.status === "REJECTED") blok.push(penghalang("PENERIMAAN_DITOLAK"));
  else if (receipt.status !== "COMPLETED") blok.push(penghalang("BUKAN_COMPLETED"));
  if (keadaan.koreksiTertunda > 0) blok.push(penghalang("KOREKSI_TERTUNDA"));

  // ── metadata ──
  const metaSebelum = {}; const metaSesudah = {};
  const diizinkan = dariPO ? FIELD_METADATA_PO : FIELD_METADATA_NON_PO;
  for (const [k, v] of Object.entries(meta)) {
    if (!diizinkan.includes(k)) { blok.push(penghalang("DARI_PO", { bidang: k, pesan: `Bidang ${k} pada penerimaan dari PO dimiliki alur PO/Finance dan tidak diubah dari sini.` })); continue; }
    let baru; let lama;
    if (k === "receivedDate") {
      lama = receipt.receivedDate ? tglWIB(receipt.receivedDate) : null;
      baru = v === null || v === "" ? null : String(v).slice(0, 10);
      if (!baru || !/^\d{4}-\d{2}-\d{2}$/.test(baru) || Number.isNaN(Date.parse(`${baru}T00:00:00Z`)) || baru > tglWIB(sekarang)) { blok.push(penghalang("WAKTU_TIDAK_VALID", { bidang: k })); continue; }
    } else { lama = teks(receipt[k]); baru = teks(v); }
    if (lama !== baru) { metaSebelum[k] = lama; metaSesudah[k] = baru; }
  }

  // ── baris ──
  const peta = petaBaris(keadaan);
  const hasilBaris = []; const operasi = [];
  let adaStok = false; let adaMetaBaris = false;
  for (const b of inputBaris) {
    const p = peta.find((x) => x.baris.id === b.barisId);
    if (!p) { blok.push(penghalang("NILAI_TIDAK_VALID", { pesan: "Baris tidak ada pada penerimaan ini.", barisId: b.barisId })); continue; }
    const l = p.baris; const kode = l.material.code;
    const item = { barisId: l.id, kode, nama: l.material.name, satuan: l.material.unit, sebelum: { jumlahBaik: p.bersih, bahan: l.material.code, lokasi: p.lokasi, kondisi: l.condition ?? null, catatan: l.notes ?? null }, sesudah: {}, penghalang: [] };
    const tambah = (kodeP, extra = {}) => { const o = penghalang(kodeP, { barisId: l.id, bahan: kode, ...extra }); item.penghalang.push(o); blok.push(o); };

    // metadata baris
    const kondisiBaru = b.kondisi !== undefined ? teks(b.kondisi) : l.condition ?? null; const catatanBaru = b.catatan !== undefined ? teks(b.catatan) : l.notes ?? null;
    if (kondisiBaru !== (l.condition ?? null) || catatanBaru !== (l.notes ?? null)) { adaMetaBaris = true; item.sesudah.kondisi = kondisiBaru; item.sesudah.catatan = catatanBaru; item.metadata = true; }

    const ubahStok = FIELD_BARIS_STOK.some((k) => b[k] !== undefined);
    if (ubahStok) {
      if (dariPO) { tambah("DARI_PO"); hasilBaris.push(item); continue; }
      if (!(Number(l.acceptedQty ?? 0) > 0)) { tambah("NILAI_TIDAK_VALID", { pesan: "Baris tanpa jumlah baik tercatat tidak punya stok masuk — koreksi tidak menambah stok baru (itu penerimaan fisik baru).", langkah: "Buat Penerimaan Baru bila barang memang datang." }); hasilBaris.push(item); continue; }
      if (p.ganda) tambah("BARIS_BAHAN_GANDA");
      if (!sama(p.asalQty, l.acceptedQty)) tambah("LEDGER_TIDAK_SINKRON", { detail: { ledgerAsal: p.asalQty, tercatat: l.acceptedQty } });

      const target = b.jumlahBaik === undefined ? p.bersih : Number(b.jumlahBaik);
      if (!Number.isFinite(target) || target < 0 || Math.abs(target * 10000 - Math.round(target * 10000)) > 1e-6) { tambah("NILAI_TIDAK_VALID", { pesan: "Jumlah baik baru harus angka ≥ 0 (maks 4 desimal)." }); hasilBaris.push(item); continue; }
      const lokasiBaru = b.lokasi === undefined ? p.lokasi : teks(b.lokasi);
      if (!lokasiBaru || lokasiBaru.length > 60) { tambah("NILAI_TIDAK_VALID", { pesan: "Lokasi baru wajib diisi (maks 60 karakter)." }); hasilBaris.push(item); continue; }
      let bahanBaru = l.material;
      if (b.bahanId !== undefined && b.bahanId !== l.materialId) {
        const m = await db.material.findUnique({ where: { id: String(b.bahanId) }, select: { id: true, code: true, name: true, unit: true, active: true } });
        if (!m || !m.active) { tambah("BAHAN_PENGGANTI_TIDAK_VALID"); hasilBaris.push(item); continue; }
        if (m.unit !== l.material.unit) { tambah("SATUAN_BEDA", { detail: { asal: l.material.unit, pengganti: m.unit } }); hasilBaris.push(item); continue; }
        bahanBaru = m;
      }
      const ganti = bahanBaru.id !== l.materialId || lokasiBaru !== p.lokasi;
      item.sesudah.jumlahBaik = r4(target); item.sesudah.bahan = bahanBaru.code; item.sesudah.lokasi = lokasiBaru;
      if (!ganti && sama(target, p.bersih)) { hasilBaris.push(item); continue; }
      adaStok = true;
      item.stok = true;

      // pengurangan pada bahan/lokasi asal
      const keluarDariAsal = ganti ? p.bersih : Math.max(0, r4(p.bersih - target));
      const tambahPadaAsal = !ganti && target > p.bersih ? r4(target - p.bersih) : 0;
      const asalMov = p.asal[0];
      const ops = [];
      if (keluarDariAsal > EPS) ops.push({ jenis: "PEMBALIK", materialId: l.materialId, qty: -keluarDariAsal, lokasi: p.lokasi, koreksiAtas: asalMov?.id ?? null, kode });
      if (tambahPadaAsal > EPS) ops.push({ jenis: "SELISIH_TAMBAH", materialId: l.materialId, qty: tambahPadaAsal, lokasi: p.lokasi, koreksiAtas: asalMov?.id ?? null, kode });
      if (ganti && target > EPS) ops.push({ jenis: "MASUK_BARU", materialId: bahanBaru.id, qty: r4(target), lokasi: lokasiBaru, koreksiAtas: null, kode: bahanBaru.code });
      item.operasi = ops;

      // penghalang pada bahan asal (setiap perubahan stok memengaruhi asal)
      if (asalMov) {
        const bergerak = await db.stockMovement.findMany({
          where: { materialId: l.materialId, createdAt: { gt: asalMov.createdAt }, goodsReceiptId: { not: receipt.id }, OR: [{ type: { not: "RECEIPT" } }, { qty: { lt: 0 } }] },
          orderBy: { createdAt: "asc" }, take: 6, select: { type: true, qty: true, createdAt: true, note: true },
        });
        const bergerakLain = await db.stockMovement.findMany({ where: { materialId: l.materialId, createdAt: { gt: asalMov.createdAt }, goodsReceiptId: null, OR: [{ type: { not: "RECEIPT" } }, { qty: { lt: 0 } }] }, take: 6, select: { type: true, qty: true, createdAt: true, note: true } });
        const semua = [...bergerak, ...bergerakLain].slice(0, 6);
        if (semua.length > 0) tambah("BAHAN_SUDAH_BERGERAK", { detail: semua.map((m) => ({ jenis: m.type, qty: Number(m.qty), waktu: m.createdAt, catatan: m.note })) });
        const hitung = await db.stockCountLine.findMany({ where: { materialId: l.materialId, stockCount: { status: { in: ["IN_PROGRESS", "WAITING_REVIEW", "COMPLETED"] }, startedAt: { gte: asalMov.createdAt } } }, take: 3, select: { stockCount: { select: { countNumber: true, status: true } } } });
        if (hitung.length > 0) tambah("SUDAH_DIHITUNG_OPNAME", { detail: hitung.map((h) => ({ nomor: h.stockCount.countNumber, status: h.stockCount.status })) });
      }
      const sedia = await tersedia(db, l.materialId);
      item.saldo = { sebelum: sedia.balance, reservasi: sedia.reserved, tersedia: sedia.tersedia, sesudah: r4(sedia.balance - keluarDariAsal + tambahPadaAsal) };
      if (keluarDariAsal > sedia.tersedia + EPS) tambah("STOK_TIDAK_CUKUP", { detail: { dikurangi: keluarDariAsal, tersedia: sedia.tersedia, saldo: sedia.balance, reservasi: sedia.reserved } });
      const retur = db.supplierReturnLine ? await db.supplierReturnLine.count({ where: { goodsReceiptLineId: l.id, supplierReturn: { status: { not: "DIBATALKAN" } } } }) : 0;
      if (retur > 0) tambah("RETUR_AKTIF");
      operasi.push(...ops.map((o) => ({ ...o, barisId: l.id })));
    }
    hasilBaris.push(item);
  }

  // ── penghalang Finance (hanya bila ada perubahan yang menyentuh nilai/tanggal/stok) ──
  const sentuhFinance = adaStok || metaSesudah.receivedDate !== undefined;
  if (sentuhFinance && !dariPO) {
    const jurnal = await findEntryByKey(db, KEY_SUPPLIER.goodsReceipt(receipt.id));
    if (jurnal && jurnal.status !== "REVERSED") blok.push(penghalang("JURNAL_FINANCE", { detail: { jurnal: jurnal.entryNumber ?? null, status: jurnal.status } }));
    const tagihan = await db.finSupplierBill.count({ where: { status: { notIn: ["DIBATALKAN", "DITOLAK"] }, OR: [{ goodsReceiptId: receipt.id }, { poAllocations: { some: { goodsReceiptId: receipt.id } } }, { poReceipts: { some: { goodsReceiptId: receipt.id } } }] } });
    if (tagihan > 0) blok.push(penghalang("TAGIHAN_TERKAIT", { detail: { jumlah: tagihan } }));
    const cut = await statusCutoverUntuk(db, receipt.receivedDate || receipt.createdAt);
    if (cut.status === "tertutup") blok.push(penghalang("TERCAKUP_STOK_OPNAME"));
  }

  const adaMeta = Object.keys(metaSesudah).length > 0 || adaMetaBaris;
  if (!adaStok && !adaMeta && blok.length === 0) blok.push(penghalang("TANPA_PERUBAHAN"));
  const kind = adaStok ? "STOCK" : "METADATA";
  const uniqBlok = []; const lihat = new Set();
  for (const o of blok) { const key = `${o.kode}|${o.barisId ?? ""}|${o.bidang ?? ""}`; if (!lihat.has(key)) { lihat.add(key); uniqBlok.push(o); } }
  return {
    boleh: uniqBlok.length === 0, kind, penghalang: uniqBlok, token: keadaan.token, dariPO,
    penerimaan: { id: receipt.id, nomor: receipt.receiptNumber, status: receipt.status, supplier: receipt.supplier, sumber: receipt.sourceType },
    metadata: { sebelum: metaSebelum, sesudah: metaSesudah }, baris: hasilBaris, operasi,
    dampak: {
      stok: adaStok, produksi: false, finance: false,
      ringkasan: adaStok ? "Mengubah stok: pergerakan pembalik/selisih baru bertaut ke penerimaan ini (catatan asal tetap). Tidak menulis jurnal, pembayaran, atau tagihan Finance." : "Hanya data dokumen: stok, jurnal, pembayaran, dan Produksi tidak berubah.",
      butuhPersetujuan: adaStok,
      pergerakanBaru: operasi.length,
    },
  };
}

/** Keadaan penerimaan untuk formulir koreksi: header, baris dengan jumlah BERSIH ledger (asal + koreksi) dan lokasi, serta apakah koreksi bisa diajukan. Murni baca. */
export async function keadaanKoreksiGR(db, receiptId) {
  const keadaan = await muatKeadaan(db, receiptId);
  const { receipt } = keadaan;
  const peta = petaBaris(keadaan);
  return {
    penerimaan: { id: receipt.id, nomor: receipt.receiptNumber, status: receipt.status, sumber: receipt.sourceType, dariPO: !!receipt.purchaseOrderId, supplier: receipt.supplier, sourceReference: receipt.sourceReference, deliveryNote: receipt.deliveryNote, notes: receipt.notes, receivedDate: receipt.receivedDate ? tglWIB(receipt.receivedDate) : null },
    bidangMetadata: receipt.purchaseOrderId ? FIELD_METADATA_PO : FIELD_METADATA_NON_PO,
    baris: peta.map((p) => ({ id: p.baris.id, bahanId: p.baris.materialId, kode: p.baris.material.code, nama: p.baris.material.name, satuan: p.baris.material.unit, jumlahBaikTercatat: Number(p.baris.acceptedQty ?? 0), jumlahBersih: p.bersih, lokasi: p.lokasi, kondisi: p.baris.condition ?? null, catatan: p.baris.notes ?? null, bisaUbahStok: !receipt.purchaseOrderId && Number(p.baris.acceptedQty ?? 0) > 0 && !p.ganda })),
    koreksiTertunda: keadaan.koreksiTertunda,
    bisaMengajukan: receipt.status === "COMPLETED" && keadaan.koreksiTertunda === 0,
  };
}

export async function pratinjauKoreksiGR(prisma, args) {
  return prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return rencanaKoreksiGR(tx, args); }, { timeout: 30_000, maxWait: 10_000 });
}

// ───────────────────────────── nomor, aktor, hasil ─────────────────────────────
async function nomorKoreksi(tx, sekarang) {
  const d = new Date(sekarang.getTime() + 7 * 3600_000);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0"), yy = String(d.getUTCFullYear()).slice(-2);
  const awal = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 7 * 3600_000);
  const n = await tx.warehouseCorrection.count({ where: { requestedAt: { gte: awal } } });
  return `KG-${dd}${mm}${yy}-${String(n + 1).padStart(2, "0")}`;
}
function alasanWajib(a) { const t = String(a ?? "").trim(); if (t.length < 5 || t.length > 500) throw new KoreksiError("Alasan koreksi wajib diisi (5–500 karakter)", 400, "ALASAN_WAJIB"); return t; }
function kunciValid(k) { const t = String(k ?? ""); if (t.length < 8 || t.length > 120) throw new KoreksiError("Idempotency-Key wajib (8–120 karakter)", 428, "IDEMPOTENCY_KEY_REQUIRED"); return t; }

const sertakan = { requestedBy: { select: { id: true, name: true } }, decidedBy: { select: { id: true, name: true } }, movements: { select: { id: true, type: true, qty: true, materialId: true, location: true, correctsMovementId: true, createdAt: true }, orderBy: { createdAt: "asc" } } };
export function bentukKoreksi(k) {
  return { id: k.id, nomor: k.correctionNumber, jenisDokumen: k.docType, dokumenId: k.docId, nomorDokumen: k.docNumber, jenis: k.kind, status: k.status, alasan: k.reason, perubahan: k.changes, pratinjau: k.preview, pemohon: k.requestedBy ?? null, diajukanPada: k.requestedAt, pemutus: k.decidedBy ?? null, diputuskanPada: k.decidedAt, catatanKeputusan: k.decisionNote, hasil: k.result, pergerakan: (k.movements ?? []).map((m) => ({ id: m.id, jenis: m.type, qty: Number(m.qty), bahanId: m.materialId, lokasi: m.location, mengoreksi: m.correctsMovementId, waktu: m.createdAt })) };
}

// ───────────────────────────── terapkan ─────────────────────────────
async function terapkanRencana(tx, { koreksi, receiptId, rencana, aktorId, sekarang }) {
  const receipt = await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: { lines: true } });
  // metadata
  const dataHeader = {};
  for (const [k, v] of Object.entries(rencana.metadata.sesudah)) dataHeader[k] = k === "receivedDate" ? (v ? new Date(`${v}T00:00:00.000Z`) : null) : v;
  if (Object.keys(dataHeader).length > 0) await tx.goodsReceipt.update({ where: { id: receipt.id }, data: dataHeader });
  for (const b of rencana.baris.filter((x) => x.metadata)) await tx.goodsReceiptLine.update({ where: { id: b.barisId }, data: { condition: b.sesudah.kondisi, notes: b.sesudah.catatan } });
  // stok
  const ids = [];
  for (const o of rencana.operasi) {
    const m = await postStockMovement(tx, {
      materialId: o.materialId, type: "RECEIPT", qty: o.qty, location: o.lokasi, supplier: receipt.supplier || null,
      reason: `Koreksi ${koreksi.correctionNumber}: ${koreksi.reason}`.slice(0, 480),
      note: `${o.jenis === "PEMBALIK" ? "Pembalik" : o.jenis === "SELISIH_TAMBAH" ? "Selisih tambah" : "Masuk baru (koreksi bahan/lokasi)"} — koreksi ${koreksi.correctionNumber} atas ${receipt.receiptNumber}`,
      goodsReceiptId: receipt.id, createdById: aktorId, correctionId: koreksi.id, correctsMovementId: o.koreksiAtas,
    });
    ids.push({ id: m.id, jenis: o.jenis, bahan: o.kode, qty: o.qty });
  }
  return { pergerakan: ids };
}

/** Ajukan koreksi. METADATA langsung POSTED; STOCK menunggu persetujuan orang lain. Idempoten per Idempotency-Key. */
export async function ajukanKoreksiGR(prisma, { receiptId, perubahan, alasan, kunci, aktor, sekarang = new Date() }) {
  const reason = alasanWajib(alasan); const idem = kunciValid(kunci);
  const ada = await prisma.warehouseCorrection.findUnique({ where: { idempotencyKey: idem }, include: sertakan });
  if (ada) {
    if (ada.docId !== receiptId) throw new KoreksiError("Idempotency-Key ini sudah dipakai untuk dokumen lain", 409, "KUNCI_DIPAKAI_DOKUMEN_LAIN");
    return { ...bentukKoreksi(ada), ulang: true };
  }
  const opsi = { timeout: 30_000, maxWait: 10_000 };
  try {
    return await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, "goods_receipts", receiptId);
      const rencana = await rencanaKoreksiGR(tx, { receiptId, perubahan, sekarang });
      if (!rencana.boleh) throw new KoreksiError(`Koreksi diblokir: ${rencana.penghalang[0].pesan}`, 409, rencana.penghalang[0].kode, { penghalang: rencana.penghalang });
      const stok = rencana.kind === "STOCK";
      const nomor = await nomorKoreksi(tx, sekarang);
      const dasar = {
        correctionNumber: nomor, docType: TIPE_DOK, docId: receiptId, docNumber: rencana.penerimaan.nomor, kind: rencana.kind, reason,
        changes: { metadata: rencana.metadata, baris: rencana.baris.filter((b) => b.stok || b.metadata).map((b) => ({ barisId: b.barisId, kode: b.kode, sebelum: b.sebelum, sesudah: b.sesudah, operasi: b.operasi ?? [] })) },
        preview: { dampak: rencana.dampak, saldo: rencana.baris.map((b) => ({ barisId: b.barisId, ...b.saldo })).filter((x) => x.sebelum !== undefined), operasi: rencana.operasi },
        docToken: rencana.token, requestedById: aktor.id, requestedAt: sekarang, idempotencyKey: idem,
      };
      if (stok) {
        const k = await tx.warehouseCorrection.create({ data: { ...dasar, status: STATUS.PENDING }, include: sertakan });
        await recordActivity(tx, { entityType: ENTITY_TYPES.WAREHOUSE_CORRECTION, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { fase: "DIAJUKAN", nomor, penerimaan: rencana.penerimaan.nomor, alasan: reason } });
        return { ...bentukKoreksi(k), ulang: false };
      }
      // METADATA: langsung diterapkan
      const hasil = await terapkanRencana(tx, { koreksi: { id: null, correctionNumber: nomor, reason }, receiptId, rencana, aktorId: aktor.id, sekarang }); // tanpa pergerakan: tidak butuh baris koreksi lebih dulu
      const k = await tx.warehouseCorrection.create({ data: { ...dasar, status: STATUS.POSTED, decidedAt: sekarang, decisionNote: "Koreksi data (tanpa efek stok) — langsung dicatat", result: hasil }, include: sertakan });
      await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: receiptId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { nomor, jenis: "METADATA", sebelum: rencana.metadata.sebelum, sesudah: rencana.metadata.sesudah, alasan: reason } });
      return { ...bentukKoreksi(k), ulang: false };
    }, opsi);
  } catch (e) {
    if (e?.code === "P2002") { // balapan Idempotency-Key / nomor: baca hasil yang sudah ada
      const sudah = await prisma.warehouseCorrection.findUnique({ where: { idempotencyKey: idem }, include: sertakan });
      if (sudah && sudah.docId === receiptId) return { ...bentukKoreksi(sudah), ulang: true };
    }
    throw e;
  }
}

async function ambilKunciKoreksi(tx, id) {
  await lockRowForUpdate(tx, "warehouse_corrections", id);
  const k = await tx.warehouseCorrection.findUnique({ where: { id }, include: sertakan });
  if (!k) throw new KoreksiError("Koreksi tidak ditemukan", 404, "TIDAK_DITEMUKAN");
  return k;
}

/** Setujui + terapkan. Penyetuju ≠ pemohon. Rencana dihitung ULANG di dalam kunci dan token keadaan dicocokkan. Ulang pada koreksi yang sudah POSTED = hasil yang sama. */
export async function setujuiKoreksi(prisma, { koreksiId, aktor, catatan = null, sekarang = new Date() }) {
  return prisma.$transaction(async (tx) => {
    let k = await ambilKunciKoreksi(tx, koreksiId);
    if (k.status === STATUS.POSTED) return { ...bentukKoreksi(k), ulang: true };
    if (k.status !== STATUS.PENDING) throw new KoreksiError(`Koreksi berstatus ${k.status} tidak bisa disetujui`, 409, "STATUS_FINAL");
    if (k.requestedById && k.requestedById === aktor.id) throw new KoreksiError("Pemohon tidak boleh menyetujui koreksinya sendiri — minta penyetuju lain", 403, "PEMOHON_SAMA");
    await lockRowForUpdate(tx, "goods_receipts", k.docId);
    const rencana = await rencanaKoreksiGR(tx, { receiptId: k.docId, perubahan: perubahanDariKoreksi(k), sekarang, kecualiKoreksiId: k.id });
    if (rencana.token !== k.docToken) throw new KoreksiError("Keadaan penerimaan sudah berubah sejak koreksi diajukan — ajukan ulang dengan data terbaru", 409, "KEADAAN_BERUBAH");
    if (!rencana.boleh) throw new KoreksiError(`Koreksi tidak lagi bisa diterapkan: ${rencana.penghalang[0].pesan}`, 409, rencana.penghalang[0].kode, { penghalang: rencana.penghalang });
    const hasil = await terapkanRencana(tx, { koreksi: k, receiptId: k.docId, rencana, aktorId: aktor.id, sekarang });
    await tx.warehouseCorrection.update({ where: { id: k.id }, data: { status: STATUS.POSTED, decidedById: aktor.id, decidedAt: sekarang, decisionNote: catatan ? String(catatan).slice(0, 500) : null, result: hasil } });
    k = await tx.warehouseCorrection.findUnique({ where: { id: k.id }, include: sertakan });
    await recordActivity(tx, { entityType: ENTITY_TYPES.GOODS_RECEIPT, entityId: k.docId, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { nomor: k.correctionNumber, jenis: "STOCK", alasan: k.reason, hasil, pemohon: k.requestedById } });
    return { ...bentukKoreksi(k), ulang: false };
  }, { timeout: 30_000, maxWait: 10_000 });
}

function perubahanDariKoreksi(k) {
  const ch = k.changes ?? {};
  const meta = ch.metadata?.sesudah ?? {};
  const baris = (ch.baris ?? []).map((b) => {
    const s = b.sesudah ?? {};
    const o = { barisId: b.barisId };
    if (s.kondisi !== undefined) o.kondisi = s.kondisi; if (s.catatan !== undefined) o.catatan = s.catatan;
    if (b.operasi?.length) { o.jumlahBaik = s.jumlahBaik; o.lokasi = s.lokasi; const baru = b.operasi.find((x) => x.jenis === "MASUK_BARU"); if (baru) o.bahanId = baru.materialId; }
    return o;
  });
  return { metadata: meta, baris };
}

async function akhiri(prisma, { koreksiId, aktor, catatan, sekarang, status, fase, hanyaPemohon }) {
  return prisma.$transaction(async (tx) => {
    const k = await ambilKunciKoreksi(tx, koreksiId);
    if (k.status === status) return { ...bentukKoreksi(k), ulang: true };
    if (k.status !== STATUS.PENDING) throw new KoreksiError(`Koreksi berstatus ${k.status} tidak bisa diubah`, 409, "STATUS_FINAL");
    if (hanyaPemohon && k.requestedById !== aktor.id) throw new KoreksiError("Hanya pemohon yang dapat membatalkan koreksinya", 403, "BUKAN_PEMOHON");
    if (!hanyaPemohon && k.requestedById && k.requestedById === aktor.id) throw new KoreksiError("Pemohon tidak memutuskan koreksinya sendiri — gunakan Batalkan", 403, "PEMOHON_SAMA");
    await tx.warehouseCorrection.update({ where: { id: k.id }, data: { status, decidedById: aktor.id, decidedAt: sekarang, decisionNote: catatan ? String(catatan).slice(0, 500) : null } });
    const baru = await tx.warehouseCorrection.findUnique({ where: { id: k.id }, include: sertakan });
    await recordActivity(tx, { entityType: ENTITY_TYPES.WAREHOUSE_CORRECTION, entityId: k.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { fase, nomor: k.correctionNumber, catatan: catatan ?? null } });
    return { ...bentukKoreksi(baru), ulang: false };
  }, { timeout: 30_000, maxWait: 10_000 });
}
export const tolakKoreksi = (prisma, a) => { if (!String(a.catatan ?? "").trim() || String(a.catatan).trim().length < 5) throw new KoreksiError("Alasan penolakan wajib diisi (min 5 karakter)", 400, "ALASAN_WAJIB"); return akhiri(prisma, { ...a, sekarang: a.sekarang ?? new Date(), status: STATUS.REJECTED, fase: "DITOLAK", hanyaPemohon: false }); };
export const batalkanKoreksi = (prisma, a) => akhiri(prisma, { ...a, sekarang: a.sekarang ?? new Date(), status: STATUS.CANCELLED, fase: "DIBATALKAN", hanyaPemohon: true });

// ───────────────────────────── baca ─────────────────────────────
export async function daftarKoreksi(db, { status = null, docId = null, docType = null, limit = 100, offset = 0 } = {}) {
  const where = { ...(status && { status }), ...(docId && { docId }), ...(docType && { docType }) };
  const [total, baris] = await Promise.all([
    db.warehouseCorrection.count({ where }),
    db.warehouseCorrection.findMany({ where, orderBy: { requestedAt: "desc" }, take: Math.min(Math.max(limit, 1), 200), skip: Math.max(offset, 0), include: sertakan }),
  ]);
  return { total, koreksi: baris.map(bentukKoreksi) };
}
export async function ambilKoreksi(db, id) {
  const k = await db.warehouseCorrection.findUnique({ where: { id }, include: sertakan });
  if (!k) throw new KoreksiError("Koreksi tidak ditemukan", 404, "TIDAK_DITEMUKAN");
  return bentukKoreksi(k);
}
