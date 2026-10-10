// RETUR SUPPLIER & DEBIT NOTE (Okt 2026).
//
// DUA KEPUTUSAN untuk barang bermasalah — jangan dicampur:
//   1. MINTA PENGGANTI : alur penolakan saat pemeriksaan + pengiriman pengganti PO (services/finance/progresPO.js, kedatangan.js). TIDAK ada dokumen di file ini;
//                        nilai tagihan TIDAK berubah. Retur dengan keputusan selain KREDIT ditolak (GUNAKAN_ALUR_PENOLAKAN).
//   2. RETUR UNTUK KREDIT : dokumen Retur Supplier (file ini). Barang yang SUDAH masuk stok keluar gudang ke supplier.
//
// AKUNTANSI (tanpa akun baru; GRNI = "Utang Barang Belum Ditagih" dipakai sebagai penampung sementara):
//   Barang KELUAR (Gudang mengonfirmasi, stok berkurang, di bawah kunci PO → material):
//        Dr  Utang Barang Belum Ditagih (GRNI)     nilai persediaan retur (jumlah × harga perolehan penerimaan)
//            Cr  Persediaan Bahan Baku                 nilai yang sama
//     Bagian yang BELUM ditagih: GRNI turun sesuai persediaan → faktur berikutnya hanya boleh menagih sisanya (muatKonteks mengurangi "tersedia").
//     Bagian yang SUDAH ditagih faktur disetujui: faktur TIDAK diubah; lahir Debit Note (menunggu persetujuan Finance).
//   Debit Note DISETUJUI (Finance):
//        Dr  Utang Usaha                           nilai debit note (jumlah × harga FAKTUR)
//            Cr  Utang Barang Belum Ditagih (GRNI)     nilai persediaan bagian itu (menutup debit GRNI saat barang keluar)
//            Dr/Cr Selisih Harga Pembelian             selisih harga faktur vs harga perolehan
//     Faktur yang masih punya sisa utang: sisa berkurang (fin_supplier_bills.credit_applied). Bagian yang melebihi sisa (faktur sudah dibayar) → SALDO KREDIT supplier.
//   Saldo kredit dipakai pada faktur berikutnya: pilihan + konfirmasi Finance (alokasi sub-ledger, TANPA jurnal baru — Utang Usaha sudah bersaldo debit untuk supplier itu).
//   TIDAK ADA refund kas otomatis.
//
// URUTAN KUNCI (jangan diubah, sama arah dengan putaway & persetujuan faktur): retur → PO → material; debit note → faktur; saldo kredit → faktur.
// Tidak ada stok yang ditulis di luar postStockMovement (SATU pintu), tidak ada jurnal di luar postJournal/reverseJournal.
import { lockRowForUpdate, lockMaterialBalance, postStockMovement, LedgerError, RESERVED_STATUSES } from "../inventoryLedger.js";
import { postJournal, reverseJournal, generateDocumentNumber, toBookDate, todayBookDateWIB, JournalError } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { nilaiBarisPenerimaan, recomputeBillStatus } from "./posting/supplier.js";
import { toMoney, sumMoney, ZERO, moneyToNumber, allocateProportional } from "./money.js";
import { pastikanBelumDirekonsiliasi } from "./koreksiGate.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class ReturError extends Error {
  constructor(message, statusCode = 400, code = null, detail = null) { super(message); this.name = "ReturError"; this.statusCode = statusCode; if (code) this.code = code; if (detail) this.detail = detail; }
}
const gagal = (m, s = 400, c = null, d = null) => new ReturError(m, s, c, d);

export const WORKSPACE = Object.freeze({ FINANCE: "FINANCE", GUDANG: "GUDANG" });
export const ALASAN_RETUR = Object.freeze({
  RUSAK: "Barang rusak / cacat", TIDAK_SESUAI: "Tidak sesuai spesifikasi atau pesanan", KUALITAS: "Kualitas buruk (ditemukan setelah masuk stok)",
  KELEBIHAN: "Kelebihan kirim", LAINNYA: "Alasan lain (jelaskan)",
});
export const LABEL_STATUS_RETUR = Object.freeze({ DRAFT: "Draf — barang belum keluar", KELUAR: "Barang sudah keluar", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan" });
export const LABEL_STATUS_DN = Object.freeze({ MENUNGGU: "Menunggu persetujuan Finance", DISETUJUI: "Disetujui", DIBATALKAN: "Dibatalkan" });

const STATUS_KELUAR = ["KELUAR", "SELESAI"];
const STATUS_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const STATUS_DN_AKTIF = ["MENUNGGU", "DISETUJUI"];
const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;
const hariKunci = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
const tigaDesimal = (v) => Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) <= 1e-6;
const uang = (v) => moneyToNumber(toMoney(v ?? 0));

export function aktorDariSesi(user, workspace, roles) {
  if (!user?.id) throw gagal("Sesi tidak valid", 401);
  return { userId: user.id, roles: [...new Set(roles ?? [])].join(",") || String(user.role ?? ""), workspace };
}

// ── Kapasitas & blokir per baris penerimaan ─────────────────────────────

/** Jumlah retur AKTIF (barang sudah keluar) pada satu baris penerimaan. Dipakai juga oleh alur koreksi penerimaan untuk tahu batas bawah jumlah baik. */
export async function qtyReturAktif(db, goodsReceiptLineId) {
  const rl = await db.supplierReturnLine.findMany({ where: { goodsReceiptLineId, supplierReturn: { status: { in: STATUS_KELUAR } } }, select: { qty: true } });
  return dariK(rl.reduce((s, r) => s + k(r.qty), 0));
}

async function terpakaiProduksiFifo(tx, { materialId, goodsReceiptId }) {
  const mv = await tx.stockMovement.findFirst({ where: { goodsReceiptId, materialId, type: "RECEIPT" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
  if (!mv) return { sebelum: 0, terpakai: 0, mv: null };
  const [{ sebelum }] = await tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS sebelum FROM stock_movements WHERE material_id = ${materialId}::uuid AND created_at < ${mv.createdAt}`;
  const [{ net }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(qty), 0)::float AS net FROM stock_movements
    WHERE material_id = ${materialId}::uuid AND created_at > ${mv.createdAt} AND type IN ('ISSUE', 'WASTE', 'ADJUSTMENT', 'RETURN')`;
  // net = keluar (negatif) + kembali ke stok (positif). Pemakaian FIFO: yang dipakai lebih dulu menghabiskan stok yang LEBIH TUA dari penerimaan ini; sisanya baru memakan penerimaan ini.
  const [{ lain }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(m.qty), 0)::float AS lain FROM stock_movements m
    WHERE m.material_id = ${materialId}::uuid AND m.type = 'SUPPLIER_RETURN' AND m.created_at > ${mv.createdAt}
      AND m.goods_receipt_id IS NOT NULL AND m.goods_receipt_id <> ${goodsReceiptId}::uuid
      AND EXISTS (SELECT 1 FROM stock_movements r WHERE r.goods_receipt_id = m.goods_receipt_id AND r.material_id = m.material_id AND r.type = 'RECEIPT' AND r.created_at < ${mv.createdAt})`;
  const dipakai = Math.max(0, -net);
  const sebelumEfektif = Math.max(0, sebelum + lain); // lain < 0 (keluar dari stok yang lebih tua setelah penerimaan ini tiba)
  const darIni = Math.max(0, dipakai - sebelumEfektif);
  return { sebelum, terpakai: darIni, mv };
}

async function reservedMaterial(tx, materialId) {
  const [{ reserved }] = await tx.$queryRaw`
    SELECT COALESCE(SUM(qty), 0)::float AS reserved FROM (
      SELECT mil.requested_qty AS qty FROM material_issue_lines mil JOIN material_issues mi ON mi.id = mil.material_issue_id
      WHERE mil.material_id = ${materialId}::uuid AND mi.status = ANY(${RESERVED_STATUSES}::"IssueStatus"[]) AND mi.production_plan_id IS NULL
      UNION ALL
      SELECT r.qty::float FROM material_reservations_v2 r WHERE r.material_id = ${materialId}::uuid AND r.status = 'ACTIVE'
    ) u`;
  return reserved;
}

export async function periodeTertutup(db, tanggal) {
  const p = await db.finPeriod.findUnique({ where: { year_month: { year: tanggal.getUTCFullYear(), month: tanggal.getUTCMonth() + 1 } }, select: { status: true } });
  return p?.status === "CLOSED";
}

/**
 * Kapasitas retur satu baris penerimaan (semua dalam satuan stok, kelipatan 0,001).
 * Mengembalikan angka + daftar `blokir` (alasan yang jelas). Tidak menulis apa pun; `tx` boleh klien biasa untuk pratinjau.
 */
export async function kapasitasBaris(db, goodsReceiptLineId, { hitungStok = true } = {}) {
  const line = await db.goodsReceiptLine.findUnique({
    where: { id: goodsReceiptLineId },
    select: {
      id: true, acceptedQty: true, materialId: true, purchaseOrderLineId: true,
      material: { select: { id: true, code: true, name: true, unit: true } },
      goodsReceipt: { select: { id: true, receiptNumber: true, status: true, purchaseOrderId: true, receivedDate: true, createdAt: true, supplier: true, finSupplierBills: { where: { status: { in: STATUS_MASUK_BUKU } }, select: { id: true, billNumber: true } } } },
    },
  });
  if (!line) return null;
  const blokir = [];
  const gr = line.goodsReceipt;
  if (!gr.purchaseOrderId || !line.purchaseOrderLineId) blokir.push({ kode: "TANPA_PO", pesan: "Retur supplier hanya untuk penerimaan yang berasal dari PO." });
  if (gr.status !== "COMPLETED") blokir.push({ kode: "PENERIMAAN_BELUM_SELESAI", pesan: `Penerimaan ${gr.receiptNumber} belum disimpan ke stok — barangnya belum ada di stok, gunakan penolakan saat pemeriksaan.` });
  if (gr.finSupplierBills.length > 0) blokir.push({ kode: "DITAGIH_LAMA", pesan: `Penerimaan ${gr.receiptNumber} ditagih lewat tagihan lama (${gr.finSupplierBills.map((b) => b.billNumber).join(", ")}) yang menutup seluruh penerimaan — koreksi lewat koreksi tagihan, bukan retur.` });

  const diterimaK = k(line.acceptedQty);
  const returAktif = await db.supplierReturnLine.findMany({
    where: { goodsReceiptLineId, supplierReturn: { status: { in: STATUS_KELUAR } } },
    select: { qty: true, qtyUnbilled: true, qtyBilled: true },
  });
  const keluarK = returAktif.reduce((s, r) => s + k(r.qty), 0);
  const unbilledReturK = returAktif.reduce((s, r) => s + k(r.qtyUnbilled ?? 0), 0);
  const billedReturK = returAktif.reduce((s, r) => s + k(r.qtyBilled ?? 0), 0);
  const alok = await db.finSupplierBillAllocation.findMany({ where: { goodsReceiptLineId, bill: { status: { in: STATUS_MASUK_BUKU } } }, select: { qty: true } });
  const klaimK = alok.reduce((s, a) => s + k(a.qty), 0);
  const unbilledAvailK = Math.max(0, diterimaK - klaimK - unbilledReturK);
  const billedAvailK = Math.max(0, klaimK - billedReturK);
  const fisikK = Math.max(0, diterimaK - keluarK);

  let pakai = { terpakai: 0 }; let onHand = null; let reserved = null;
  if (hitungStok && gr.status === "COMPLETED") {
    pakai = await terpakaiProduksiFifo(db, { materialId: line.materialId, goodsReceiptId: gr.id });
    const [{ saldo }] = await db.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${line.materialId}::uuid`;
    onHand = saldo; reserved = await reservedMaterial(db, line.materialId);
  }
  const terpakaiK = k(pakai.terpakai);
  const batasPemakaianK = Math.max(0, fisikK - terpakaiK);
  const tersediaStokK = onHand == null ? fisikK : Math.max(0, k(onHand) - k(reserved));
  let bolehK = Math.min(fisikK, batasPemakaianK, tersediaStokK);
  if (blokir.length) bolehK = 0;
  if (!blokir.length && fisikK > 0 && bolehK === 0) {
    if (batasPemakaianK === 0) blokir.push({ kode: "DIPAKAI_PRODUKSI", pesan: `Bahan ${line.material.code} dari penerimaan ${gr.receiptNumber} sudah dipakai Produksi (${dariK(terpakaiK)} ${line.material.unit}). Selesaikan lewat alur koreksi stok (opname/penyesuaian) — bukan retur supplier.` });
    else if (tersediaStokK === 0) blokir.push({ kode: k(reserved) > 0 ? "STOK_DIRESERVASI" : "STOK_TIDAK_CUKUP", pesan: `Stok ${line.material.code} tidak cukup untuk keluar: di gudang ${dariK(k(onHand))}, direservasi ${dariK(k(reserved))}.` });
  }
  if (!blokir.length && fisikK === 0) blokir.push({ kode: "SUDAH_HABIS_DIRETUR", pesan: "Seluruh jumlah baik pada baris ini sudah diretur." });
  return {
    goodsReceiptLineId, goodsReceiptId: gr.id, nomorPenerimaan: gr.receiptNumber, purchaseOrderId: gr.purchaseOrderId, purchaseOrderLineId: line.purchaseOrderLineId,
    materialId: line.materialId, kode: line.material.code, nama: line.material.name, satuan: line.material.unit, supplier: gr.supplier,
    diterima: dariK(diterimaK), diretur: dariK(keluarK), ditagih: dariK(klaimK), belumDitagih: dariK(unbilledAvailK), sudahDitagihBisaDidebit: dariK(billedAvailK),
    terpakaiProduksi: dariK(terpakaiK), stokDiGudang: onHand, direservasi: reserved,
    bolehDiretur: dariK(bolehK), blokir,
    _k: { diterimaK, keluarK, unbilledAvailK, billedAvailK, fisikK, bolehK, terpakaiK },
  };
}

async function hargaPerolehan(tx, goodsReceiptId, materialId) {
  const mv = await tx.stockMovement.findFirst({ where: { goodsReceiptId, materialId, type: "RECEIPT" }, orderBy: { createdAt: "asc" }, select: { unitCost: true, unitCostExact: true } });
  const c = mv?.unitCostExact != null ? Number(mv.unitCostExact) : mv?.unitCost;
  return c != null && Number(c) > 0 ? Number(c) : null;
}

// ── Masukan ──────────────────────────────────────────────────────────────

const teksWajib = (v, nama, min = 1, maks = 1000) => {
  const t = String(v ?? "").trim();
  if (t.length < min) throw gagal(`${nama} wajib diisi${min > 1 ? ` (minimal ${min} karakter)` : ""}`);
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
};
function daftarBukti(v, { wajib = false, nama = "Bukti" } = {}) {
  const urls = [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (urls.length > 8) throw gagal(`${nama} maksimal 8 berkas`);
  for (const u of urls) if (u.length > 500 || !(u.startsWith("/media/receipt-proofs/") || /^https:\/\//.test(u))) throw gagal(`${nama} harus berupa berkas yang diunggah lewat aplikasi`);
  if (wajib && urls.length === 0) throw gagal(`${nama} wajib dilampirkan (minimal satu foto)`);
  return urls;
}

function siapkanMasukan(m) {
  const x = m ?? {};
  if (x.decision !== undefined && x.decision !== null && String(x.decision).toUpperCase() !== "KREDIT") {
    throw gagal("Permintaan pengganti memakai alur penolakan dan pengiriman pengganti PO (tidak ada dokumen retur dan nilai tagihan tidak berubah). Retur supplier hanya untuk keputusan kredit.", 409, "GUNAKAN_ALUR_PENOLAKAN");
  }
  const kodeAlasan = String(x.reasonCode ?? "").toUpperCase();
  if (!ALASAN_RETUR[kodeAlasan]) throw gagal("Pilih alasan retur");
  const alasan = teksWajib(x.reason, "Penjelasan alasan", 5, 1000);
  const bukti = daftarBukti(x.evidenceUrls, { wajib: true, nama: "Bukti kondisi barang" });
  const lines = Array.isArray(x.lines) ? x.lines : [];
  if (lines.length === 0) throw gagal("Minimal satu baris barang diretur");
  const dipakai = new Set();
  const baris = lines.map((l, i) => {
    const no = i + 1;
    if (!l?.goodsReceiptLineId) throw gagal(`Baris ${no}: pilih barang dari penerimaan`);
    if (dipakai.has(l.goodsReceiptLineId)) throw gagal(`Baris ${no}: baris penerimaan yang sama dipilih dua kali — gabungkan jumlahnya`);
    dipakai.add(l.goodsReceiptLineId);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw gagal(`Baris ${no}: jumlah retur harus lebih dari 0`);
    if (!tigaDesimal(qty)) throw gagal(`Baris ${no}: jumlah maksimal 3 angka di belakang koma`);
    return { goodsReceiptLineId: l.goodsReceiptLineId, qty: dariK(k(qty)), condition: l.condition ? String(l.condition).trim().slice(0, 300) : null, note: l.note ? String(l.note).trim().slice(0, 300) : null };
  });
  return { kodeAlasan, alasan, bukti, baris, catatan: x.note ? String(x.note).trim().slice(0, 500) : null };
}

/** Pratinjau SERVER (tanpa menulis): kapasitas, blokir, dan dampak keuangan per baris. `finance:false` tidak memuat nilai. */
export async function pratinjauRetur(db, masukan, { finance = false } = {}) {
  const m = siapkanMasukan({ ...masukan, evidenceUrls: masukan?.evidenceUrls?.length ? masukan.evidenceUrls : ["https://pratinjau.invalid/x"] });
  const baris = [];
  const poIds = new Set();
  for (const l of m.baris) {
    const kap = await kapasitasBaris(db, l.goodsReceiptLineId);
    if (!kap) throw gagal("Baris penerimaan tidak ditemukan", 404);
    poIds.add(kap.purchaseOrderId);
    const blokir = [...kap.blokir];
    if (k(l.qty) > kap._k.bolehK && !blokir.length) blokir.push({ kode: "JUMLAH_MELEBIHI", pesan: `Jumlah retur (${l.qty} ${kap.satuan}) melebihi yang boleh diretur (${kap.bolehDiretur} ${kap.satuan}).` });
    const bagianBelumDitagih = Math.min(k(l.qty), kap._k.unbilledAvailK);
    const bagianSudahDitagih = k(l.qty) - bagianBelumDitagih;
    if (bagianSudahDitagih > kap._k.billedAvailK && !blokir.length) blokir.push({ kode: "TIDAK_KONSISTEN", pesan: "Jumlah yang sudah ditagih tidak cukup untuk menampung retur — periksa alokasi faktur." });
    const cost = await hargaPerolehan(db, kap.goodsReceiptId, kap.materialId);
    if (cost == null && !blokir.length) blokir.push({ kode: "HARGA_TIDAK_ADA", pesan: `Harga perolehan ${kap.kode} pada ${kap.nomorPenerimaan} tidak ada — lengkapi harga di penerimaan dulu.` });
    const b = {
      goodsReceiptLineId: l.goodsReceiptLineId, nomorPenerimaan: kap.nomorPenerimaan, kode: kap.kode, nama: kap.nama, satuan: kap.satuan, qty: l.qty,
      diterima: kap.diterima, diretur: kap.diretur, bolehDiretur: kap.bolehDiretur, bagianBelumDitagih: dariK(bagianBelumDitagih), bagianSudahDitagih: dariK(bagianSudahDitagih),
      efek: bagianSudahDitagih > 0 ? "Sebagian sudah ditagih: faktur lama tidak berubah, Debit Note dibuat untuk disetujui Finance." : "Belum ditagih: jumlah yang boleh ditagih berkurang.",
      blokir, boleh: blokir.length === 0,
    };
    if (finance && cost != null) { b.nilaiPersediaan = uang(nilaiBarisPenerimaan(l.qty, cost)); b.hargaPerolehan = cost; }
    baris.push(b);
  }
  if (poIds.size > 1) throw gagal("Satu retur hanya boleh memuat barang dari satu PO", 400, "BEDA_PO");
  return { boleh: baris.every((b) => b.boleh), baris, alasan: ALASAN_RETUR[m.kodeAlasan] };
}

// ── Perintah: buat draf ──────────────────────────────────────────────────

export async function buatRetur(tx, { masukan, aktor, sekarang = new Date() }) {
  const m = siapkanMasukan(masukan);
  const kaps = [];
  for (const l of m.baris) {
    const kap = await kapasitasBaris(tx, l.goodsReceiptLineId, { hitungStok: false });
    if (!kap) throw gagal("Baris penerimaan tidak ditemukan", 404);
    if (kap.blokir.length) throw gagal(kap.blokir[0].pesan, 409, kap.blokir[0].kode);
    if (k(l.qty) > kap._k.fisikK) throw gagal(`${kap.kode} pada ${kap.nomorPenerimaan}: jumlah retur (${l.qty}) melebihi jumlah baik yang masih ada (${dariK(kap._k.fisikK)} ${kap.satuan})`, 409, "JUMLAH_MELEBIHI");
    kaps.push(kap);
  }
  const poIds = new Set(kaps.map((c) => c.purchaseOrderId));
  if (poIds.size > 1) throw gagal("Satu retur hanya boleh memuat barang dari satu PO", 400, "BEDA_PO");
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: kaps[0].purchaseOrderId }, select: { id: true, poNumber: true, supplierId: true } });
  const nomor = await generateDocumentNumber(tx, "RTS", todayBookDateWIB(sekarang));
  const r = await tx.supplierReturn.create({
    data: {
      returnNumber: nomor, supplierId: po.supplierId, purchaseOrderId: po.id, decision: "KREDIT", status: "DRAFT", reasonCode: m.kodeAlasan, reason: m.alasan,
      evidenceUrls: m.bukti, note: m.catatan, createdById: aktor.userId,
      lines: { create: m.baris.map((l, i) => ({ goodsReceiptLineId: l.goodsReceiptLineId, purchaseOrderLineId: kaps[i].purchaseOrderLineId, materialId: kaps[i].materialId, qty: l.qty, condition: l.condition, note: l.note })) },
    },
  });
  await recordActivity(tx, { entityType: ENTITY_TYPES.SUPPLIER_RETURN, entityId: r.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktor.userId, metadata: { aksi: "retur_dibuat", nomor, po: po.poNumber, alasan: m.kodeAlasan, workspace: aktor.workspace, roles: aktor.roles } });
  return { returnId: r.id, returnNumber: nomor };
}

// ── Perintah: konfirmasi barang keluar ───────────────────────────────────

/** Rencana pembagian bagian yang sudah ditagih ke faktur (urut: faktur yang masih punya sisa utang dulu, lalu yang terbaru). */
async function rencanaDebitNote(tx, { goodsReceiptLineId, qtyBilledK }) {
  const alok = await tx.finSupplierBillAllocation.findMany({
    where: { goodsReceiptLineId, bill: { status: { in: STATUS_MASUK_BUKU } } },
    select: {
      qty: true, billId: true, billPoLine: { select: { invoiceUnitPrice: true } },
      bill: { select: { id: true, billNumber: true, amount: true, creditApplied: true, createdAt: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } } },
    },
  });
  const sudah = await tx.finSupplierDebitNoteLine.findMany({ where: { goodsReceiptLineId, debitNote: { status: { in: STATUS_DN_AKTIF } } }, select: { billId: true, qty: true } });
  const terpakai = new Map();
  for (const s of sudah) terpakai.set(s.billId, (terpakai.get(s.billId) ?? 0) + k(s.qty));
  const kandidat = alok.map((a) => {
    const bayar = a.bill.allocations.length ? sumMoney(a.bill.allocations.map((x) => x.amount)) : ZERO;
    const sisa = toMoney(a.bill.amount).minus(bayar).minus(toMoney(a.bill.creditApplied ?? 0));
    return { billId: a.billId, billNumber: a.bill.billNumber, createdAt: a.bill.createdAt, hargaFaktur: Number(a.billPoLine.invoiceUnitPrice), kapK: k(a.qty) - (terpakai.get(a.billId) ?? 0), punyaSisa: sisa.greaterThan(0) };
  }).filter((c) => c.kapK > 0);
  kandidat.sort((a, b) => (a.punyaSisa === b.punyaSisa ? b.createdAt - a.createdAt : a.punyaSisa ? -1 : 1));
  const hasil = []; let butuh = qtyBilledK;
  for (const c of kandidat) {
    if (butuh <= 0) break;
    const ambil = Math.min(butuh, c.kapK);
    hasil.push({ billId: c.billId, billNumber: c.billNumber, qtyK: ambil, hargaFaktur: c.hargaFaktur });
    butuh -= ambil;
  }
  if (butuh > 0) throw gagal("Alokasi faktur tidak cukup untuk menampung bagian yang sudah ditagih — periksa faktur dan debit note yang sudah ada.", 409, "ALOKASI_TIDAK_CUKUP");
  return hasil;
}

async function bukaDebitNote(tx, { retur, barisKeluar, aktor, sekarang }) {
  const lines = [];
  let stockTotal = ZERO; let amountTotal = ZERO;
  for (const b of barisKeluar) {
    if (k(b.qtyBilled) <= 0) continue;
    const plan = await rencanaDebitNote(tx, { goodsReceiptLineId: b.goodsReceiptLineId, qtyBilledK: k(b.qtyBilled) });
    const nilaiStok = allocateProportional(toMoney(b.stockValueBilled), plan.map((p) => dariK(p.qtyK)));
    plan.forEach((p, i) => {
      const amount = nilaiBarisPenerimaan(dariK(p.qtyK), p.hargaFaktur);
      lines.push({ returnLineId: b.id, billId: p.billId, goodsReceiptLineId: b.goodsReceiptLineId, qty: dariK(p.qtyK), invoiceUnitPrice: p.hargaFaktur, amount, stockValue: nilaiStok[i] });
      amountTotal = amountTotal.plus(amount); stockTotal = stockTotal.plus(nilaiStok[i]);
    });
  }
  if (lines.length === 0) return null;
  const nomor = await generateDocumentNumber(tx, "DN", todayBookDateWIB(sekarang));
  const dn = await tx.finSupplierDebitNote.create({
    data: {
      debitNumber: nomor, supplierId: retur.supplierId, returnId: retur.id, status: "MENUNGGU", amount: amountTotal, stockValue: stockTotal, createdById: aktor.userId,
      lines: { create: lines.map((l) => ({ ...l })) },
    },
  });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_DEBIT_NOTE, entityId: dn.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktor.userId, metadata: { aksi: "debit_note_dibuat", nomor, retur: retur.returnNumber, amount: amountTotal.toFixed(2), workspace: aktor.workspace } });
  return dn;
}

export async function keluarkanBarang(tx, { returnId, masukan, aktor, sekarang = new Date() }) {
  const m = masukan ?? {};
  const pic = teksWajib(m.pic, "PIC yang menyerahkan barang", 2, 120);
  const catatan = m.note ? String(m.note).trim().slice(0, 500) : null;
  const bukti = daftarBukti(m.proofUrls, { nama: "Bukti penyerahan" });
  const hari = todayBookDateWIB(sekarang);
  const tanggal = m.date ? toBookDate(m.date) : hari;
  if (tanggal.getTime() > hari.getTime()) throw gagal("Tanggal barang keluar tidak boleh di masa depan");

  if (await periodeTertutup(tx, tanggal)) throw gagal(`Periode ${String(tanggal.getUTCMonth() + 1).padStart(2, "0")}/${tanggal.getUTCFullYear()} sudah ditutup — barang tidak bisa dikonfirmasi keluar dengan tanggal itu. Pilih tanggal di periode yang masih terbuka atau minta Finance membuka periodenya.`, 409, "PERIODE_TERTUTUP");
  await lockRowForUpdate(tx, "supplier_returns", returnId);
  const retur = await tx.supplierReturn.findUnique({ where: { id: returnId }, include: { lines: { include: { material: { select: { code: true, name: true, unit: true } } } }, supplier: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } } } });
  if (!retur) throw gagal("Retur tidak ditemukan", 404);
  if (retur.status !== "DRAFT") throw gagal(`Retur ${retur.returnNumber} berstatus ${LABEL_STATUS_RETUR[retur.status] ?? retur.status} — barang hanya bisa dikonfirmasi keluar dari draf`, 409, "STATUS_TIDAK_SESUAI");
  await lockRowForUpdate(tx, "fin_purchase_orders", retur.purchaseOrderId);

  const urut = [...retur.lines].sort((a, b) => (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : a.id < b.id ? -1 : 1));
  const barisKeluar = [];
  let totalNilai = ZERO;
  for (const l of urut) {
    await lockMaterialBalance(tx, l.materialId); // kunci material (urut id) sebelum menghitung kapasitas
    const kap = await kapasitasBaris(tx, l.goodsReceiptLineId);
    if (kap.blokir.length) throw gagal(kap.blokir[0].pesan, 409, kap.blokir[0].kode, { baris: kap.kode });
    const qK = k(l.qty);
    if (qK > kap._k.bolehK) throw gagal(`${kap.kode} pada ${kap.nomorPenerimaan}: jumlah retur (${dariK(qK)} ${kap.satuan}) melebihi yang boleh keluar (${kap.bolehDiretur} ${kap.satuan}).`, 409, "JUMLAH_MELEBIHI");
    const unbilledK = Math.min(qK, kap._k.unbilledAvailK);
    const billedK = qK - unbilledK;
    if (billedK > kap._k.billedAvailK) throw gagal(`${kap.kode}: bagian yang sudah ditagih tidak cukup untuk menampung retur.`, 409, "TIDAK_KONSISTEN");
    const cost = await hargaPerolehan(tx, kap.goodsReceiptId, kap.materialId);
    if (cost == null) throw gagal(`Harga perolehan ${kap.kode} pada ${kap.nomorPenerimaan} tidak ada — tidak bisa dinilai. Lengkapi harga penerimaan dulu.`, 409, "HARGA_TIDAK_ADA");
    const nilai = nilaiBarisPenerimaan(l.qty, cost);
    const nilaiBilled = billedK > 0 ? nilaiBarisPenerimaan(dariK(billedK), cost) : ZERO;
    const mv = await postStockMovement(tx, {
      materialId: l.materialId, type: "SUPPLIER_RETURN", qty: -Number(l.qty), unitCost: Math.round(cost), ...(Number.isInteger(cost) ? {} : { unitCostExact: String(cost) }),
      supplier: retur.supplier.name, reason: `Retur supplier ${retur.returnNumber}`, note: `${ALASAN_RETUR[retur.reasonCode]} — ${retur.reason}`.slice(0, 500),
      createdById: aktor.userId, goodsReceiptId: kap.goodsReceiptId,
    });
    await tx.supplierReturnLine.update({
      where: { id: l.id },
      data: { qtyUnbilled: dariK(unbilledK), qtyBilled: dariK(billedK), unitCost: cost, stockValue: nilai, stockValueBilled: nilaiBilled, stockMovementId: mv.id },
    });
    totalNilai = totalNilai.plus(nilai);
    barisKeluar.push({ id: l.id, goodsReceiptLineId: l.goodsReceiptLineId, qtyBilled: dariK(billedK), stockValueBilled: nilaiBilled });
  }

  const persediaan = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
  const grni = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
  await postJournal(tx, {
    date: tanggal, description: `Retur supplier ${retur.returnNumber} — ${retur.supplier.name} (PO ${retur.purchaseOrder.poNumber})`,
    source: "RETUR_SUPPLIER", sourceId: retur.id, idempotencyKey: `RETUR_SUPPLIER:${retur.id}`, userId: aktor.userId,
    lines: [
      { accountId: grni.id, debit: totalNilai, description: `Barang diretur ke ${retur.supplier.name} (${retur.returnNumber})`, supplierId: retur.supplierId },
      { accountId: persediaan.id, credit: totalNilai, description: `Barang keluar gudang — retur ${retur.returnNumber}` },
    ],
  });

  const dn = await bukaDebitNote(tx, { retur, barisKeluar, aktor, sekarang });
  await tx.supplierReturn.update({
    where: { id: retur.id },
    data: { status: dn ? "KELUAR" : "SELESAI", returnDate: tanggal, dispatchedById: aktor.userId, dispatchedAt: sekarang, dispatchPic: pic, dispatchNote: catatan, dispatchProofUrls: bukti },
  });
  await recordActivity(tx, { entityType: ENTITY_TYPES.SUPPLIER_RETURN, entityId: retur.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: aktor.userId, metadata: { nomor: retur.returnNumber, aksi: "barang_keluar", pic, nilai: totalNilai.toFixed(2), debitNote: dn?.debitNumber ?? null, workspace: aktor.workspace, roles: aktor.roles } });
  return { returnId: retur.id, returnNumber: retur.returnNumber, debitNoteId: dn?.id ?? null, debitNumber: dn?.debitNumber ?? null, status: dn ? "KELUAR" : "SELESAI" };
}

// ── Debit Note: pratinjau, setujui, batal ────────────────────────────────

async function muatDebitNote(tx, id) {
  return tx.finSupplierDebitNote.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { id: "asc" }, include: { bill: { select: { id: true, billNumber: true, supplierRef: true, status: true, amount: true, creditApplied: true } } } },
      supplierReturn: { select: { id: true, returnNumber: true, status: true } },
      supplier: { select: { id: true, name: true } },
      credit: true,
    },
  });
}

async function sisaFaktur(tx, billId) {
  const b = await tx.finSupplierBill.findUnique({ where: { id: billId }, select: { amount: true, creditApplied: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } } });
  const bayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
  return toMoney(b.amount).minus(bayar).minus(toMoney(b.creditApplied ?? 0));
}

/** Pratinjau SERVER: berapa yang mengurangi sisa tiap faktur, berapa yang menjadi saldo kredit, dan jurnalnya. Murni baca. */
export async function pratinjauDebitNote(db, debitNoteId) {
  const dn = await muatDebitNote(db, debitNoteId);
  if (!dn) throw gagal("Debit note tidak ditemukan", 404);
  const perFaktur = new Map();
  const baris = [];
  let kredit = ZERO; let kurangi = ZERO;
  const tersisa = new Map();
  for (const l of dn.lines) {
    if (!tersisa.has(l.billId)) tersisa.set(l.billId, dn.status === "MENUNGGU" ? await sisaFaktur(db, l.billId) : ZERO);
    const sisa = tersisa.get(l.billId);
    const amount = toMoney(l.amount);
    const terapkan = dn.status === "MENUNGGU" ? (sisa.lessThan(amount) ? (sisa.greaterThan(0) ? sisa : ZERO) : amount) : toMoney(l.appliedToBill);
    const kreditL = dn.status === "MENUNGGU" ? amount.minus(terapkan) : toMoney(l.creditAmount);
    if (dn.status === "MENUNGGU") tersisa.set(l.billId, sisa.minus(terapkan));
    kurangi = kurangi.plus(terapkan); kredit = kredit.plus(kreditL);
    const cur = perFaktur.get(l.billId) ?? { billId: l.billId, nomor: l.bill.billNumber, nomorFaktur: l.bill.supplierRef, status: l.bill.status, nilaiDebit: ZERO, kurangiSisa: ZERO, jadiKredit: ZERO };
    cur.nilaiDebit = cur.nilaiDebit.plus(amount); cur.kurangiSisa = cur.kurangiSisa.plus(terapkan); cur.jadiKredit = cur.jadiKredit.plus(kreditL);
    perFaktur.set(l.billId, cur);
    baris.push({ id: l.id, billId: l.billId, nomorFaktur: l.bill.billNumber, qty: Number(l.qty), hargaFaktur: Number(l.invoiceUnitPrice), nilai: uang(amount), nilaiPersediaan: uang(l.stockValue), kurangiSisa: uang(terapkan), jadiKredit: uang(kreditL) });
  }
  const selisih = toMoney(dn.amount).minus(toMoney(dn.stockValue));
  return {
    id: dn.id, nomor: dn.debitNumber, status: dn.status, statusLabel: LABEL_STATUS_DN[dn.status], retur: dn.supplierReturn, supplier: dn.supplier,
    nilai: uang(dn.amount), nilaiPersediaan: uang(dn.stockValue), selisihHarga: uang(selisih), kurangiSisaUtang: uang(kurangi), jadiSaldoKredit: uang(kredit),
    perFaktur: [...perFaktur.values()].map((f) => ({ ...f, nilaiDebit: uang(f.nilaiDebit), kurangiSisa: uang(f.kurangiSisa), jadiKredit: uang(f.jadiKredit) })),
    baris,
    jurnal: [
      { akun: "Utang Usaha", debit: uang(dn.amount), kredit: 0 },
      { akun: "Utang Barang Belum Ditagih", debit: 0, kredit: uang(dn.stockValue) },
      ...(selisih.isZero() ? [] : [{ akun: "Selisih Harga Pembelian", debit: selisih.isNegative() ? uang(selisih.negated()) : 0, kredit: selisih.isNegative() ? 0 : uang(selisih) }]),
    ],
    keterangan: "Faktur yang sudah disetujui tidak diubah; sisa utangnya berkurang. Bagian yang melebihi sisa (faktur sudah dibayar) menjadi saldo kredit supplier — tidak ada uang kembali otomatis.",
  };
}

export async function setujuiDebitNote(tx, { debitNoteId, catatan = null, sisaDiharapkan = undefined, aktor, sekarang = new Date() }) {
  await lockRowForUpdate(tx, "fin_supplier_debit_notes", debitNoteId);
  const dn = await muatDebitNote(tx, debitNoteId);
  if (!dn) throw gagal("Debit note tidak ditemukan", 404);
  if (dn.status !== "MENUNGGU") throw gagal(`Debit note ${dn.debitNumber} berstatus ${LABEL_STATUS_DN[dn.status] ?? dn.status} — hanya yang menunggu persetujuan yang bisa disetujui`, 409, "STATUS_TIDAK_SESUAI");
  if (dn.supplierReturn.status === "DIBATALKAN") throw gagal("Retur induk sudah dibatalkan", 409);
  const idFaktur = [...new Set(dn.lines.map((l) => l.billId))].sort();
  for (const id of idFaktur) await lockRowForUpdate(tx, "fin_supplier_bills", id);
  for (const id of idFaktur) await pastikanBelumDirekonsiliasi(tx, [{ source: "TAGIHAN_SUPPLIER", sourceId: id }]);
  const pre = await pratinjauDebitNote(tx, debitNoteId);
  if (sisaDiharapkan !== undefined && sisaDiharapkan !== null && Math.abs(Number(sisaDiharapkan) - pre.kurangiSisaUtang) > 0.004) {
    throw gagal(`Sisa utang faktur berubah sejak pratinjau (sekarang debit note mengurangi ${pre.kurangiSisaUtang}). Muat ulang pratinjau lalu setujui lagi.`, 409, "PRATINJAU_USANG");
  }
  for (const id of idFaktur) {
    const b = await tx.finSupplierBill.findUnique({ where: { id }, select: { status: true, billNumber: true } });
    if (!STATUS_MASUK_BUKU.includes(b.status)) throw gagal(`Faktur ${b.billNumber} berstatus ${b.status} — debit note hanya untuk faktur yang sudah disetujui`, 409, "FAKTUR_TIDAK_AKTIF");
  }
  const tersisa = new Map();
  let kredit = ZERO; const tambahan = new Map();
  for (const l of dn.lines) {
    if (!tersisa.has(l.billId)) tersisa.set(l.billId, await sisaFaktur(tx, l.billId));
    const sisa = tersisa.get(l.billId);
    const amount = toMoney(l.amount);
    const terapkan = sisa.greaterThan(0) ? (sisa.lessThan(amount) ? sisa : amount) : ZERO;
    const kreditL = amount.minus(terapkan);
    tersisa.set(l.billId, sisa.minus(terapkan));
    await tx.finSupplierDebitNoteLine.update({ where: { id: l.id }, data: { appliedToBill: terapkan, creditAmount: kreditL } });
    tambahan.set(l.billId, (tambahan.get(l.billId) ?? ZERO).plus(terapkan));
    kredit = kredit.plus(kreditL);
  }
  for (const [billId, tambah] of tambahan) {
    if (tambah.greaterThan(0)) await tx.finSupplierBill.update({ where: { id: billId }, data: { creditApplied: { increment: tambah } } });
    await recomputeBillStatus(tx, billId);
  }
  const utang = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
  const grni = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
  const selisih = toMoney(dn.amount).minus(toMoney(dn.stockValue));
  const lines = [
    { accountId: utang.id, debit: toMoney(dn.amount), description: `Debit note ${dn.debitNumber} — ${dn.supplier.name}`, supplierId: dn.supplierId },
    { accountId: grni.id, credit: toMoney(dn.stockValue), description: `Penutup retur ${dn.supplierReturn.returnNumber}`, supplierId: dn.supplierId },
  ];
  if (!selisih.isZero()) {
    const akun = await resolveAccount(tx, SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN);
    lines.push({ accountId: akun.id, ...(selisih.isNegative() ? { debit: selisih.negated() } : { credit: selisih }), description: "Selisih harga faktur vs harga perolehan (retur)", supplierId: dn.supplierId });
  }
  const hari = todayBookDateWIB(sekarang);
  if (await periodeTertutup(tx, hari)) throw gagal(`Periode ${String(hari.getUTCMonth() + 1).padStart(2, "0")}/${hari.getUTCFullYear()} sudah ditutup — debit note tidak bisa disetujui sekarang. Buka kembali periodenya (Finance › Pengaturan) lalu setujui lagi.`, 409, "PERIODE_TERTUTUP");
  await postJournal(tx, {
    date: hari, description: `Debit note ${dn.debitNumber} — ${dn.supplier.name} (retur ${dn.supplierReturn.returnNumber})`, source: "DEBIT_NOTE_SUPPLIER", sourceId: dn.id,
    idempotencyKey: `DEBIT_NOTE_SUPPLIER:${dn.id}`, userId: aktor.userId, lines,
  });
  if (kredit.greaterThan(0)) await tx.finSupplierCredit.create({ data: { supplierId: dn.supplierId, debitNoteId: dn.id, amount: kredit } });
  await tx.finSupplierDebitNote.update({ where: { id: dn.id }, data: { status: "DISETUJUI", approvedById: aktor.userId, approvedAt: sekarang, approvalNote: catatan ? String(catatan).trim().slice(0, 500) : null } });
  await tx.supplierReturn.update({ where: { id: dn.returnId }, data: { status: "SELESAI" } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_DEBIT_NOTE, entityId: dn.id, eventType: EVENT_TYPES.DOCUMENT_APPROVED, actorId: aktor.userId, metadata: { nomor: dn.debitNumber, amount: toMoney(dn.amount).toFixed(2), kurangiSisa: pre.kurangiSisaUtang, saldoKredit: kredit.toFixed(2), workspace: aktor.workspace, roles: aktor.roles } });
  return { debitNoteId: dn.id, debitNumber: dn.debitNumber, kurangiSisaUtang: pre.kurangiSisaUtang, saldoKredit: uang(kredit) };
}

export async function batalkanDebitNote(tx, { debitNoteId, alasan, aktor, sekarang = new Date() }) {
  const r = teksWajib(alasan, "Alasan pembatalan", 5, 500);
  await lockRowForUpdate(tx, "fin_supplier_debit_notes", debitNoteId);
  const dn = await muatDebitNote(tx, debitNoteId);
  if (!dn) throw gagal("Debit note tidak ditemukan", 404);
  if (dn.status === "DIBATALKAN") throw gagal("Debit note ini sudah dibatalkan", 409, "SUDAH_DIBATALKAN");
  if (dn.status === "DISETUJUI") {
    const idFaktur = [...new Set(dn.lines.map((l) => l.billId))].sort();
    for (const id of idFaktur) await lockRowForUpdate(tx, "fin_supplier_bills", id);
    for (const id of idFaktur) await pastikanBelumDirekonsiliasi(tx, [{ source: "TAGIHAN_SUPPLIER", sourceId: id }]);
    if (dn.credit) {
      await lockRowForUpdate(tx, "fin_supplier_credits", dn.credit.id);
      const kr = await tx.finSupplierCredit.findUnique({ where: { id: dn.credit.id } });
      if (toMoney(kr.usedAmount).greaterThan(0)) throw gagal("Saldo kredit dari debit note ini sudah dipakai pada faktur lain — batalkan pemakaiannya dulu.", 409, "KREDIT_SUDAH_DIPAKAI");
      await tx.finSupplierCredit.update({ where: { id: kr.id }, data: { status: "DIBATALKAN", cancelledAt: sekarang } });
    }
    const jurnal = await tx.finJournalEntry.findFirst({ where: { source: "DEBIT_NOTE_SUPPLIER", sourceId: dn.id, status: "POSTED" }, select: { id: true } });
    if (jurnal) await reverseJournal(tx, { entryId: jurnal.id, reason: `Debit note ${dn.debitNumber} dibatalkan: ${r}`, userId: aktor.userId });
    const tambah = new Map();
    for (const l of dn.lines) tambah.set(l.billId, (tambah.get(l.billId) ?? ZERO).plus(toMoney(l.appliedToBill)));
    for (const [billId, v] of tambah) {
      if (v.greaterThan(0)) await tx.finSupplierBill.update({ where: { id: billId }, data: { creditApplied: { decrement: v } } });
      await recomputeBillStatus(tx, billId);
    }
  }
  await tx.finSupplierDebitNote.update({ where: { id: dn.id }, data: { status: "DIBATALKAN", cancelledById: aktor.userId, cancelledAt: sekarang, cancelReason: r } });
  if (dn.supplierReturn.status === "SELESAI") await tx.supplierReturn.update({ where: { id: dn.returnId }, data: { status: "KELUAR" } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_DEBIT_NOTE, entityId: dn.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: aktor.userId, metadata: { nomor: dn.debitNumber, alasan: r, sebelum: dn.status, workspace: aktor.workspace } });
  return { debitNoteId: dn.id, debitNumber: dn.debitNumber };
}

/** Buat debit note ulang untuk retur yang debit note-nya dibatalkan (barang sudah keluar, kredit belum). */
export async function buatDebitNoteUlang(tx, { returnId, aktor, sekarang = new Date() }) {
  await lockRowForUpdate(tx, "supplier_returns", returnId);
  const retur = await tx.supplierReturn.findUnique({ where: { id: returnId }, include: { lines: true } });
  if (!retur) throw gagal("Retur tidak ditemukan", 404);
  if (retur.status !== "KELUAR") throw gagal(`Retur ${retur.returnNumber} berstatus ${LABEL_STATUS_RETUR[retur.status] ?? retur.status} — debit note ulang hanya untuk retur yang barangnya sudah keluar dan belum punya debit note aktif`, 409, "STATUS_TIDAK_SESUAI");
  const aktif = await tx.finSupplierDebitNote.count({ where: { returnId, status: { in: STATUS_DN_AKTIF } } });
  if (aktif > 0) throw gagal("Retur ini sudah punya debit note aktif", 409, "SUDAH_ADA");
  const barisKeluar = retur.lines.map((l) => ({ id: l.id, goodsReceiptLineId: l.goodsReceiptLineId, qtyBilled: l.qtyBilled, stockValueBilled: l.stockValueBilled ?? ZERO }));
  const dn = await bukaDebitNote(tx, { retur, barisKeluar, aktor, sekarang });
  if (!dn) throw gagal("Retur ini tidak memiliki bagian yang sudah ditagih — tidak perlu debit note.", 409, "TANPA_BAGIAN_DITAGIH");
  return { debitNoteId: dn.id, debitNumber: dn.debitNumber };
}

// ── Batalkan retur ───────────────────────────────────────────────────────

export async function batalkanRetur(tx, { returnId, alasan, aktor, sekarang = new Date() }) {
  const r = teksWajib(alasan, "Alasan pembatalan", 5, 500);
  await lockRowForUpdate(tx, "supplier_returns", returnId);
  const retur = await tx.supplierReturn.findUnique({ where: { id: returnId }, include: { lines: true, debitNotes: { select: { id: true, status: true, debitNumber: true } } } });
  if (!retur) throw gagal("Retur tidak ditemukan", 404);
  if (retur.status === "DIBATALKAN") throw gagal("Retur ini sudah dibatalkan", 409, "SUDAH_DIBATALKAN");
  if (retur.status === "DRAFT") {
    await tx.supplierReturn.update({ where: { id: retur.id }, data: { status: "DIBATALKAN", cancelledById: aktor.userId, cancelledAt: sekarang, cancelReason: r } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.SUPPLIER_RETURN, entityId: retur.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: aktor.userId, metadata: { nomor: retur.returnNumber, alasan: r, sebelum: "DRAFT", workspace: aktor.workspace } });
    return { returnId: retur.id, returnNumber: retur.returnNumber, status: "DIBATALKAN" };
  }
  const disetujui = retur.debitNotes.find((d) => d.status === "DISETUJUI");
  if (disetujui) throw gagal(`Debit note ${disetujui.debitNumber} sudah disetujui — batalkan debit note-nya dulu (Finance), baru retur ini.`, 409, "DEBIT_NOTE_DISETUJUI");
  await lockRowForUpdate(tx, "fin_purchase_orders", retur.purchaseOrderId);
  for (const d of retur.debitNotes.filter((x) => x.status === "MENUNGGU")) {
    await tx.finSupplierDebitNote.update({ where: { id: d.id }, data: { status: "DIBATALKAN", cancelledById: aktor.userId, cancelledAt: sekarang, cancelReason: `Retur ${retur.returnNumber} dibatalkan: ${r}` } });
  }
  const urut = [...retur.lines].sort((a, b) => (a.materialId < b.materialId ? -1 : 1));
  for (const l of urut) {
    await lockMaterialBalance(tx, l.materialId);
    const mv = await postStockMovement(tx, {
      materialId: l.materialId, type: "SUPPLIER_RETURN", qty: Number(l.qty), unitCost: l.unitCost != null ? Math.round(Number(l.unitCost)) : undefined,
      ...(l.unitCost != null && !Number.isInteger(Number(l.unitCost)) ? { unitCostExact: String(l.unitCost) } : {}),
      reason: `Pembatalan retur supplier ${retur.returnNumber}`, note: r.slice(0, 500), createdById: aktor.userId,
      goodsReceiptId: (await tx.goodsReceiptLine.findUnique({ where: { id: l.goodsReceiptLineId }, select: { goodsReceiptId: true } })).goodsReceiptId,
    });
    await tx.supplierReturnLine.update({ where: { id: l.id }, data: { reversalMovementId: mv.id } });
  }
  const jurnal = await tx.finJournalEntry.findFirst({ where: { source: "RETUR_SUPPLIER", sourceId: retur.id, status: "POSTED" }, select: { id: true } });
  if (jurnal) await reverseJournal(tx, { entryId: jurnal.id, reason: `Retur ${retur.returnNumber} dibatalkan: ${r}`, userId: aktor.userId });
  await tx.supplierReturn.update({ where: { id: retur.id }, data: { status: "DIBATALKAN", cancelledById: aktor.userId, cancelledAt: sekarang, cancelReason: r } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.SUPPLIER_RETURN, entityId: retur.id, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: aktor.userId, metadata: { nomor: retur.returnNumber, alasan: r, sebelum: retur.status, workspace: aktor.workspace, roles: aktor.roles } });
  return { returnId: retur.id, returnNumber: retur.returnNumber, status: "DIBATALKAN" };
}

// ── Saldo kredit supplier ────────────────────────────────────────────────

export async function ringkasKredit(db, { supplierId = null } = {}) {
  const kredit = await db.finSupplierCredit.findMany({
    where: { status: "AKTIF", ...(supplierId && { supplierId }) },
    include: { supplier: { select: { id: true, name: true, code: true } }, debitNote: { select: { id: true, debitNumber: true } }, applications: { where: { status: "AKTIF" }, select: { id: true, amount: true, appliedAt: true, bill: { select: { id: true, billNumber: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return kredit.map((c) => ({
    id: c.id, supplierId: c.supplierId, supplier: c.supplier.name, kodeSupplier: c.supplier.code, debitNote: c.debitNote.debitNumber, debitNoteId: c.debitNote.id,
    jumlah: uang(c.amount), terpakai: uang(c.usedAmount), sisa: uang(toMoney(c.amount).minus(toMoney(c.usedAmount))),
    dibuat: c.createdAt, pemakaian: c.applications.map((a) => ({ id: a.id, jumlah: uang(a.amount), faktur: a.bill.billNumber, billId: a.bill.id, pada: a.appliedAt })),
  }));
}

/** Faktur milik supplier yang masih punya sisa utang (kandidat pemakaian kredit) + sisa kredit — pratinjau SERVER. */
export async function pratinjauPemakaianKredit(db, { creditId, billId = null, jumlah = null }) {
  const kr = await db.finSupplierCredit.findUnique({ where: { id: creditId }, include: { supplier: { select: { name: true } } } });
  if (!kr || kr.status !== "AKTIF") throw gagal("Saldo kredit tidak ditemukan atau sudah dibatalkan", 404);
  const sisaKredit = toMoney(kr.amount).minus(toMoney(kr.usedAmount));
  const faktur = await db.finSupplierBill.findMany({ where: { supplierId: kr.supplierId, status: { in: ["DISETUJUI", "DIBAYAR_SEBAGIAN"] } }, select: { id: true, billNumber: true, supplierRef: true, dueDate: true, amount: true, creditApplied: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } }, orderBy: [{ dueDate: "asc" }, { billDate: "asc" }] });
  const daftar = faktur.map((b) => {
    const bayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
    const sisa = toMoney(b.amount).minus(bayar).minus(toMoney(b.creditApplied ?? 0));
    return { billId: b.id, nomor: b.billNumber, nomorFaktur: b.supplierRef, jatuhTempo: hariKunci(b.dueDate), sisaUtang: uang(sisa), maksimalDipakai: uang(sisa.lessThan(sisaKredit) ? sisa : sisaKredit) };
  }).filter((f) => f.sisaUtang > 0);
  const hasil = { creditId, supplier: kr.supplier.name, sisaKredit: uang(sisaKredit), faktur: daftar };
  if (billId) {
    const f = daftar.find((x) => x.billId === billId);
    if (!f) throw gagal("Faktur tidak ditemukan, bukan milik supplier ini, atau sudah tidak punya sisa utang", 404, "FAKTUR_TIDAK_VALID");
    const pakai = jumlah == null || jumlah === "" ? toMoney(f.maksimalDipakai) : toMoney(jumlah);
    hasil.pilihan = { billId, nomor: f.nomor, jumlah: uang(pakai), sisaUtangSebelum: f.sisaUtang, sisaUtangSesudah: uang(toMoney(f.sisaUtang).minus(pakai)), sisaKreditSesudah: uang(sisaKredit.minus(pakai)), maksimal: f.maksimalDipakai };
  }
  return hasil;
}

export async function terapkanSaldoKredit(tx, { creditId, billId, jumlah, konfirmasi, sisaFakturDilihat, catatan = null, aktor, sekarang = new Date() }) {
  if (konfirmasi !== true) throw gagal("Pemakaian saldo kredit wajib dikonfirmasi Finance (kirim konfirmasi: true setelah melihat pratinjau).", 400, "KONFIRMASI_WAJIB");
  const n = toMoney(jumlah, { field: "jumlah" });
  if (!n.greaterThan(0)) throw gagal("Jumlah pemakaian harus lebih dari 0");
  await lockRowForUpdate(tx, "fin_supplier_credits", creditId);
  await lockRowForUpdate(tx, "fin_supplier_bills", billId);
  const kr = await tx.finSupplierCredit.findUnique({ where: { id: creditId } });
  if (!kr || kr.status !== "AKTIF") throw gagal("Saldo kredit tidak ditemukan atau sudah dibatalkan", 404);
  const bill = await tx.finSupplierBill.findUnique({ where: { id: billId }, select: { id: true, billNumber: true, supplierId: true, status: true } });
  if (!bill) throw gagal("Faktur tidak ditemukan", 404);
  if (bill.supplierId !== kr.supplierId) throw gagal(`Faktur ${bill.billNumber} bukan milik supplier saldo kredit ini`, 400, "SUPPLIER_BEDA");
  if (!["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(bill.status)) throw gagal(`Faktur ${bill.billNumber} berstatus ${bill.status} — saldo kredit hanya untuk faktur yang disetujui dan masih punya sisa utang`, 409, "FAKTUR_TIDAK_AKTIF");
  const sisaKredit = toMoney(kr.amount).minus(toMoney(kr.usedAmount));
  if (n.greaterThan(sisaKredit)) throw gagal(`Saldo kredit tinggal ${uang(sisaKredit)} — pemakaian ${uang(n)} melebihi sisa.`, 409, "KREDIT_TIDAK_CUKUP");
  const sisaFaktur_ = await sisaFaktur(tx, billId);
  if (sisaFakturDilihat !== undefined && sisaFakturDilihat !== null && Math.abs(Number(sisaFakturDilihat) - uang(sisaFaktur_)) > 0.004) {
    throw gagal(`Sisa utang faktur berubah sejak pratinjau (sekarang ${uang(sisaFaktur_)}). Muat ulang lalu konfirmasi lagi.`, 409, "PRATINJAU_USANG");
  }
  if (n.greaterThan(sisaFaktur_)) throw gagal(`Sisa utang faktur ${bill.billNumber} tinggal ${uang(sisaFaktur_)} — pemakaian ${uang(n)} melebihi sisa.`, 409, "MELEBIHI_SISA_FAKTUR");
  const app = await tx.finSupplierCreditApplication.create({ data: { creditId, billId, supplierId: kr.supplierId, amount: n, note: catatan ? String(catatan).trim().slice(0, 300) : null, appliedById: aktor.userId, appliedAt: sekarang } });
  await tx.finSupplierCredit.update({ where: { id: creditId }, data: { usedAmount: { increment: n } } });
  await tx.finSupplierBill.update({ where: { id: billId }, data: { creditApplied: { increment: n } } });
  await recomputeBillStatus(tx, billId);
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: billId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktor.userId, metadata: { aksi: "pakai_saldo_kredit", faktur: bill.billNumber, jumlah: n.toFixed(2), creditId, applicationId: app.id, workspace: aktor.workspace, roles: aktor.roles } });
  return { applicationId: app.id, jumlah: uang(n), sisaKredit: uang(sisaKredit.minus(n)), sisaFaktur: uang(sisaFaktur_.minus(n)) };
}

export async function batalkanPemakaianKredit(tx, { applicationId, alasan, aktor, sekarang = new Date() }) {
  const r = teksWajib(alasan, "Alasan pembatalan", 5, 500);
  const app0 = await tx.finSupplierCreditApplication.findUnique({ where: { id: applicationId }, select: { creditId: true, billId: true } });
  if (!app0) throw gagal("Pemakaian saldo kredit tidak ditemukan", 404);
  await lockRowForUpdate(tx, "fin_supplier_credits", app0.creditId);
  await lockRowForUpdate(tx, "fin_supplier_bills", app0.billId);
  const app = await tx.finSupplierCreditApplication.findUnique({ where: { id: applicationId } });
  if (app.status !== "AKTIF") throw gagal("Pemakaian saldo kredit ini sudah dibatalkan", 409, "SUDAH_DIBATALKAN");
  await tx.finSupplierCreditApplication.update({ where: { id: app.id }, data: { status: "DIBATALKAN", cancelledById: aktor.userId, cancelledAt: sekarang, cancelReason: r } });
  await tx.finSupplierCredit.update({ where: { id: app.creditId }, data: { usedAmount: { decrement: app.amount } } });
  await tx.finSupplierBill.update({ where: { id: app.billId }, data: { creditApplied: { decrement: app.amount } } });
  await recomputeBillStatus(tx, app.billId);
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: app.billId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktor.userId, metadata: { aksi: "batal_pakai_saldo_kredit", jumlah: toMoney(app.amount).toFixed(2), alasan: r, applicationId, workspace: aktor.workspace } });
  return { applicationId };
}

// ── Pembaca ──────────────────────────────────────────────────────────────

const includeRetur = {
  supplier: { select: { id: true, name: true, code: true } },
  purchaseOrder: { select: { id: true, poNumber: true } },
  lines: { orderBy: { id: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true } }, goodsReceiptLine: { select: { id: true, goodsReceipt: { select: { id: true, receiptNumber: true } } } } } },
  debitNotes: { orderBy: { createdAt: "asc" }, select: { id: true, debitNumber: true, status: true, amount: true, createdAt: true, approvedAt: true, credit: { select: { amount: true, usedAmount: true, status: true } } } },
};

export function bentukRetur(r, { finance = false } = {}) {
  const dn = [...r.debitNotes].reverse().find((d) => d.status !== "DIBATALKAN") ?? null;
  const bentukDn = (d) => ({ id: d.id, nomor: d.debitNumber, status: d.status, statusLabel: LABEL_STATUS_DN[d.status], ...(finance && { nilai: uang(d.amount), saldoKredit: d.credit ? uang(d.credit.amount) : 0, saldoKreditTerpakai: d.credit ? uang(d.credit.usedAmount) : 0 }) });
  return {
    id: r.id, nomor: r.returnNumber, status: r.status, statusLabel: LABEL_STATUS_RETUR[r.status] ?? r.status,
    tahap: r.status === "DRAFT" ? "Barang belum keluar" : r.status === "DIBATALKAN" ? "Dibatalkan" : dn ? (dn.status === "MENUNGGU" ? "Menunggu persetujuan debit note" : "Debit note disetujui") : "Barang keluar — tanpa debit note",
    keputusan: "KREDIT", keputusanLabel: "Retur untuk kredit",
    supplier: r.supplier, po: r.purchaseOrder, alasanKode: r.reasonCode, alasanLabel: ALASAN_RETUR[r.reasonCode] ?? r.reasonCode, alasan: r.reason, catatan: r.note, bukti: r.evidenceUrls ?? [],
    tanggalKeluar: hariKunci(r.returnDate), dibuat: r.createdAt,
    konfirmasiKeluar: r.dispatchedAt ? { pic: r.dispatchPic, catatan: r.dispatchNote, bukti: r.dispatchProofUrls ?? [], pada: r.dispatchedAt } : null,
    dibatalkan: r.status === "DIBATALKAN" ? { alasan: r.cancelReason, pada: r.cancelledAt } : null,
    lines: r.lines.map((l) => ({
      id: l.id, goodsReceiptLineId: l.goodsReceiptLineId, purchaseOrderLineId: l.purchaseOrderLineId, kode: l.material.code, nama: l.material.name, satuan: l.material.unit, qty: Number(l.qty),
      nomorPenerimaan: l.goodsReceiptLine.goodsReceipt.receiptNumber, kondisi: l.condition, catatan: l.note,
      bagianBelumDitagih: l.qtyUnbilled == null ? null : Number(l.qtyUnbilled), bagianSudahDitagih: l.qtyBilled == null ? null : Number(l.qtyBilled),
      ...(finance && { hargaPerolehan: l.unitCost == null ? null : Number(l.unitCost), nilaiPersediaan: l.stockValue == null ? null : uang(l.stockValue) }),
    })),
    debitNote: dn ? bentukDn(dn) : null,
    riwayatDebitNote: r.debitNotes.map(bentukDn),
  };
}

export async function ambilRetur(db, id, opsi) {
  const r = await db.supplierReturn.findUnique({ where: { id }, include: includeRetur });
  return r ? bentukRetur(r, opsi) : null;
}

export async function daftarRetur(db, { status = null, supplierId = null, purchaseOrderId = null, q = null, finance = false, take = 200 } = {}) {
  const rows = await db.supplierReturn.findMany({
    where: {
      ...(status && { status }), ...(supplierId && { supplierId }), ...(purchaseOrderId && { purchaseOrderId }),
      ...(q && { OR: [{ returnNumber: { contains: String(q), mode: "insensitive" } }, { supplier: { name: { contains: String(q), mode: "insensitive" } } }, { purchaseOrder: { poNumber: { contains: String(q), mode: "insensitive" } } }] }),
    },
    include: includeRetur, orderBy: { createdAt: "desc" }, take,
  });
  return rows.map((r) => bentukRetur(r, { finance }));
}

/** Baris penerimaan yang bisa diretur untuk satu PO (daftar kandidat layar). `finance:false` tanpa nilai. */
export async function kandidatRetur(db, purchaseOrderId, { finance = false } = {}) {
  const baris = await db.goodsReceiptLine.findMany({
    where: { goodsReceipt: { purchaseOrderId, status: "COMPLETED" }, acceptedQty: { gt: 0 } },
    select: { id: true, goodsReceipt: { select: { createdAt: true, receiptNumber: true } } },
    orderBy: [{ goodsReceipt: { createdAt: "asc" } }, { id: "asc" }],
  });
  const hasil = [];
  for (const b of baris) {
    const kap = await kapasitasBaris(db, b.id);
    const { _k, ...pub } = kap;
    if (!finance) { delete pub.ditagih; delete pub.belumDitagih; delete pub.sudahDitagihBisaDidebit; }
    hasil.push(pub);
  }
  return hasil;
}

export { LedgerError, JournalError };
