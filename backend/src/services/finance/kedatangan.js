// KEDATANGAN BARANG PADA PENERIMAAN (PO TERINTEGRASI FINANCE–GUDANG, Okt 2026).
//
// SATU sumber data: PO (fin_purchase_orders) → penerimaan (goods_receipts, SATU per pengiriman) → baris penerimaan. Finance dan Gudang membaca dan menulis dokumen YANG SAMA; tidak ada "PO Gudang" terpisah.
//
// PRINSIP (jangan dilanggar):
//   1. Mencatat kedatangan TIDAK menulis stok dan TIDAK membuat jurnal. Stok hanya berubah saat "Simpan ke Stok" (putaway, routes/goodsReceipt.js); faktur tidak menambah stok. SATU-SATUNYA pengecualian: koreksi jumlah
//      baik SESUDAH Simpan ke Stok (koreksiPenerimaan.js — pembalik + pengganti + jurnal koreksi, hanya bila terbukti aman, selalu lewat koreksiKedatangan).
//   2. Aktor, peran, dan workspace diambil dari SESI (parameter `aktor` diisi route) — bukan pilihan pengguna di formulir.
//   3. Tanggal tiba (arrivedDate) adalah dasar termin faktur atas PO; TIDAK berubah saat Simpan ke Stok. Koreksi tanggal/jumlah wajib beralasan, tercatat sebelum–sesudah (goods_receipt_events, append-only).
//   4. Total jumlah yang datang tidak boleh melebihi PO (barang ditolak melepas sisa). Melebihi = 409; Finance harus merevisi jumlah PO. Penegakan di bawah kunci baris penerimaan lalu PO — dua klik/permintaan
//      paralel diserialkan; yang kedua melihat hasil yang pertama (kedatangan sudah dicatat / sisa berkurang) dan TIDAK menimpa. Koreksi memakai kunci optimistis (arrivalRevision).
//   5. Jumlah fisik pendamping (mis. LEMBAR) hanya informasi kontrol — tidak masuk nilai persediaan/stok/jurnal (lib/domain/pendamping.js).
import { lockRowForUpdate } from "../inventoryLedger.js";
import { toBookDate, todayBookDateWIB } from "./journal.js";
import { aktualPendampingPenerimaan, pendampingPO, PendampingError, sama3 } from "../../lib/domain/pendamping.js";
import { hitungJatuhTempo, labelTermin } from "./termin.js";
import { sinkronJatuhTempoFakturPO } from "./jadwalJatuhTempo.js";
import { DEFINISI_PROGRES, asalPenggantiTerbuka, hitungProgresPO, ringkasProgresPO } from "./progresPO.js";
import { hitungKuantitas, hitungUlangStatus } from "./purchaseOrder.js";
import { buatGalat, pastikanTanpaReturAktifJikaAda, rencanaBaikSesudahStok, terapkanBaikSesudahStok } from "./koreksiPenerimaan.js";

export class KedatanganError extends Error {
  constructor(message, statusCode = 400, code = null, arah = null) { super(message); this.name = "KedatanganError"; this.statusCode = statusCode; if (code) this.code = code; if (arah) this.arah = arah; }
}
const gagal = (m, s = 400, c = null) => new KedatanganError(m, s, c);

export const WORKSPACE = Object.freeze({ FINANCE: "FINANCE", GUDANG: "GUDANG" });
export const STATUS_PO_BISA_DITERIMA = ["DISETUJUI", "DITERIMA_SEBAGIAN"];
const STATUS_BERJALAN = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"];
const BUKTI_MAKS = 5;

const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;
const hariKunci = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
const tigaDesimal = (v) => Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) <= 1e-6;

export const LABEL_PENERIMAAN = Object.freeze({
  DRAFT: "Draf", SCHEDULED: "Terjadwal", ARRIVED: "Tiba — menunggu pemeriksaan", INSPECTION: "Sedang diperiksa",
  READY_FOR_PUTAWAY: "Siap disimpan", COMPLETED: "Sudah masuk stok", REJECTED: "Ditolak",
});
export const STATUS_AKAN_DATANG = Object.freeze({
  MENUNGGU_KEDATANGAN: "Menunggu Kedatangan", DITERIMA_SEBAGIAN: "Diterima Sebagian", TERLAMBAT: "Terlambat", PERLU_DIPERIKSA: "Perlu Diperiksa",
  SIAP_DISIMPAN: "Siap Disimpan", SELESAI: "Selesai", DIBATALKAN: "Dibatalkan",
});
// Prioritas status utama satu PO (yang paling perlu tindakan Gudang lebih dulu).
const URUTAN_UTAMA = ["DIBATALKAN", "SELESAI", "SIAP_DISIMPAN", "PERLU_DIPERIKSA", "TERLAMBAT", "DITERIMA_SEBAGIAN", "MENUNGGU_KEDATANGAN"];

/** Aktor dari sesi: { userId, roles: "FINANCE,ADMIN", workspace }. `roles` array dari rolesOf(user). */
export function aktorDariSesi(user, workspace, roles) {
  if (!user?.id) throw gagal("Sesi tidak valid", 401);
  if (!Object.values(WORKSPACE).includes(workspace)) throw gagal("Workspace tidak dikenal", 500);
  return { userId: user.id, roles: [...new Set(roles ?? [])].join(",") || String(user.role ?? ""), workspace };
}

// ── Kuantitas ────────────────────────────────────────────────────────────
// Satu helper progres (progresPO.js) untuk Finance, Gudang, kartu, detail, dan batas jumlah datang. Definisi tiap angka ada di sana.
export const kuantitasKedatangan = hitungProgresPO;

// ── Status "Barang Akan Datang" ──────────────────────────────────────────

/** Bendera + status utama satu PO untuk halaman Gudang. `penerimaan` = [{ status }]; `kuantitas` = Map dari kuantitasKedatangan. */
export function statusBarangAkanDatang({ po, penerimaan, kuantitas, hariIni }) {
  const bendera = new Set();
  if (po.status === "DIBATALKAN") bendera.add("DIBATALKAN");
  else if (po.status === "SELESAI") bendera.add("SELESAI");
  else {
    const aktif = penerimaan.filter((r) => r.status !== "REJECTED");
    if (aktif.some((r) => ["ARRIVED", "INSPECTION"].includes(r.status))) bendera.add("PERLU_DIPERIKSA");
    if (aktif.some((r) => r.status === "READY_FOR_PUTAWAY")) bendera.add("SIAP_DISIMPAN");
    const nilai = [...kuantitas.values()];
    const adaDatang = nilai.some((q) => k(q.datang) > 0 || k(q.masukStok) > 0);
    const belumLengkap = nilai.some((q) => k(q.belumDipenuhiSupplier) > 0);
    if (!adaDatang) bendera.add("MENUNGGU_KEDATANGAN");
    else if (belumLengkap) bendera.add("DITERIMA_SEBAGIAN");
    if (po.expectedDate && hariKunci(po.expectedDate) < hariIni && belumLengkap) bendera.add("TERLAMBAT");
  }
  const utama = URUTAN_UTAMA.find((s) => bendera.has(s)) ?? "MENUNGGU_KEDATANGAN";
  return { utama, bendera: URUTAN_UTAMA.filter((s) => bendera.has(s)) };
}

// ── Bentuk keluaran (satu bentuk untuk Gudang & Finance; Finance menambah harga/termin) ──

function kekuranganPenerimaan(r, poLineById) {
  if (!r.arrivedDate) return [];
  const daftar = [];
  if (!r.deliveryNote || !String(r.deliveryNote).trim()) daftar.push("Surat jalan belum dilampirkan");
  if (!r.arrivalProofUrls?.length) daftar.push("Bukti kedatangan belum dilampirkan");
  for (const l of r.lines) {
    const p = pendampingPO({ unit: "", qty: 0, ...(poLineById.get(l.purchaseOrderLineId) ?? {}) });
    if (p?.mode === "AKTUAL" && (l.companionQty === null || l.companionQty === undefined) && k(l.receivedQty) > 0) daftar.push(`Jumlah ${p.satuan.toLowerCase()} aktual belum diisi (${l.material?.code ?? "item"})`);
  }
  return daftar;
}

/** Status jatuh tempo (informasi termin) satu penerimaan menurut snapshot termin PO. Tidak ditebak: tanpa tanggal tiba → pesan jelas. */
export function jatuhTempoPenerimaan({ po, r }) {
  const termin = po.termType ? { jenis: po.termType, hari: po.termDays } : null;
  if (!r.arrivedDate) {
    const lama = r.status === "COMPLETED"; // sudah masuk stok tetapi kedatangannya tidak pernah dicatat (dokumen lama) — jangan ditebak
    return { status: lama ? "TANGGAL_BELUM_DITETAPKAN" : "MENUNGGU_TANGGAL_PENERIMAAN", label: lama ? "Tanggal belum ditetapkan" : "Menunggu tanggal penerimaan", mulai: null, jatuhTempo: null, termin: termin ? labelTermin(termin.jenis, termin.hari) : null };
  }
  if (!termin) return { status: "TERMIN_BELUM_DITETAPKAN", label: "Termin belum ditetapkan", mulai: hariKunci(r.arrivedDate), jatuhTempo: null, termin: null };
  if (termin.jenis === "TANGGAL_KHUSUS") return { status: "TANGGAL_KHUSUS", label: "Tanggal khusus — diisi pada faktur", mulai: hariKunci(r.arrivedDate), jatuhTempo: null, termin: labelTermin(termin.jenis, termin.hari) };
  const due = hitungJatuhTempo(termin, r.arrivedDate);
  return { status: "TERJADWAL", label: `Jatuh tempo ${hariKunci(due)}`, mulai: hariKunci(r.arrivedDate), jatuhTempo: hariKunci(due), termin: labelTermin(termin.jenis, termin.hari) };
}

const includePO = {
  supplier: { select: { id: true, code: true, name: true } },
  lines: { orderBy: { sortOrder: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
};
const selectPenerimaan = {
  id: true, receiptNumber: true, status: true, deliveryNote: true, notes: true, expectedDate: true, receivedDate: true, createdAt: true,
  arrivedDate: true, arrivalRecordedAt: true, arrivalActorRoles: true, arrivalWorkspace: true, arrivalReceiver: true, arrivalNote: true, arrivalProofUrls: true, arrivalRevision: true,
  arrivalRecordedBy: { select: { id: true, name: true } },
  lines: { select: { id: true, purchaseOrderLineId: true, materialId: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true, companionQty: true, replacementForLineId: true, replacementForLine: { select: { goodsReceipt: { select: { receiptNumber: true } } } }, material: { select: { id: true, code: true, name: true, unit: true } } } },
  events: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, actorRoles: true, workspace: true, reason: true, before: true, after: true, createdAt: true, actor: { select: { id: true, name: true } } } },
};

function bentukPenerimaan(r, { po, poLineById, finance }) {
  const baris = r.lines.map((l) => {
    const pl = poLineById.get(l.purchaseOrderLineId);
    const p = pl ? pendampingPO(pl) : null;
    return {
      id: l.id, purchaseOrderLineId: l.purchaseOrderLineId, kode: l.material?.code ?? null, nama: l.material?.name ?? null, satuan: pl?.unit ?? l.material?.unit ?? null,
      dijadwalkan: l.orderedQty, datang: l.receivedQty, baik: l.acceptedQty, ditolak: l.rejectedQty,
      masukStok: r.status === "COMPLETED" ? (l.acceptedQty ?? 0) : 0,
      pendamping: p && { satuan: p.satuan, mode: p.mode, aktual: l.companionQty === null || l.companionQty === undefined ? null : Number(l.companionQty) },
      penggantiDari: l.replacementForLine ? { lineId: l.replacementForLineId, nomor: l.replacementForLine.goodsReceipt.receiptNumber } : null,
    };
  });
  return {
    id: r.id, nomor: r.receiptNumber, status: r.status, statusLabel: LABEL_PENERIMAAN[r.status] ?? r.status,
    tanggalTiba: hariKunci(r.arrivedDate), kedatanganDicatat: !!r.arrivedDate,
    dicatat: r.arrivedDate ? { oleh: r.arrivalRecordedBy?.name ?? null, peran: r.arrivalActorRoles, workspace: r.arrivalWorkspace, pada: r.arrivalRecordedAt } : null,
    penerima: r.arrivalReceiver, catatan: r.arrivalNote, suratJalan: r.deliveryNote || null, bukti: r.arrivalProofUrls ?? [], revisi: r.arrivalRevision,
    kekurangan: kekuranganPenerimaan(r, poLineById),
    tanggalDisimpanKeStok: r.status === "COMPLETED" ? hariKunci(r.receivedDate) : null,
    lines: baris,
    riwayat: r.events.map((e) => ({ id: e.id, jenis: e.type, oleh: e.actor?.name ?? null, peran: e.actorRoles, workspace: e.workspace, alasan: e.reason, sebelum: e.before, sesudah: e.after, pada: e.createdAt })),
    ...(finance && { jatuhTempo: jatuhTempoPenerimaan({ po, r }) }),
  };
}

/**
 * Bentuk satu PO "Barang Akan Datang". `finance:false` (Gudang) TIDAK memuat harga, nilai, termin, faktur, utang, atau pembayaran. `finance:true` menambah harga/nilai per baris,
 * total, termin, jatuh tempo per penerimaan, dan faktur. Jumlah yang sama untuk keduanya (satu fungsi).
 */
export async function bentukBarangAkanDatang(db, poId, { finance = false, hariIni = null } = {}) {
  const po = await db.finPurchaseOrder.findUnique({ where: { id: poId }, include: includePO });
  if (!po) return null;
  const hari = hariIni ?? hariKunci(todayBookDateWIB());
  const kuantitas = await kuantitasKedatangan(db, po.id);
  const recs = await db.goodsReceipt.findMany({ where: { purchaseOrderId: po.id }, orderBy: [{ createdAt: "asc" }, { receiptNumber: "asc" }], select: selectPenerimaan });
  const poLineById = new Map(po.lines.map((l) => [l.id, { ...l, qty: l.qty }]));
  const status = statusBarangAkanDatang({ po, penerimaan: recs, kuantitas, hariIni: hari });
  const hariTerlambat = po.expectedDate && status.bendera.includes("TERLAMBAT") ? Math.round((new Date(`${hari}T00:00:00Z`) - new Date(`${hariKunci(po.expectedDate)}T00:00:00Z`)) / 86_400_000) : 0;
  const lines = await Promise.all(po.lines.map(async (l) => {
    const q = kuantitas.get(l.id);
    const p = pendampingPO(l);
    const asalPengganti = k(q.menungguPengganti) > 0 ? await asalPenggantiTerbuka(db, l.id) : [];
    return {
      id: l.id, materialId: l.materialId, kode: l.material?.code ?? null, nama: l.material?.name ?? null, satuan: l.unit, catatan: l.notes,
      ...q, progres: q, asalPengganti,
      pendamping: p && { ...p, aktual: q.pendampingAktual },
      ...(finance && { hargaSatuan: l.unitPrice, nilaiDipesan: Math.round((q.dipesan * l.unitPrice) * 100) / 100, nilaiMasukStok: Math.round((q.masukStok * l.unitPrice) * 100) / 100 }),
    };
  }));
  const keluaran = {
    id: po.id, poNumber: po.poNumber, status: po.status,
    statusAkanDatang: { kode: status.utama, label: STATUS_AKAN_DATANG[status.utama] }, bendera: status.bendera.map((b) => ({ kode: b, label: STATUS_AKAN_DATANG[b] })),
    supplier: po.supplier, orderDate: hariKunci(po.orderDate), expectedDate: hariKunci(po.expectedDate), hariTerlambat, notes: po.notes, cancelReason: po.cancelReason,
    lines, progres: ringkasProgresPO(lines), progresDefinisi: DEFINISI_PROGRES,
    penerimaan: recs.map((r) => bentukPenerimaan(r, { po, poLineById, finance })),
  };
  if (finance) {
    keluaran.termin = po.termType ? { jenis: po.termType, hari: po.termDays, label: labelTermin(po.termType, po.termDays), sumber: po.termSource } : null;
    keluaran.terminStatus = recs.some((r) => r.arrivedDate) ? "BERJALAN_PER_PENERIMAAN" : "MENUNGGU_TANGGAL_PENERIMAAN";
    keluaran.totalDipesan = Math.round(lines.reduce((s, l) => s + (l.nilaiDipesan ?? 0), 0) * 100) / 100;
    keluaran.totalMasukStok = Math.round(lines.reduce((s, l) => s + (l.nilaiMasukStok ?? 0), 0) * 100) / 100;
  }
  return keluaran;
}

/** Daftar PO untuk halaman Barang Akan Datang. PO DRAFT tidak ditampilkan. `status` = salah satu kode STATUS_AKAN_DATANG (filter menurut bendera). */
export async function daftarBarangAkanDatang(db, { status = null, q = null, finance = false, hariIni = null } = {}) {
  const hari = hariIni ?? hariKunci(todayBookDateWIB());
  const where = {
    status: { not: "DRAFT" },
    ...(q && { OR: [{ poNumber: { contains: String(q), mode: "insensitive" } }, { supplier: { name: { contains: String(q), mode: "insensitive" } } }, { lines: { some: { material: { OR: [{ name: { contains: String(q), mode: "insensitive" } }, { code: { contains: String(q), mode: "insensitive" } }] } } } }] }),
  };
  const ids = await db.finPurchaseOrder.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 400, select: { id: true } });
  const semua = [];
  for (const { id } of ids) semua.push(await bentukBarangAkanDatang(db, id, { finance, hariIni: hari }));
  const hitungan = Object.fromEntries(Object.keys(STATUS_AKAN_DATANG).map((s) => [s, semua.filter((p) => p.bendera.some((b) => b.kode === s)).length]));
  const terpilih = status && Object.hasOwn(STATUS_AKAN_DATANG, status) ? semua.filter((p) => p.bendera.some((b) => b.kode === status)) : semua;
  // Ringkas untuk daftar: tanpa riwayat penerimaan (detail dimuat saat dibuka).
  const ringkas = terpilih.map((p) => ({ ...p, penerimaan: p.penerimaan.map(({ riwayat, ...r }) => r) }));
  return { hariIni: hari, hitungan, purchaseOrders: ringkas };
}

// ── Masukan ──────────────────────────────────────────────────────────────

function teksWajib(v, nama, min = 1, maks = 500) {
  const t = String(v ?? "").trim();
  if (t.length < min) throw gagal(`${nama} wajib diisi${min > 1 ? ` (minimal ${min} karakter)` : ""}`);
  if (t.length > maks) throw gagal(`${nama} maksimal ${maks} karakter`);
  return t;
}
function tanggalTiba(v, po, hari) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10))) throw gagal("Tanggal barang tiba wajib diisi (format YYYY-MM-DD)");
  const t = String(v).slice(0, 10);
  if (Number.isNaN(Date.parse(`${t}T00:00:00Z`))) throw gagal("Tanggal barang tiba tidak valid");
  if (t > hari) throw gagal("Tanggal barang tiba tidak boleh di masa depan");
  if (po.orderDate && t < hariKunci(po.orderDate)) throw gagal(`Tanggal barang tiba tidak boleh sebelum tanggal PO (${hariKunci(po.orderDate)})`);
  return new Date(`${t}T00:00:00.000Z`);
}
function bukti(v) {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw gagal("Bukti kedatangan harus berupa daftar berkas");
  const urls = [...new Set(v.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (urls.length > BUKTI_MAKS) throw gagal(`Bukti kedatangan maksimal ${BUKTI_MAKS} berkas`);
  for (const u of urls) if (u.length > 500 || !(u.startsWith("/media/receipt-proofs/") || /^https:\/\//.test(u))) throw gagal("Bukti kedatangan harus berupa berkas yang diunggah lewat aplikasi");
  return urls;
}
function jumlahDatang(v, nomor) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw gagal(`Baris ${nomor}: jumlah datang harus lebih dari 0`);
  if (!tigaDesimal(n)) throw gagal(`Baris ${nomor}: jumlah datang maksimal 3 angka di belakang koma`);
  if (n > 99_999_999) throw gagal(`Baris ${nomor}: jumlah datang terlalu besar`);
  return dariK(k(n));
}

// Nomor GR-DDMMYY-NN: dihitung di bawah kunci advisory transaksi supaya dua pengiriman tiba bersamaan tidak berebut nomor yang sama.
async function nomorPenerimaanBaru(tx, sekarang = new Date()) {
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "goods-receipt-number");
  const awalHari = new Date(Date.UTC(sekarang.getUTCFullYear(), sekarang.getUTCMonth(), sekarang.getUTCDate()));
  const kode = `GR-${String(sekarang.getUTCDate()).padStart(2, "0")}${String(sekarang.getUTCMonth() + 1).padStart(2, "0")}${String(sekarang.getUTCFullYear()).slice(-2)}`;
  const ada = await tx.goodsReceipt.count({ where: { createdAt: { gte: awalHari } } });
  let n = ada + 1; let nomor = `${kode}-${String(n).padStart(2, "0")}`;
  while (await tx.goodsReceipt.findUnique({ where: { receiptNumber: nomor }, select: { id: true } })) { n += 1; nomor = `${kode}-${String(n).padStart(2, "0")}`; }
  return nomor;
}

async function catatPO(tx, poId, type, aktor, { note = null, metadata = null } = {}) {
  await tx.finPurchaseOrderEvent.create({ data: { purchaseOrderId: poId, type, actorId: aktor.userId, note, metadata } });
}

async function kunciPOUntukTulis(tx, poId) {
  await lockRowForUpdate(tx, "fin_purchase_orders", poId);
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: poId }, include: { lines: { include: { material: { select: { id: true, code: true, name: true, unit: true } } } }, supplier: { select: { name: true } } } });
  if (!po) throw gagal("PO tidak ditemukan", 404);
  return po;
}

// ── Perintah: catat kedatangan ───────────────────────────────────────────

/**
 * Siapkan (atau pakai ulang) DRAF PENERIMAAN untuk pengiriman berikutnya dari PO — IDEMPOTEN. Finance atau Gudang boleh memulai lebih dulu; Gudang TIDAK perlu membuat penerimaan lebih dulu.
 * Draf = penerimaan berstatus Draf/Terjadwal yang kedatangannya belum dicatat. Bila sudah ada satu, dipakai (yang tertua); bila belum, dibuat satu (baris = yang belum datang).
 * Dipanggil DI LUAR transaksi catat (transaksi sendiri, hanya mengunci PO) supaya urutan kunci catat tetap penerimaan → PO. Tidak menulis stok/jurnal.
 * @param {import("@prisma/client").PrismaClient} db  klien utama (bukan tx)
 * Mengembalikan { receiptId, receiptNumber, dibuat }.
 */
export async function pastikanDrafPenerimaan(db, { poId, aktor, sekarang = new Date() }) {
  return db.$transaction(async (tx) => {
    const po = await kunciPOUntukTulis(tx, poId);
    if (!STATUS_PO_BISA_DITERIMA.includes(po.status)) throw gagal(`PO ${po.poNumber} berstatus ${po.status} — hanya PO yang disetujui dan belum selesai yang bisa menerima barang`, 409, "PO_TIDAK_BISA_DITERIMA");
    const ada = await tx.goodsReceipt.findFirst({ where: { purchaseOrderId: po.id, status: { in: ["DRAFT", "SCHEDULED"] }, arrivalRevision: 0 }, orderBy: [{ createdAt: "asc" }, { receiptNumber: "asc" }], select: { id: true, receiptNumber: true } });
    if (ada) return { receiptId: ada.id, receiptNumber: ada.receiptNumber, dibuat: false };
    const kuantitas = await kuantitasKedatangan(tx, po.id);
    const sisa = po.lines.filter((l) => k(kuantitas.get(l.id).belumDipenuhiSupplier) > 0);
    if (sisa.length === 0) throw gagal(`PO ${po.poNumber} sudah terpenuhi — tidak ada barang yang belum datang dan tidak ada penolakan yang menunggu pengganti. Minta Finance merevisi jumlah PO bila memang ada kiriman tambahan.`, 409, "PO_SUDAH_TERPENUHI");
    const nomor = await nomorPenerimaanBaru(tx, sekarang);
    const rec = await tx.goodsReceipt.create({
      data: {
        receiptNumber: nomor, sourceType: "PURCHASE_ORDER", sourceReference: po.poNumber, supplier: po.supplier.name, purchaseOrderId: po.id, expectedDate: po.expectedDate, createdById: aktor.userId,
        lines: { create: sisa.map((l) => ({ materialId: l.materialId, orderedQty: kuantitas.get(l.id).belumDipenuhiSupplier, purchaseOrderLineId: l.id })) },
      },
    });
    await catatPO(tx, po.id, "PENERIMAAN_DRAF_DIBUAT", aktor, { note: nomor, metadata: { receiptId: rec.id, workspace: aktor.workspace } });
    return { receiptId: rec.id, receiptNumber: rec.receiptNumber, dibuat: true };
  });
}

/** Pemeriksaan isian tanpa akses basis data (tanggal, PIC, catatan, jumlah). Pemeriksaan yang butuh PO (sebelum tanggal PO, melebihi PO) tetap di catatKedatangan. */
function validasiAwalMasukan(m, hari) {
  const x = m ?? {};
  if (!x.tanggalTiba || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.tanggalTiba).slice(0, 10)) || Number.isNaN(Date.parse(`${String(x.tanggalTiba).slice(0, 10)}T00:00:00Z`))) throw gagal("Tanggal barang tiba wajib diisi (format YYYY-MM-DD)");
  if (String(x.tanggalTiba).slice(0, 10) > hari) throw gagal("Tanggal barang tiba tidak boleh di masa depan");
  teksWajib(x.penerima, "PIC/penerima barang", 2, 120);
  teksWajib(x.catatan, "Catatan kedatangan", 1, 1000);
  const masuk = Array.isArray(x.lines) ? x.lines.filter((l) => l && l.jumlahDatang !== undefined && l.jumlahDatang !== null && l.jumlahDatang !== "" && Number(l.jumlahDatang) !== 0) : [];
  if (masuk.length === 0) throw gagal("Isi jumlah datang minimal satu item");
  masuk.forEach((l, i) => jumlahDatang(l.jumlahDatang, i + 1));
}

/**
 * Pintu resmi mencatat kedatangan dari route (Finance ATAU Gudang): tanpa `receiptId` memakai/membuat draf yang sama secara idempoten, lalu mencatat di transaksi tersendiri.
 * Dua petugas yang menekan bersamaan memakai draf yang sama; yang kedua ditolak 409 KEDATANGAN_SUDAH_DICATAT (tidak menimpa, tidak menggandakan).
 */
export async function catatKedatanganPO(db, { poId, receiptId = null, masukan, aktor, sekarang = new Date() }) {
  // Isian yang pasti salah (tanpa PIC/catatan/tanggal/jumlah) ditolak SEBELUM menyiapkan draf — penolakan murni tidak meninggalkan apa pun.
  if (!receiptId) validasiAwalMasukan(masukan, hariKunci(todayBookDateWIB(sekarang)));
  const rid = receiptId || (await pastikanDrafPenerimaan(db, { poId, aktor, sekarang })).receiptId;
  return db.$transaction((tx) => catatKedatangan(tx, { poId, receiptId: rid, masukan, aktor, sekarang }));
}

/**
 * Catat barang TIBA pada SATU pengiriman = SATU penerimaan (draf) yang sudah ada. Lewat route, gunakan `catatKedatanganPO` (menyiapkan draf bila belum ada).
 * masukan: { tanggalTiba, penerima, catatan, suratJalan?, bukti?[], lines:[{ purchaseOrderLineId, jumlahDatang, jumlahPendamping? }] }
 * aktor : { userId, roles, workspace } — dari sesi.
 * Mengembalikan { receiptId, receiptNumber, dibuat }.
 */
export async function catatKedatangan(tx, { poId, receiptId, masukan, aktor, sekarang = new Date() }) {
  const m = masukan ?? {};
  const hari = hariKunci(todayBookDateWIB(sekarang));
  // Urutan kunci: penerimaan (bila ada) → PO. Sama dengan putaway (penerimaan → PO), jadi tidak ada siklus kunci.
  if (!receiptId) throw gagal("Penerimaan wajib ditentukan (gunakan catatKedatanganPO)", 500);
  await lockRowForUpdate(tx, "goods_receipts", receiptId);
  const receipt = await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: { lines: true } });
  {
    if (!receipt || receipt.purchaseOrderId !== poId) throw gagal("Penerimaan tidak ditemukan pada PO ini", 404);
    if (receipt.arrivalRevision > 0) {
      const oleh = receipt.arrivalRecordedById ? (await tx.user.findUnique({ where: { id: receipt.arrivalRecordedById }, select: { name: true } }))?.name : null;
      throw gagal(`Kedatangan ${receipt.receiptNumber} sudah dicatat${oleh ? ` oleh ${oleh}` : ""}${receipt.arrivedDate ? ` (tiba ${hariKunci(receipt.arrivedDate)})` : ""}. Gunakan Koreksi Kedatangan bila ada yang salah.`, 409, "KEDATANGAN_SUDAH_DICATAT");
    }
    if (!["DRAFT", "SCHEDULED"].includes(receipt.status)) throw gagal(`Penerimaan ${receipt.receiptNumber} berstatus ${LABEL_PENERIMAAN[receipt.status] ?? receipt.status} — kedatangan hanya bisa dicatat pada penerimaan yang belum tiba`, 409);
  }
  const po = await kunciPOUntukTulis(tx, poId);
  if (!STATUS_PO_BISA_DITERIMA.includes(po.status)) throw gagal(`PO ${po.poNumber} berstatus ${po.status} — hanya PO yang disetujui dan belum selesai yang bisa menerima barang`, 409, "PO_TIDAK_BISA_DITERIMA");

  const tiba = tanggalTiba(m.tanggalTiba, po, hari);
  const penerima = teksWajib(m.penerima, "PIC/penerima barang", 2, 120);
  const catatan = teksWajib(m.catatan, "Catatan kedatangan", 1, 1000);
  const suratJalan = m.suratJalan === undefined || m.suratJalan === null || String(m.suratJalan).trim() === "" ? null : teksWajib(m.suratJalan, "Surat jalan", 1, 120);
  const berkas = bukti(m.bukti) ?? [];
  const masuk = Array.isArray(m.lines) ? m.lines.filter((l) => l && l.jumlahDatang !== undefined && l.jumlahDatang !== null && l.jumlahDatang !== "" && Number(l.jumlahDatang) !== 0) : [];
  if (masuk.length === 0) throw gagal("Isi jumlah datang minimal satu item");
  if (new Set(masuk.map((l) => l.purchaseOrderLineId)).size !== masuk.length) throw gagal("Baris PO yang sama diisi lebih dari sekali");

  const kuantitas = await kuantitasKedatangan(tx, po.id);
  const lineRows = [];
  for (const [i, l] of masuk.entries()) {
    const no = i + 1;
    const pl = po.lines.find((x) => x.id === l.purchaseOrderLineId);
    if (!pl) throw gagal(`Baris ${no}: bukan bagian dari ${po.poNumber}`);
    if (!receipt.lines.some((x) => x.purchaseOrderLineId === pl.id)) throw gagal(`Baris ${no}: ${pl.material.code} tidak ada pada penerimaan ${receipt.receiptNumber}`);
    const datang = jumlahDatang(l.jumlahDatang, no);
    const q = kuantitas.get(pl.id);
    let penggantiDari = null;
    if (l.pengganti === true || l.pengganti === "true") {
      // Pengiriman PENGGANTI: menutup penolakan, BUKAN pasokan baru — dibatasi sisa penolakan baris asal; tidak menaikkan batas PO.
      const asal = await asalPenggantiTerbuka(tx, pl.id);
      const terpilih = l.penggantiDariBarisId ? asal.find((a) => a.lineId === l.penggantiDariBarisId) : asal[0];
      if (!terpilih) throw gagal(`Baris ${no}: ${pl.material.code} tidak punya barang ditolak yang menunggu pengganti${l.penggantiDariBarisId ? " pada baris yang dipilih" : ""}.`, 409, "TANPA_PENOLAKAN");
      if (k(datang) > k(terpilih.sisa)) throw gagal(`Jumlah pengganti ${pl.material.code} (${datang} ${pl.unit}) melebihi barang ditolak yang menunggu pengganti pada ${terpilih.receiptNumber} (${terpilih.sisa} ${pl.unit}). Pengganti tidak menaikkan jumlah PO; catat kelebihannya di pengiriman terpisah bila memang menggantikan penolakan lain.`, 409, "MELEBIHI_PENOLAKAN");
      penggantiDari = terpilih;
    } else if (k(datang) > k(q.belumDatang)) {
      throw gagal(`Jumlah datang ${pl.material.code} (${datang} ${pl.unit}) melebihi sisa PO ${po.poNumber}: dipesan ${q.dipesan}, sudah datang ${dariK(k(q.dipesan) - k(q.belumDatang))} → belum datang ${q.belumDatang} ${pl.unit}. Total pengiriman tidak boleh melebihi PO — minta Finance merevisi jumlah PO bila memang dikirim lebih${k(q.menungguPengganti) > 0 ? `. Bila ini barang pengganti untuk penolakan (${q.menungguPengganti} ${pl.unit} menunggu pengganti), tandai sebagai pengiriman pengganti` : ""}.`, 409, "MELEBIHI_PO");
    }
    let pendamping;
    try { pendamping = aktualPendampingPenerimaan(pl, datang, l.jumlahPendamping, { nomor: no }); }
    catch (e) { if (e instanceof PendampingError) throw gagal(e.message, 400, e.code); throw e; }
    lineRows.push({ pl, datang, pendamping, penggantiDari });
  }

  const sebelum = { status: receipt.status };
  const dataKedatangan = {
    status: "ARRIVED", arrivedDate: tiba, arrivalRecordedById: aktor.userId, arrivalRecordedAt: sekarang, arrivalActorRoles: aktor.roles, arrivalWorkspace: aktor.workspace,
    arrivalReceiver: penerima, arrivalNote: catatan, arrivalProofUrls: berkas, arrivalRevision: 1, ...(suratJalan !== null && { deliveryNote: suratJalan }),
  };
  await tx.goodsReceipt.update({ where: { id: receipt.id }, data: dataKedatangan });
  for (const { pl, datang, pendamping, penggantiDari } of lineRows) {
    const baris = receipt.lines.find((x) => x.purchaseOrderLineId === pl.id);
    await tx.goodsReceiptLine.update({ where: { id: baris.id }, data: { receivedQty: datang, companionQty: pendamping, replacementForLineId: penggantiDari?.lineId ?? null } });
  }
  // Baris draf yang tidak ikut datang di pengiriman ini dibuang (draf hanya rencana; baris yang tidak tiba tidak perlu diperiksa).
  const ikut = new Set(lineRows.map((x) => x.pl.id));
  const buang = receipt.lines.filter((x) => !ikut.has(x.purchaseOrderLineId));
  if (buang.length) await tx.goodsReceiptLine.deleteMany({ where: { id: { in: buang.map((x) => x.id) } } });
  const sesudah = {
    tanggalTiba: hariKunci(tiba), penerima, catatan, suratJalan, bukti: berkas,
    lines: lineRows.map(({ pl, datang, pendamping, penggantiDari }) => ({ purchaseOrderLineId: pl.id, kode: pl.material.code, datang, pendamping, ...(penggantiDari && { penggantiDari: penggantiDari.receiptNumber }) })),
  };
  await tx.goodsReceiptEvent.create({ data: { goodsReceiptId: receipt.id, type: "KEDATANGAN_DICATAT", actorId: aktor.userId, actorRoles: aktor.roles, workspace: aktor.workspace, before: sebelum, after: sesudah } });
  await catatPO(tx, po.id, "KEDATANGAN_DICATAT", aktor, { note: receipt.receiptNumber, metadata: { receiptId: receipt.id, workspace: aktor.workspace, tanggalTiba: hariKunci(tiba), baris: sesudah.lines } });
  await sinkronJatuhTempoFakturPO(tx, po.id);
  return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, dibuat: false };
}

// ── Perintah: koreksi kedatangan ─────────────────────────────────────────
// SATU pintu koreksi penerimaan (route Gudang & Finance memanggil fungsi yang sama). Bidang yang bisa dikoreksi:
//   tanggal tiba, PIC, catatan, surat jalan, bukti, per baris: jumlah datang (KG), jumlah baik, jumlah ditolak, jumlah pendamping (lembar), kaitan pengganti.
// Aturan per tahap (detail & arah tindakan ada di pesan galat; dampak dihitung server di mode `pratinjau`):
//   ARRIVED (belum diperiksa)           : datang, pendamping, kaitan pengganti, metadata.
//   INSPECTION / READY_FOR_PUTAWAY      : + baik & ditolak (hasil pemeriksaan) — dalam transaksi; progres PO & jadwal termin yang belum terkunci dihitung ulang.
//   COMPLETED (sudah Simpan ke Stok)    : datang/ditolak/pendamping/kaitan/metadata langsung (tanpa efek stok); jumlah BAIK hanya lewat pembalik + pengganti (koreksiPenerimaan.js)
//                                         dan hanya bila terbukti aman; selain itu diblokir dengan sebab & arah tindakan.
//   Tanggal tiba yang menggeser jatuh tempo faktur DISETUJUI diblokir (TERMIN_TERKUNCI). Faktur disetujui/pembayaran/periode tertutup tidak pernah diubah diam-diam.
// Urutan kunci: penerimaan → PO → (material, di dalam postStockMovement). Retur Supplier (bila terpasang): pastikanTanpaReturAktif sebelum koreksi kuantitas.
const galatKoreksi = buatGalat(KedatanganError);
const STATUS_BISA_DIKOREKSI = ["ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];
const STATUS_PERIKSA = ["INSPECTION", "READY_FOR_PUTAWAY", "COMPLETED"];
const MASUK_BUKU_FAKTUR = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const KUNCI_PROGRES_DAMPAK = ["datangAsli", "pengganti", "datang", "belumDatang", "belumDiperiksa", "ditolak", "menungguPengganti", "baikBelumDisimpan", "masukStok", "belumDipenuhiSupplier", "belumMasukStok"];

export class PratinjauSelesai extends Error {
  constructor(hasil) { super("pratinjau"); this.name = "PratinjauSelesai"; this.hasil = hasil; }
}

function angkaKoreksi(v, nama, kode, { positif = false } = {}) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (positif && n <= 0)) throw gagal(`${kode}: jumlah ${nama} ${positif ? "harus lebih dari 0" : "tidak boleh negatif"}`);
  if (!tigaDesimal(n)) throw gagal(`${kode}: jumlah ${nama} maksimal 3 angka di belakang koma`);
  if (n > 99_999_999) throw gagal(`${kode}: jumlah ${nama} terlalu besar`);
  return dariK(k(n));
}
const ada = (v) => v !== undefined && v !== null && v !== "";

/**
 * Koreksi kedatangan yang SUDAH dicatat. Alasan wajib; tercatat sebelum–sesudah; kunci optimistis `revisiDiharapkan` (arrivalRevision yang dilihat pengguna).
 * perubahan: { tanggalTiba?, penerima?, catatan?, suratJalan?, bukti?[], lines?:[{ purchaseOrderLineId, jumlahDatang?, jumlahBaik?, jumlahDitolak?, jumlahPendamping?, penggantiDariBarisId? (id | null) }] }
 * `pratinjau: true` mengerjakan SEMUA langkah di transaksi pemanggil (yang kemudian dibatalkan — lihat jalankanKoreksiKedatangan) sehingga dampaknya IDENTIK dengan penerapan.
 * `finance: false` (Gudang) menyembunyikan nilai rupiah pada dampak.
 */
export async function koreksiKedatangan(tx, { receiptId, perubahan, alasan, revisiDiharapkan, aktor, sekarang = new Date(), pratinjau = false, finance = false }) {
  const r = pratinjau && !String(alasan ?? "").trim() ? "(pratinjau)" : teksWajib(alasan, "Alasan koreksi", 5, 500);
  const hari = hariKunci(todayBookDateWIB(sekarang));
  await lockRowForUpdate(tx, "goods_receipts", receiptId);
  const receipt = await tx.goodsReceipt.findUnique({ where: { id: receiptId }, include: { lines: { include: { material: { select: { code: true } } } } } });
  if (!receipt || !receipt.purchaseOrderId) throw gagal("Penerimaan dari PO tidak ditemukan", 404);
  if (receipt.arrivalRevision === 0 || !receipt.arrivedDate) throw gagal("Kedatangan belum dicatat — catat dulu, baru bisa dikoreksi", 409, "KEDATANGAN_BELUM_DICATAT");
  if (receipt.status === "REJECTED") throw gagal("Penerimaan yang ditolak tidak bisa dikoreksi", 409);
  if (!STATUS_BISA_DIKOREKSI.includes(receipt.status)) throw gagal(`Penerimaan ${receipt.receiptNumber} berstatus ${LABEL_PENERIMAAN[receipt.status] ?? receipt.status} — belum bisa dikoreksi`, 409);
  const revisi = Number(revisiDiharapkan);
  if (!Number.isInteger(revisi)) throw gagal("Revisi data wajib dikirim (muat ulang lalu coba lagi)", 400, "REVISI_WAJIB");
  if (revisi !== receipt.arrivalRevision) throw gagal(`Data kedatangan sudah diubah orang lain (revisi ${receipt.arrivalRevision}, Anda melihat revisi ${revisi}). Muat ulang lalu ulangi koreksi.`, 409, "REVISI_USANG");
  const po = await kunciPOUntukTulis(tx, receipt.purchaseOrderId);
  const p = perubahan ?? {};
  const data = {}; const sebelum = {}; const sesudah = {};
  const tetapkan = (kunci, lama, baru) => { sebelum[kunci] = lama; sesudah[kunci] = baru; };

  // Kondisi SEBELUM (untuk dampak): progres per baris PO + jatuh tempo faktur atas PO.
  const progresSebelum = await hitungProgresPO(tx, po.id);
  const termin = async () => (await tx.finSupplierBill.findMany({ where: { purchaseOrderId: po.id, termBasis: "TANGGAL_TIBA", status: { notIn: ["DIBATALKAN", "DITOLAK"] } }, select: { id: true, billNumber: true, status: true, dueDate: true }, orderBy: { billNumber: "asc" } }))
    .map((b) => ({ fakturId: b.id, nomor: b.billNumber, status: b.status, terkunci: MASUK_BUKU_FAKTUR.includes(b.status), jatuhTempo: hariKunci(b.dueDate) }));
  const terminSebelum = await termin();

  // ── Metadata ──
  let tanggalBerubah = false;
  if (p.tanggalTiba !== undefined) {
    const baru = tanggalTiba(p.tanggalTiba, po, hari);
    if (hariKunci(baru) !== hariKunci(receipt.arrivedDate)) {
      const terkunci = await tx.finSupplierBillAllocation.findMany({ where: { goodsReceiptId: receipt.id, bill: { status: { in: MASUK_BUKU_FAKTUR } } }, select: { bill: { select: { billNumber: true, status: true } } } });
      if (terkunci.length > 0) {
        const nomor = [...new Set(terkunci.map((a) => `${a.bill.billNumber} (${a.bill.status})`))].join(", ");
        throw galatKoreksi(`Tanggal tiba ${receipt.receiptNumber} menentukan jatuh tempo faktur yang sudah disetujui: ${nomor}. Jadwal termin faktur disetujui terkunci dan tidak diubah diam-diam.`, 409, "TERMIN_TERKUNCI",
          "Finance: batalkan faktur itu (jurnal dibalik, klaim dilepas; batalkan pembayarannya lebih dulu bila ada), koreksi tanggal tiba, lalu catat ulang faktur.");
      }
      data.arrivedDate = baru; tanggalBerubah = true; tetapkan("tanggalTiba", hariKunci(receipt.arrivedDate), hariKunci(baru));
    }
  }
  if (p.penerima !== undefined) { const baru = teksWajib(p.penerima, "PIC/penerima barang", 2, 120); if (baru !== receipt.arrivalReceiver) { data.arrivalReceiver = baru; tetapkan("penerima", receipt.arrivalReceiver, baru); } }
  if (p.catatan !== undefined) { const baru = teksWajib(p.catatan, "Catatan kedatangan", 1, 1000); if (baru !== receipt.arrivalNote) { data.arrivalNote = baru; tetapkan("catatan", receipt.arrivalNote, baru); } }
  if (p.suratJalan !== undefined) {
    const baru = p.suratJalan === null || String(p.suratJalan).trim() === "" ? null : teksWajib(p.suratJalan, "Surat jalan", 1, 120);
    if (baru !== (receipt.deliveryNote || null)) { data.deliveryNote = baru; tetapkan("suratJalan", receipt.deliveryNote || null, baru); }
  }
  if (p.bukti !== undefined) {
    const baru = bukti(p.bukti) ?? [];
    const lama = receipt.arrivalProofUrls ?? [];
    if (JSON.stringify(baru) !== JSON.stringify(lama)) { data.arrivalProofUrls = baru; tetapkan("bukti", lama, baru); }
  }

  // ── Baris ──
  const barisUbah = []; // { baris, pl, lama{...}, baru{...}, ubahKuantitas, ubahBaik }
  if (Array.isArray(p.lines) && p.lines.length > 0) {
    const kuantitas = await kuantitasKedatangan(tx, po.id);
    const dilihat = new Set();
    for (const [i, l] of p.lines.entries()) {
      const no = i + 1;
      const pl = po.lines.find((x) => x.id === l?.purchaseOrderLineId);
      const baris = receipt.lines.find((x) => x.purchaseOrderLineId === l?.purchaseOrderLineId);
      if (!pl || !baris) throw gagal(`Baris ${no}: tidak ada pada penerimaan ini`);
      if (dilihat.has(pl.id)) throw gagal(`Baris ${no}: baris PO yang sama dikoreksi lebih dari sekali`);
      dilihat.add(pl.id);
      const kode = pl.material.code;
      const lama = { datang: baris.receivedQty, baik: baris.acceptedQty, ditolak: baris.rejectedQty, pendamping: baris.companionQty === null ? null : Number(baris.companionQty), penggantiDari: baris.replacementForLineId };
      const baru = { ...lama };
      const ubahDatang = ada(l.jumlahDatang), ubahBaik = ada(l.jumlahBaik), ubahDitolak = ada(l.jumlahDitolak), ubahPendamping = l.jumlahPendamping !== undefined, ubahPointer = l.penggantiDariBarisId !== undefined;
      if ((ubahBaik || ubahDitolak) && !STATUS_PERIKSA.includes(receipt.status)) throw gagal(`Jumlah baik/ditolak ${kode} belum ada: penerimaan masih menunggu pemeriksaan. Isi hasil pemeriksaan di Penerimaan Barang (Gudang).`, 409, "BELUM_DIPERIKSA");
      if (ubahDatang) baru.datang = angkaKoreksi(l.jumlahDatang, "datang", kode, { positif: true });
      if (ubahBaik) baru.baik = angkaKoreksi(l.jumlahBaik, "baik", kode);
      if (ubahDitolak) baru.ditolak = angkaKoreksi(l.jumlahDitolak, "ditolak", kode);
      if (ubahPointer) baru.penggantiDari = l.penggantiDariBarisId === null || l.penggantiDariBarisId === "" ? null : String(l.penggantiDariBarisId);
      const ubahKuantitas = (ubahDatang && !sama3(baru.datang, lama.datang)) || (ubahBaik && !sama3(baru.baik ?? 0, lama.baik ?? 0)) || (ubahDitolak && !sama3(baru.ditolak ?? 0, lama.ditolak ?? 0));
      const ubahBaikNyata = ubahBaik && !sama3(baru.baik ?? 0, lama.baik ?? 0);
      const pointerBerubah = ubahPointer && baru.penggantiDari !== lama.penggantiDari;

      if (ubahKuantitas) await pastikanTanpaReturAktifJikaAda(tx, { goodsReceiptLineId: baris.id }); // kontrak Retur Supplier: sebelum koreksi kuantitas
      if (ubahKuantitas || pointerBerubah) {
        if (k(baru.baik ?? 0) + k(baru.ditolak ?? 0) > k(baru.datang)) throw gagal(`${kode}: jumlah baik (${baru.baik ?? 0}) + ditolak (${baru.ditolak ?? 0}) tidak boleh melebihi jumlah datang (${baru.datang} ${pl.unit}).`, 400, "BAIK_DITOLAK_MELEBIHI_DATANG");
      }
      // Ditolak tidak boleh di bawah pengganti yang sudah tercatat menunjuk baris ini.
      if (ubahDitolak && !sama3(baru.ditolak ?? 0, lama.ditolak ?? 0)) {
        const pengganti = await tx.goodsReceiptLine.findMany({ where: { replacementForLineId: baris.id, goodsReceipt: { status: { not: "REJECTED" } } }, select: { receivedQty: true } });
        const sudahDiganti = dariK(pengganti.reduce((n, x) => n + k(x.receivedQty), 0));
        if (k(baru.ditolak) < k(sudahDiganti)) throw gagal(`${kode}: jumlah ditolak tidak boleh di bawah ${sudahDiganti} ${pl.unit} — sebanyak itu sudah dicatat sebagai pengiriman pengganti dari baris ini.`, 409, "DI_BAWAH_PENGGANTI", "Koreksi dulu pengiriman penggantinya (kurangi jumlah atau lepas kaitannya).");
      }
      // Batas jumlah datang: pengiriman asli ≤ sisa PO; pengganti ≤ sisa penolakan baris asal (jumlah lama dilepas dulu). Berlaku juga bila kaitan pengganti berubah.
      if (ubahDatang || pointerBerubah) {
        const q = kuantitas.get(pl.id);
        if (baru.penggantiDari) {
          const target = await tx.goodsReceiptLine.findUnique({ where: { id: baru.penggantiDari }, select: { id: true, purchaseOrderLineId: true, rejectedQty: true, goodsReceiptId: true, goodsReceipt: { select: { status: true, receiptNumber: true } } } });
          if (!target || target.purchaseOrderLineId !== pl.id) throw galatKoreksi(`${kode}: kaitan pengganti harus menunjuk baris penolakan dari item PO yang sama.`, 409, "KAITAN_TIDAK_VALID");
          if (target.goodsReceiptId === receipt.id) throw galatKoreksi(`${kode}: pengganti tidak boleh menunjuk penolakan pada penerimaan yang sama.`, 409, "KAITAN_TIDAK_VALID");
          if (!(Number(target.rejectedQty ?? 0) > 0) || target.goodsReceipt.status === "REJECTED") throw galatKoreksi(`${kode}: penerimaan ${target.goodsReceipt.receiptNumber} tidak punya barang ditolak yang menunggu pengganti.`, 409, "TANPA_PENOLAKAN");
          const asal = (await asalPenggantiTerbuka(tx, pl.id)).find((a) => a.lineId === target.id);
          const sisa = dariK((asal ? k(asal.sisa) : 0) + (lama.penggantiDari === target.id ? k(lama.datang) : 0));
          if (k(baru.datang) > k(sisa)) throw galatKoreksi(`Jumlah pengganti ${kode} (${baru.datang} ${pl.unit}) melebihi barang ditolak yang menunggu pengganti pada ${target.goodsReceipt.receiptNumber} (maksimal ${sisa} ${pl.unit}). Pengganti tidak menaikkan jumlah PO.`, 409, "MELEBIHI_PENOLAKAN");
        } else {
          const sisa = dariK(k(q.belumDatang) + (lama.penggantiDari ? 0 : k(lama.datang)));
          if (k(baru.datang) > k(sisa)) throw galatKoreksi(`Jumlah datang ${kode} (${baru.datang} ${pl.unit}) melebihi sisa PO ${po.poNumber} (maksimal ${sisa} ${pl.unit}).${lama.penggantiDari ? " Bila ini pengganti, pilih kaitan penolakannya." : ""}`, 409, "MELEBIHI_PO", "Minta Finance merevisi jumlah PO bila memang dikirim lebih.");
        }
      }
      // Jumlah baik sebelum Simpan ke Stok: tidak boleh melampaui sisa PO (penegakan akhir tetap di Simpan ke Stok).
      if (ubahBaikNyata && receipt.status !== "COMPLETED" && k(baru.baik ?? 0) > 0) {
        const q = (await hitungKuantitas(tx, po)).get(pl.id);
        if (k(baru.baik) > k(q.belumDiterima)) throw galatKoreksi(`Jumlah baik ${kode} (${baru.baik}) melebihi sisa PO ${po.poNumber} (${q.belumDiterima} dari ${q.dipesan} dipesan).`, 409, "MELEBIHI_PO", "Kurangi jumlah baik (kelebihan dicatat sebagai ditolak) atau minta Finance merevisi jumlah PO.");
      }
      // Pendamping (lembar): hitung ulang bila jumlah berubah / diisi eksplisit.
      let pendBaru = lama.pendamping;
      if (ubahDatang || ubahPendamping) {
        try { pendBaru = aktualPendampingPenerimaan(pl, baru.datang, ubahPendamping ? l.jumlahPendamping : (pendampingPO(pl)?.mode === "TETAP" ? undefined : baris.companionQty), { nomor: no }); }
        catch (e) { if (e instanceof PendampingError) throw gagal(e.message, 400, e.code); throw e; }
      }
      baru.pendamping = pendBaru;
      const berubahPend = (ubahDatang || ubahPendamping) && !sama3(pendBaru ?? -1, lama.pendamping === null ? -1 : lama.pendamping);
      if (ubahKuantitas || berubahPend || pointerBerubah) barisUbah.push({ baris, pl, lama, baru, ubahBaikNyata, pointerBerubah, kuantitasBerubah: ubahKuantitas });
    }
    if (barisUbah.length) {
      const nomorAsal = async (id) => (id ? (await tx.goodsReceiptLine.findUnique({ where: { id }, select: { goodsReceipt: { select: { receiptNumber: true } } } }))?.goodsReceipt.receiptNumber ?? null : null);
      const bentuk = async (v, b) => ({ purchaseOrderLineId: b.pl.id, kode: b.pl.material.code, datang: v.datang, baik: v.baik, ditolak: v.ditolak, pendamping: v.pendamping, penggantiDari: await nomorAsal(v.penggantiDari) });
      sebelum.lines = []; sesudah.lines = [];
      for (const b of barisUbah) { sebelum.lines.push(await bentuk(b.lama, b)); sesudah.lines.push(await bentuk(b.baru, b)); }
    }
  }
  if (Object.keys(data).length === 0 && barisUbah.length === 0) throw gagal("Tidak ada perubahan yang dikirim", 400, "TANPA_PERUBAHAN");

  // ── Rencana sesudah Simpan ke Stok (pemeriksaan keamanan lengkap SEBELUM menulis apa pun) ──
  const rencana = [];
  if (receipt.status === "COMPLETED") {
    for (const b of barisUbah.filter((x) => x.ubahBaikNyata)) {
      const rc = await rencanaBaikSesudahStok(tx, { galat: galatKoreksi, receipt, baris: b.baris, pl: b.pl, po, baruBaik: b.baru.baik ?? 0, sekarang });
      if (rc) rencana.push(rc);
    }
  }
  const jalur = rencana.length > 0 ? "PEMBALIK_PENGGANTI" : barisUbah.length > 0 ? "LANGSUNG" : "DATA";
  const revisiBaru = receipt.arrivalRevision + 1;

  // ── Tulis ──
  for (const b of barisUbah) {
    // HANYA kolom yang benar-benar berubah ditulis: trigger pengaman Retur (UPDATE OF received_qty/accepted_qty/…) aktif untuk kolom yang tercantum di SET walau nilainya sama,
    // sehingga koreksi lembar/kaitan pengganti pada baris yang punya retur tidak boleh ikut menyentuh kolom jumlah.
    const beda = {};
    if (!sama3(b.baru.datang ?? -1, b.lama.datang ?? -1)) beda.receivedQty = b.baru.datang;
    if (!sama3(b.baru.baik ?? -1, b.lama.baik ?? -1)) beda.acceptedQty = b.baru.baik;
    if (!sama3(b.baru.ditolak ?? -1, b.lama.ditolak ?? -1)) beda.rejectedQty = b.baru.ditolak;
    if (!sama3(b.baru.pendamping ?? -1, b.lama.pendamping ?? -1)) beda.companionQty = b.baru.pendamping;
    if ((b.baru.penggantiDari ?? null) !== (b.lama.penggantiDari ?? null)) beda.replacementForLineId = b.baru.penggantiDari ?? null;
    if (Object.keys(beda).length) await tx.goodsReceiptLine.update({ where: { id: b.baris.id }, data: beda });
  }
  let stok = { pergerakan: [], jurnal: null, selisihNilai: null };
  if (rencana.length > 0) stok = await terapkanBaikSesudahStok(tx, { galat: galatKoreksi, receipt, rencana, aktor, revisiBaru, alasan: r, sekarang });
  await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { ...data, arrivalRevision: { increment: 1 } } });
  sesudah.jalur = jalur;
  if (stok.pergerakan.length) sesudah.pergerakanStok = stok.pergerakan;
  if (stok.jurnal) sesudah.jurnalKoreksi = stok.jurnal.nomor;
  await tx.goodsReceiptEvent.create({ data: { goodsReceiptId: receipt.id, type: "KEDATANGAN_DIKOREKSI", actorId: aktor.userId, actorRoles: aktor.roles, workspace: aktor.workspace, reason: r, before: sebelum, after: sesudah } });
  await catatPO(tx, po.id, "KEDATANGAN_DIKOREKSI", aktor, { note: r, metadata: { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, workspace: aktor.workspace, sebelum, sesudah } });
  if (tanggalBerubah) await sinkronJatuhTempoFakturPO(tx, po.id);
  const statusPoSebelum = po.status;
  const statusPoSesudah = barisUbah.some((b) => b.ubahBaikNyata) ? await hitungUlangStatus(tx, po.id, aktor.userId) : statusPoSebelum;

  // ── Dampak (dari kondisi SESUDAH tulis, di transaksi yang sama) ──
  const progresSesudah = await hitungProgresPO(tx, po.id);
  const terminSesudah = await termin();
  const dampak = {
    progres: po.lines.map((l) => {
      const a = progresSebelum.get(l.id), b = progresSesudah.get(l.id);
      const beda = KUNCI_PROGRES_DAMPAK.filter((x) => k(a?.[x]) !== k(b?.[x]));
      return beda.length ? { purchaseOrderLineId: l.id, kode: l.material.code, satuan: l.unit, berubah: beda, sebelum: Object.fromEntries(KUNCI_PROGRES_DAMPAK.map((x) => [x, a?.[x] ?? 0])), sesudah: Object.fromEntries(KUNCI_PROGRES_DAMPAK.map((x) => [x, b?.[x] ?? 0])) } : null;
    }).filter(Boolean),
    termin: terminSesudah.map((t) => ({ ...t, jatuhTempoSebelum: terminSebelum.find((x) => x.fakturId === t.fakturId)?.jatuhTempo ?? null, berubah: (terminSebelum.find((x) => x.fakturId === t.fakturId)?.jatuhTempo ?? null) !== t.jatuhTempo })),
    stok: rencana.map((x) => ({ kode: x.kode, satuan: x.satuan, baikSebelum: x.lama, baikSesudah: x.baru, selisihQtyStok: x.qtyStok.selisih.toNumber() })),
    fakturTertunda: [...new Set(rencana.flatMap((x) => x.fakturTertunda))],
    statusPO: { sebelum: statusPoSebelum, sesudah: statusPoSesudah },
    ...(finance ? { jurnal: stok.jurnal ? { nomor: stok.jurnal.nomor, arah: stok.jurnal.arah, nilai: Number(stok.jurnal.nilai) } : null, nilaiSelisih: stok.selisihNilai ? Number(stok.selisihNilai.toFixed(2)) : 0 } : {}),
  };
  return { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, revisi: revisiBaru, jalur, perubahan: { sebelum, sesudah }, dampak };
}

/**
 * Jalankan koreksi (atau PRATINJAU-nya) dari route. Pratinjau = koreksi yang SAMA dijalankan penuh di transaksi lalu dibatalkan: angka progres, jadwal termin, stok, dan jurnal
 * persis yang akan terjadi. Galat yang sah (blokir) pada pratinjau dikembalikan sebagai { boleh:false, blokir:[{kode,pesan,arah}] } (HTTP 200); pada penerapan tetap galat HTTP.
 */
export async function jalankanKoreksiKedatangan(db, { receiptId, perubahan, alasan, revisiDiharapkan, aktor, finance = false, pratinjau = false, sekarang = new Date() }) {
  const args = { receiptId, perubahan, alasan, revisiDiharapkan, aktor, finance, sekarang };
  const opsi = { timeout: 30_000, maxWait: 10_000 };
  if (!pratinjau) return db.$transaction((tx) => koreksiKedatangan(tx, args), opsi);
  try {
    await db.$transaction(async (tx) => { throw new PratinjauSelesai(await koreksiKedatangan(tx, { ...args, pratinjau: true })); }, opsi);
  } catch (e) {
    if (e instanceof PratinjauSelesai) return { ...e.hasil, pratinjau: true, boleh: true };
    if (typeof e?.statusCode === "number" && e.statusCode < 500) return { pratinjau: true, boleh: false, status: e.statusCode, blokir: [{ kode: e.code ?? "DITOLAK", pesan: e.message, arah: e.arah ?? null }] };
    throw e;
  }
  throw new Error("pratinjau tidak selesai");
}
