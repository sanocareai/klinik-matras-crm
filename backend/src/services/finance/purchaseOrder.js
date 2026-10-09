// PURCHASE ORDER BAHAN BAKU — Fase 1 integrasi Finance → Gudang (Okt 2026).
//
// PRINSIP YANG TIDAK BOLEH DILANGGAR DI FILE INI:
//   1. PO adalah dokumen KOMITMEN. Membuat / mengubah / menyetujui / membatalkan / merevisi PO TIDAK menulis stock_movements dan TIDAK
//      membuat jurnal. Jangan import postStockMovement / postJournal ke sini. Stok masuk dan jurnal Dr Persediaan / Cr Utang Barang
//      Belum Ditagih tetap HANYA lahir saat putaway penerimaan (routes/goodsReceipt.js) — PO cuma memberi harga satuan dan batas jumlah.
//   2. PO TIDAK menyimpan saldo. Diterima baik / ditolak / belum diterima / ditagih selalu dihitung dari baris penerimaan berstatus
//      COMPLETED yang menunjuk baris PO (sumber tunggal, tidak ada dua angka yang bisa berbeda).
//   3. Batas jumlah diterima baik DITEGAKKAN di titik putaway di bawah kunci baris PO (dua putaway paralel diserialkan), bukan hanya
//      di layar. Melebihi PO butuh penanganan eksplisit: Finance merevisi jumlah PO (tercatat sebelum/sesudah + alasan).
import { generateDocumentNumber, toBookDate } from "./journal.js";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { tentukanTerminPO, TerminError, labelTermin } from "./termin.js";
import { Decimal } from "./money.js";
import { validasiPendamping, pendampingPO, PendampingError } from "../../lib/domain/pendamping.js";
import { buatSkuBaru, pastikanKatalog, catatHargaTerakhir, tautkanPoPertama, validasiFaktor, periksaKonversiBaris, SATUAN_VALID, SkuError } from "./skuBaru.js";

export class PurchaseOrderError extends Error {
  constructor(message, statusCode = 400, code = null) { super(message); this.statusCode = statusCode; if (code) this.code = code; }
}
const gagal = (m, s = 400, c = null) => new PurchaseOrderError(m, s, c);

export const STATUS_PO = ["DRAFT", "DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI", "DIBATALKAN"];
// Status PO yang boleh menerima barang (membuat penerimaan baru & putaway).
export const STATUS_PO_BISA_DITERIMA = ["DISETUJUI", "DITERIMA_SEBAGIAN"];
// Penerimaan yang masih berjalan (belum menulis stok, belum ditolak).
const STATUS_PENERIMAAN_BERJALAN = ["DRAFT", "SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"];
// Tagihan yang sudah menjadi utang di buku (DRAFT/MENUNGGU/DITOLAK/DIBATALKAN tidak dihitung "sudah ditagih").
const STATUS_TAGIHAN_AKTIF = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];

// Kuantitas dihitung dalam seperseribu (bilangan bulat) supaya perbandingan Float penerimaan vs Decimal PO tidak bocor ke 0.1+0.2.
const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;
const rp = (n) => Math.round(n * 100) / 100;

// ── Masukan ──────────────────────────────────────────────────────────────

/**
 * Validasi + normalisasi isi PO (dipakai buat & ubah draf & persetujuan). Mengembalikan data siap simpan.
 * Baris boleh berupa material yang ADA (materialId) atau BARANG BARU (materialBaru) — barang baru dibuat di sini, di dalam transaksi pemanggil, hanya oleh
 * finance:admin (bolehBuatSku) dan hanya bila buatSku (tidak saat revalidasi persetujuan). Gagal di mana pun ⇒ transaksi dibatalkan: tidak ada SKU/katalog/PO setengah jadi.
 * Konversi satuan: baris memakai satuan beli (unit) + faktor ke satuan stok material; tanpa konversi purchaseUnit/conversionFactor NULL (perilaku lama).
 */
async function siapkanMasukan(tx, body, { bolehBuatSku = false, buatSku = false, userId = null } = {}) {
  const b = body ?? {};
  if (!b.supplierId) throw gagal("Supplier wajib dipilih");
  const supplier = await tx.finSupplier.findUnique({ where: { id: b.supplierId }, select: { id: true, name: true, active: true, paymentTermDays: true, paymentTermType: true } });
  if (!supplier) throw gagal("Supplier tidak ditemukan", 404);
  if (!supplier.active) throw gagal(`Supplier ${supplier.name} nonaktif — aktifkan dulu atau pilih supplier lain`, 409);

  if (!b.orderDate) throw gagal("Tanggal PO wajib diisi");
  const orderDate = toBookDate(b.orderDate);
  const expectedDate = b.expectedDate ? toBookDate(b.expectedDate) : null;
  if (expectedDate && expectedDate < orderDate) throw gagal("Estimasi kedatangan tidak boleh sebelum tanggal PO");

  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) throw gagal("Minimal satu item wajib diisi");
  if (lines.length > 100) throw gagal("Satu PO maksimal 100 baris");

  const dipakai = new Set();
  const hasil = [];
  const skuBaru = [];
  for (const [i, l] of lines.entries()) {
    const no = i + 1;
    let material; let katalogMasukan = null; let satuanBeli; let faktor;
    if (!l?.materialId && l?.materialBaru) {
      if (!buatSku) throw gagal(`Baris ${no}: barang baru hanya bisa dibuat saat menyimpan draf PO`, 400);
      if (!bolehBuatSku) throw gagal(`Baris ${no}: membuat barang baru dari PO membutuhkan izin Admin Finance. Pilih material yang sudah ada, atau minta Admin Finance.`, 403, "BUAT_SKU_BUTUH_ADMIN");
      let dibuat;
      try { dibuat = await buatSkuBaru(tx, { data: l.materialBaru, supplier, userId }); }
      catch (e) { if (e instanceof SkuError) e.message = `Baris ${no}: ${e.message}`; throw e; }
      material = { id: dibuat.material.id, code: dibuat.material.code, name: dibuat.material.name, unit: dibuat.material.unit, active: true };
      katalogMasukan = dibuat.masukan; satuanBeli = dibuat.masukan.satuanBeli; faktor = dibuat.masukan.faktor;
      skuBaru.push({ materialId: material.id, kode: material.code, nama: material.name, jenis: dibuat.masukan.jenis, baris: no });
    } else {
      if (!l?.materialId) throw gagal(`Baris ${no}: item katalog wajib dipilih`);
      material = await tx.material.findUnique({ where: { id: l.materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
      if (!material) throw gagal(`Baris ${no}: item katalog tidak ditemukan`, 404);
      if (!material.active) throw gagal(`Baris ${no}: ${material.code} nonaktif di katalog`, 409);
      // Satuan beli eksplisit (mis. BOX untuk material berstok CAN) + faktor wajib bila berbeda dari satuan stok; tanpa input = tanpa konversi.
      satuanBeli = l.satuanBeli ? String(l.satuanBeli) : String(material.unit);
      if (!SATUAN_VALID.includes(satuanBeli)) throw gagal(`Baris ${no} (${material.code}): satuan pembelian tidak valid`);
      try { faktor = validasiFaktor(satuanBeli, String(material.unit), l.faktorKonversi); }
      catch (e) { if (e instanceof SkuError) throw gagal(`Baris ${no} (${material.code}): ${e.message}`, 400, e.code); throw e; }
      const adaInfoKatalog = l.namaSupplier || l.kodeSupplier || l.moq || l.estimasiKirimHari;
      if (adaInfoKatalog || satuanBeli !== String(material.unit)) {
        katalogMasukan = { namaSupplier: l.namaSupplier?.trim() || null, kodeSupplier: l.kodeSupplier?.trim() || null, satuanBeli, faktor, moq: l.moq ? new Decimal(String(l.moq)) : null, leadTimeDays: l.estimasiKirimHari !== undefined && l.estimasiKirimHari !== null && l.estimasiKirimHari !== "" ? Number(l.estimasiKirimHari) : null };
      }
    }
    if (dipakai.has(material.id)) throw gagal(`Baris ${no}: item yang sama sudah ada di PO ini — gabungkan jumlahnya jadi satu baris`);
    dipakai.add(material.id);

    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw gagal(`Baris ${no} (${material.code}): jumlah harus lebih dari 0`);
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) throw gagal(`Baris ${no} (${material.code}): jumlah maksimal 3 angka di belakang koma`);
    if (qty > 99_999_999) throw gagal(`Baris ${no} (${material.code}): jumlah terlalu besar`);

    const harga = Number(l.unitPrice);
    if (!Number.isInteger(harga) || harga <= 0) throw gagal(`Baris ${no} (${material.code}): harga satuan harus rupiah bulat lebih dari 0`);
    if (harga > 2_000_000_000) throw gagal(`Baris ${no} (${material.code}): harga satuan terlalu besar`);

    const konversi = satuanBeli !== String(material.unit);
    if (konversi) {
      try { periksaKonversiBaris({ qty: dariK(k(qty)), faktor, hargaBeli: harga }); }
      catch (e) { if (e instanceof SkuError) throw gagal(`Baris ${no} (${material.code}): ${e.message}`, 400, e.code); throw e; }
    }
    // Jumlah fisik pendamping (informasi kontrol; tidak memengaruhi nilai/stok/jurnal). Tidak bisa digabung konversi satuan.
    let pendamping;
    try { pendamping = validasiPendamping(l.pendamping, { nomor: no, kode: material.code, adaKonversi: konversi }); }
    catch (e) { if (e instanceof PendampingError) throw gagal(e.message, 400, e.code); throw e; }
    // Relasi Katalog Supplier (supplier ↔ SKU internal): dibuat/diperbarui di transaksi yang sama; baris PO menyimpan SNAPSHOT-nya.
    let katalog = await tx.finSupplierMaterial.findUnique({ where: { supplierId_materialId: { supplierId: supplier.id, materialId: material.id } } });
    if (katalogMasukan) katalog = await pastikanKatalog(tx, { supplierId: supplier.id, materialId: material.id, data: katalogMasukan, userId });
    hasil.push({
      materialId: material.id, unit: satuanBeli, qty: dariK(k(qty)), unitPrice: harga, notes: l.notes?.trim() || null, sortOrder: i,
      ...pendamping,
      ...(konversi && { purchaseUnit: satuanBeli, conversionFactor: faktor.toString() }),
      ...(katalog && { supplierMaterialId: katalog.id, supplierItemName: katalog.supplierItemName, supplierSku: katalog.supplierSku }),
    });
  }
  return { supplier, orderDate, expectedDate, notes: b.notes?.trim() || null, lines: hasil, skuBaru };
}

// Riwayat PO = tabel event sendiri (aktor + waktu + sebelum/sesudah). Tidak memakai activity_logs: teks tampilannya per jenis kejadian
// dirancang untuk dokumen lain dan akan merangkai kalimat yang salah untuk PO.
async function catat(tx, po, type, userId, { note = null, metadata = null } = {}) {
  await tx.finPurchaseOrderEvent.create({ data: { purchaseOrderId: po.id, type, actorId: userId, note, metadata } });
}

async function kunciDanMuat(tx, id) {
  await lockRowForUpdate(tx, "fin_purchase_orders", id);
  const po = await tx.finPurchaseOrder.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!po) throw gagal("PO tidak ditemukan", 404);
  return po;
}

// ── Perintah ─────────────────────────────────────────────────────────────

/** Snapshot termin PO: warisi master supplier, atau ganti (finance:admin + alasan). Galat termin → gagal() supaya route memetakannya ke 4xx. */
function terminPO(supplier, body, { userId, bolehOverride }) {
  try {
    return tentukanTerminPO({ supplier, masukan: { terminJenis: body?.terminJenis, terminHari: body?.terminHari, alasan: body?.alasanTermin }, boleh: { override: !!bolehOverride }, userId });
  } catch (e) { if (e instanceof TerminError) throw gagal(e.message, e.statusCode, e.code); throw e; }
}

export async function buatPO(tx, { body, userId, bolehOverride = false, bolehBuatSku = false }) {
  const m = await siapkanMasukan(tx, body, { bolehBuatSku, buatSku: true, userId });
  const termin = terminPO(m.supplier, body, { userId, bolehOverride });
  const poNumber = await generateDocumentNumber(tx, "PO", m.orderDate);
  const po = await tx.finPurchaseOrder.create({
    data: {
      poNumber, supplierId: m.supplier.id, orderDate: m.orderDate, expectedDate: m.expectedDate, notes: m.notes,
      status: "DRAFT", createdById: userId, ...termin,
      lines: { create: m.lines },
    },
  });
  for (const s of m.skuBaru) await tautkanPoPertama(tx, { materialId: s.materialId, purchaseOrderId: po.id });
  await catat(tx, po, "DIBUAT", userId, { metadata: { supplier: m.supplier.name, jumlahBaris: m.lines.length, ...(m.skuBaru.length && { skuBaru: m.skuBaru }) } });
  return po.id;
}

export async function ubahDraf(tx, { id, body, userId, bolehOverride = false, bolehBuatSku = false }) {
  const po = await kunciDanMuat(tx, id);
  if (po.status !== "DRAFT") throw gagal(`PO berstatus ${po.status} tidak bisa diubah — hanya draf yang bisa diedit (batalkan dan buat PO baru bila perlu)`, 409);
  // Baris yang SUDAH berisi SKU buatan draf ini dikirim ulang frontend dengan materialId (bukan materialBaru) → tidak dibuat dua kali.
  const m = await siapkanMasukan(tx, body, { bolehBuatSku, buatSku: true, userId });
  await tx.finPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id } });
  // Termin: ikut master supplier baru bila supplier diganti atau termin diketik ulang; selain itu snapshot lama dipertahankan.
  const ulangTermin = m.supplier.id !== po.supplierId || (body?.terminJenis !== undefined && body?.terminJenis !== null && body?.terminJenis !== "");
  const termin = ulangTermin ? terminPO(m.supplier, body, { userId, bolehOverride }) : {};
  await tx.finPurchaseOrder.update({
    where: { id: po.id },
    data: { supplierId: m.supplier.id, orderDate: m.orderDate, expectedDate: m.expectedDate, notes: m.notes, ...termin, lines: { create: m.lines } },
  });
  for (const s of m.skuBaru) await tautkanPoPertama(tx, { materialId: s.materialId, purchaseOrderId: po.id });
  await catat(tx, po, "DIUBAH", userId, { metadata: { supplier: m.supplier.name, jumlahBaris: m.lines.length, ...(m.skuBaru.length && { skuBaru: m.skuBaru }) } });
  return po.id;
}

export async function setujuiPO(tx, { id, userId }) {
  const po = await kunciDanMuat(tx, id);
  if (po.status !== "DRAFT") throw gagal(`PO ini sudah berstatus ${po.status}`, 409);
  // Validasi ulang isi saat disetujui: supplier/katalog bisa berubah sejak draf dibuat.
  await siapkanMasukan(tx, {
    supplierId: po.supplierId, orderDate: po.orderDate, expectedDate: po.expectedDate,
    lines: po.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty), unitPrice: l.unitPrice, ...(l.purchaseUnit && { satuanBeli: l.purchaseUnit, faktorKonversi: l.conversionFactor.toString() }) })),
  }, { userId });
  await tx.finPurchaseOrder.update({ where: { id: po.id }, data: { status: "DISETUJUI", approvedAt: new Date(), approvedById: userId } });
  // Harga terakhir Katalog Supplier = informasi saja (tidak menyentuh PO lama, stok, atau biaya). Dicatat saat PO menjadi komitmen.
  await catatHargaTerakhir(tx, { purchaseOrderId: po.id, tanggal: po.orderDate, userId });
  await catat(tx, po, "DISETUJUI", userId);
  return po.id;
}

export async function batalkanPO(tx, { id, reason, userId, bolehBatalkanDisetujui }) {
  const alasan = reason?.trim();
  if (!alasan) throw gagal("Alasan pembatalan wajib diisi");
  const po = await kunciDanMuat(tx, id);
  if (po.status === "DIBATALKAN") throw gagal("PO ini sudah dibatalkan", 409);
  if (po.status === "SELESAI" || po.status === "DITERIMA_SEBAGIAN") {
    throw gagal(`PO berstatus ${po.status} sudah punya barang yang masuk stok — tidak bisa dibatalkan. Revisi jumlah PO bila sisanya tidak akan dikirim.`, 409);
  }
  if (po.status === "DISETUJUI") {
    if (!bolehBatalkanDisetujui) throw gagal("Membatalkan PO yang sudah disetujui membutuhkan izin Admin Finance", 403);
    const berjalan = await tx.goodsReceipt.findMany({
      where: { purchaseOrderId: po.id, status: { in: STATUS_PENERIMAAN_BERJALAN } }, select: { receiptNumber: true },
    });
    if (berjalan.length > 0) {
      throw gagal(`Masih ada penerimaan berjalan untuk PO ini (${berjalan.map((r) => r.receiptNumber).join(", ")}). Minta Gudang menolak/menyelesaikannya dulu.`, 409);
    }
  }
  await tx.finPurchaseOrder.update({ where: { id: po.id }, data: { status: "DIBATALKAN", cancelledAt: new Date(), cancelReason: alasan } });
  await catat(tx, po, "DIBATALKAN", userId, { note: alasan, metadata: { statusSebelumnya: po.status } });
  return po.id;
}

/**
 * Penanganan selisih jumlah yang EKSPLISIT: menaikkan jumlah PO (supaya penerimaan lebih bisa diterima) atau menurunkannya (sisa
 * tidak akan dikirim → PO bisa SELESAI). Tidak boleh di bawah jumlah yang sudah diterima baik. Harga satuan TIDAK bisa diubah.
 */
export async function revisiJumlah(tx, { id, lineId, qty, reason, userId }) {
  const alasan = reason?.trim();
  if (!alasan) throw gagal("Alasan revisi jumlah wajib diisi");
  const po = await kunciDanMuat(tx, id);
  if (!STATUS_PO_BISA_DITERIMA.includes(po.status)) throw gagal(`PO berstatus ${po.status} tidak bisa direvisi jumlahnya`, 409);
  const line = po.lines.find((l) => l.id === lineId);
  if (!line) throw gagal("Baris PO tidak ditemukan", 404);
  const baru = Number(qty);
  if (!Number.isFinite(baru) || baru <= 0) throw gagal("Jumlah baru harus lebih dari 0");
  if (Math.abs(baru * 1000 - Math.round(baru * 1000)) > 1e-6) throw gagal("Jumlah maksimal 3 angka di belakang koma");

  const kuantitas = await hitungKuantitas(tx, po);
  const q = kuantitas.get(line.id);
  if (k(baru) < k(q.diterimaBaik)) {
    throw gagal(`Jumlah baru (${baru}) tidak boleh di bawah jumlah yang sudah diterima baik (${q.diterimaBaik})`, 409);
  }
  if (k(baru) === k(line.qty)) throw gagal("Jumlah baru sama dengan jumlah sekarang", 409);

  const sebelum = Number(line.qty);
  await tx.finPurchaseOrderLine.update({ where: { id: line.id }, data: { qty: dariK(k(baru)) } });
  await catat(tx, po, "REVISI_JUMLAH", userId, {
    note: alasan,
    metadata: { lineId: line.id, materialId: line.materialId, sebelum, sesudah: dariK(k(baru)), selisihNilai: rp((dariK(k(baru)) - sebelum) * line.unitPrice) },
  });
  await hitungUlangStatus(tx, po.id, userId);
  return po.id;
}

// ── Perhitungan kuantitas (sumber tunggal) ───────────────────────────────

/**
 * Per baris PO: dipesan, diterimaBaik, ditolak (hanya penerimaan COMPLETED = stok sudah tertulis), belumDiterima,
 * dalamProses (barang tercatat datang di penerimaan yang belum ditempatkan), ditagih (diterima baik pada penerimaan yang sudah
 * punya tagihan aktif — tagihan menempel ke PENERIMAAN, bukan ke baris, jadi inilah ketelitian terbaik yang tersedia).
 */
export async function hitungKuantitas(tx, po) {
  const baris = await tx.goodsReceiptLine.findMany({
    where: { purchaseOrderLine: { purchaseOrderId: po.id } },
    select: {
      purchaseOrderLineId: true, receivedQty: true, acceptedQty: true, rejectedQty: true,
      billAllocations: { where: { bill: { status: { in: STATUS_TAGIHAN_AKTIF } } }, select: { qty: true } },
      goodsReceipt: { select: { id: true, status: true, finSupplierBills: { select: { status: true } } } },
    },
  });
  const peta = new Map();
  for (const l of po.lines) {
    peta.set(l.id, { dipesanK: k(l.qty), diterimaBaikK: 0, ditolakK: 0, dalamProsesK: 0, ditagihK: 0 });
  }
  for (const b of baris) {
    const a = peta.get(b.purchaseOrderLineId);
    if (!a) continue;
    const st = b.goodsReceipt.status;
    if (st === "COMPLETED") {
      a.diterimaBaikK += k(b.acceptedQty);
      a.ditolakK += k(b.rejectedQty);
      // Faktur atas PO (Fase 2) mengklaim per baris penerimaan lewat alokasi; tagihan lama menutup seluruh penerimaan (tidak boleh terhitung ganda).
      const lama = b.goodsReceipt.finSupplierBills.some((t) => STATUS_TAGIHAN_AKTIF.includes(t.status));
      a.ditagihK += lama ? k(b.acceptedQty) : Math.min(k(b.acceptedQty), b.billAllocations.reduce((s, x) => s + k(x.qty), 0));
    } else if (STATUS_PENERIMAAN_BERJALAN.includes(st)) {
      a.dalamProsesK += k(b.receivedQty);
    }
  }
  const hasil = new Map();
  for (const [id, a] of peta) {
    hasil.set(id, {
      dipesan: dariK(a.dipesanK), diterimaBaik: dariK(a.diterimaBaikK), ditolak: dariK(a.ditolakK),
      belumDiterima: dariK(Math.max(0, a.dipesanK - a.diterimaBaikK)),
      dalamProses: dariK(a.dalamProsesK), ditagih: dariK(a.ditagihK),
    });
  }
  return hasil;
}

/** Status PO turunan dari kuantitas. Hanya menggeser PO yang aktif (bukan DRAFT/DIBATALKAN). Mencatat riwayat bila berubah. */
export async function hitungUlangStatus(tx, poId, userId) {
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: poId }, include: { lines: true } });
  if (!po || !["DISETUJUI", "DITERIMA_SEBAGIAN", "SELESAI"].includes(po.status)) return po?.status ?? null;
  const kuantitas = await hitungKuantitas(tx, po);
  const semuaTerpenuhi = po.lines.every((l) => k(kuantitas.get(l.id).diterimaBaik) >= k(l.qty));
  const adaDiterima = po.lines.some((l) => k(kuantitas.get(l.id).diterimaBaik) > 0);
  const baru = semuaTerpenuhi ? "SELESAI" : adaDiterima ? "DITERIMA_SEBAGIAN" : "DISETUJUI";
  if (baru !== po.status) {
    await tx.finPurchaseOrder.update({ where: { id: po.id }, data: { status: baru } });
    await catat(tx, po, "STATUS_BERUBAH", userId, { metadata: { dari: po.status, ke: baru } });
  }
  return baru;
}

// ── Penerimaan Gudang ────────────────────────────────────────────────────

/** Baris penerimaan baru dari PO. `pilihan` = [{ purchaseOrderLineId, orderedQty? }] atau kosong = semua baris yang masih punya sisa. */
export async function siapkanPenerimaanDariPO(tx, { purchaseOrderId, pilihan }) {
  const po = await tx.finPurchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { supplier: { select: { name: true } }, lines: { orderBy: { sortOrder: "asc" } } },
  });
  if (!po) throw gagal("PO tidak ditemukan", 404);
  if (!STATUS_PO_BISA_DITERIMA.includes(po.status)) {
    throw gagal(`PO ${po.poNumber} berstatus ${po.status} — hanya PO yang disetujui dan belum selesai yang bisa dibuatkan penerimaan`, 409);
  }
  const kuantitas = await hitungKuantitas(tx, po);
  const peminta = Array.isArray(pilihan) && pilihan.length > 0 ? pilihan : null;
  const dipilih = peminta
    ? peminta.map((p) => {
        const l = po.lines.find((x) => x.id === p.purchaseOrderLineId);
        if (!l) throw gagal("Ada baris yang bukan bagian dari PO ini");
        return { l, diminta: p.orderedQty };
      })
    : po.lines.filter((l) => kuantitas.get(l.id).belumDiterima > 0).map((l) => ({ l, diminta: undefined }));
  if (dipilih.length === 0) throw gagal(`PO ${po.poNumber} sudah terpenuhi — tidak ada sisa yang bisa diterima`, 409);
  if (new Set(dipilih.map((d) => d.l.id)).size !== dipilih.length) throw gagal("Baris PO yang sama dipilih lebih dari sekali");

  const lines = dipilih.map(({ l, diminta }) => {
    const sisa = kuantitas.get(l.id).belumDiterima;
    if (sisa <= 0) throw gagal(`Salah satu baris sudah terpenuhi penuh di PO ${po.poNumber}`, 409);
    let qty = sisa;
    if (diminta !== undefined && diminta !== null && diminta !== "") {
      qty = Number(diminta);
      if (!Number.isFinite(qty) || qty <= 0) throw gagal("Jumlah dijadwalkan harus lebih dari 0");
      if (k(qty) > k(sisa)) throw gagal(`Jumlah dijadwalkan (${qty}) melebihi sisa PO (${sisa})`, 409);
    }
    return { materialId: l.materialId, orderedQty: qty, purchaseOrderLineId: l.id };
  });
  return { po, supplierName: po.supplier.name, lines };
}

/**
 * Validasi isian baris penerimaan yang tertaut PO (dipanggil dari PATCH baris). `nilai` = nilai gabungan baris setelah perubahan.
 * Pemeriksaan DINI untuk pesan yang jelas; penegakan akhir ada di periksaPutaway (di bawah kunci PO).
 */
export async function validasiBarisPenerimaanPO(tx, { receiptLine, nilai }) {
  const { receivedQty, acceptedQty, rejectedQty } = nilai;
  for (const [nama, v] of [["datang", receivedQty], ["baik", acceptedQty], ["ditolak", rejectedQty]]) {
    if (v != null && Number.isFinite(Number(v)) && Math.abs(Number(v) * 1000 - Math.round(Number(v) * 1000)) > 1e-6) throw gagal(`Jumlah ${nama} penerimaan dari PO maksimal 3 angka di belakang koma`);
  }
  for (const [nama, v] of [["Diterima", receivedQty], ["Baik", acceptedQty], ["Ditolak", rejectedQty]]) {
    if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw gagal(`Jumlah ${nama.toLowerCase()} tidak boleh negatif`);
  }
  if (receivedQty != null && k(acceptedQty ?? 0) + k(rejectedQty ?? 0) > k(receivedQty)) {
    throw gagal(`Jumlah baik (${acceptedQty ?? 0}) + ditolak (${rejectedQty ?? 0}) tidak boleh melebihi jumlah yang datang (${receivedQty})`);
  }
  if (acceptedQty != null && Number(acceptedQty) > 0) {
    const baris = await tx.finPurchaseOrderLine.findUnique({ where: { id: receiptLine.purchaseOrderLineId }, include: { purchaseOrder: true } });
    if (baris.purchaseUnit && baris.conversionFactor != null) {
      try { periksaKonversiBaris({ qty: acceptedQty, faktor: baris.conversionFactor, hargaBeli: baris.unitPrice }); }
      catch (e) { if (e instanceof SkuError) throw gagal(e.message, 400, e.code); throw e; }
    }
    const po = await tx.finPurchaseOrder.findUnique({ where: { id: baris.purchaseOrderId }, include: { lines: true } });
    const q = (await hitungKuantitas(tx, po)).get(baris.id);
    if (k(acceptedQty) > k(q.belumDiterima)) {
      throw gagal(
        `Jumlah baik (${acceptedQty}) melebihi sisa PO ${baris.purchaseOrder.poNumber} (${q.belumDiterima} dari ${q.dipesan} dipesan). ` +
        "Kurangi jumlah baik (kelebihan dicatat sebagai ditolak) atau minta Finance merevisi jumlah PO.", 409);
    }
  }
}

/**
 * Pemeriksaan WAJIB di dalam transaksi putaway (receipt sudah terkunci): mengunci PO, memastikan PO masih bisa menerima, dan
 * memastikan jumlah baik kumulatif tidak melebihi jumlah PO. Mengembalikan peta purchaseOrderLineId → harga satuan untuk menilai stok.
 */
export async function periksaPutaway(tx, receipt) {
  if (!receipt.purchaseOrderId) return null;
  await lockRowForUpdate(tx, "fin_purchase_orders", receipt.purchaseOrderId);
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId }, include: { lines: true } });
  if (!STATUS_PO_BISA_DITERIMA.includes(po.status)) {
    throw gagal(`PO ${po.poNumber} berstatus ${po.status} — penerimaan ini tidak bisa disimpan ke stok. Hubungi Finance.`, 409);
  }
  const kuantitas = await hitungKuantitas(tx, po);
  const harga = new Map();
  // Baris berkonversi satuan: poLineId → { faktor, qtyStok (Decimal), hargaStokEksak (Decimal 8dp), hargaStokBulat }. Kosong untuk baris tanpa konversi.
  const konversi = new Map();
  for (const l of receipt.lines) {
    if (!l.purchaseOrderLineId || !(Number(l.acceptedQty) > 0)) continue;
    const baris = po.lines.find((x) => x.id === l.purchaseOrderLineId);
    if (!baris) throw gagal("Baris penerimaan menunjuk baris PO yang tidak dikenal", 409);
    const q = kuantitas.get(baris.id);
    if (k(l.acceptedQty) > k(q.belumDiterima)) {
      throw gagal(
        `Jumlah baik ${l.material?.code ?? ""} (${l.acceptedQty}) melebihi sisa PO ${po.poNumber} (${q.belumDiterima} dari ${q.dipesan} dipesan; ` +
        `${q.diterimaBaik} sudah masuk stok). Simpan ke Stok dibatalkan, tidak ada stok yang tertulis. Kurangi jumlah baik atau minta Finance merevisi jumlah PO.`, 409);
    }
    harga.set(l.purchaseOrderLineId, baris.unitPrice);
    if (baris.purchaseUnit && baris.conversionFactor != null) {
      const f = new Decimal(String(baris.conversionFactor));
      let qtyStok;
      try { qtyStok = periksaKonversiBaris({ qty: l.acceptedQty, faktor: f, hargaBeli: baris.unitPrice }); }
      catch (e) { if (e instanceof SkuError) throw gagal(`${l.material?.code ?? ""}: ${e.message} Simpan ke Stok dibatalkan, tidak ada stok yang tertulis.`, 409, e.code); throw e; }
      const eksak = new Decimal(baris.unitPrice).dividedBy(f).toDecimalPlaces(8);
      konversi.set(l.purchaseOrderLineId, { faktor: f, qtyStok, hargaStokEksak: eksak, hargaStokBulat: Math.max(1, eksak.toDecimalPlaces(0).toNumber()), satuanBeli: baris.purchaseUnit });
    }
  }
  return { po, harga, konversi };
}

/** Setelah stok tertulis: hitung ulang status PO dan catat riwayat. */
export async function selesaiPutaway(tx, { receipt, ditempatkan, userId }) {
  if (!receipt.purchaseOrderId) return;
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: receipt.purchaseOrderId } });
  await catat(tx, po, "PENERIMAAN_DITEMPATKAN", userId, {
    note: receipt.receiptNumber,
    metadata: { receiptId: receipt.id, receiptNumber: receipt.receiptNumber, baris: ditempatkan },
  });
  await hitungUlangStatus(tx, po.id, userId);
}

// ── Bentuk keluaran ──────────────────────────────────────────────────────

function bentukBaris(l, q, { harga }) {
  const nilaiK = (qtyK) => rp((qtyK / 1000) * l.unitPrice);
  return {
    id: l.id,
    materialId: l.materialId,
    kode: l.material?.code ?? null,
    nama: l.material?.name ?? null,
    satuan: l.unit,
    // Konversi satuan beli → stok (NULL = tanpa konversi). satuanStok selalu satuan master material.
    satuanStok: l.material?.unit ?? l.unit,
    ...(l.purchaseUnit && { konversi: { satuanBeli: l.purchaseUnit, faktor: Number(l.conversionFactor), satuanStok: l.material?.unit ?? null } }),
    ...(l.supplierItemName && { namaSupplier: l.supplierItemName }),
    ...(l.supplierSku && { kodeSupplier: l.supplierSku }),
    catatan: l.notes,
    // Jumlah fisik pendamping (null = tanpa pendamping): satuan utama tetap dasar nilai & stok.
    pendamping: pendampingPO({ unit: l.unit, qty: l.qty, companionUnit: l.companionUnit, companionMode: l.companionMode, companionRatio: l.companionRatio, companionEstimate: l.companionEstimate }),
    ...q,
    ...(harga && {
      hargaSatuan: l.unitPrice,
      nilaiDipesan: nilaiK(k(q.dipesan)),
      nilaiDiterima: nilaiK(k(q.diterimaBaik)),
      nilaiDitagih: nilaiK(k(q.ditagih)),
    }),
  };
}

/** Bentuk PO untuk API. `harga:false` = tampilan Gudang (tanpa harga & nilai). */
export async function bentukPO(tx, id, { harga = true, denganPenerimaan = true } = {}) {
  const po = await tx.finPurchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      lines: { orderBy: { sortOrder: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } },
    },
  });
  if (!po) return null;
  const kuantitas = await hitungKuantitas(tx, po);
  const lines = po.lines.map((l) => bentukBaris(l, kuantitas.get(l.id), { harga }));
  const total = (f) => rp(lines.reduce((s, l) => s + (l[f] ?? 0), 0));

  const keluaran = {
    id: po.id, poNumber: po.poNumber, status: po.status,
    supplier: po.supplier,
    orderDate: po.orderDate, expectedDate: po.expectedDate, notes: po.notes,
    createdBy: po.createdBy, approvedBy: po.approvedBy, approvedAt: po.approvedAt,
    cancelledAt: po.cancelledAt, cancelReason: po.cancelReason,
    createdAt: po.createdAt,
    lines,
    // Termin hanya untuk Finance (Gudang tidak melihat harga/utang). Snapshot dokumen — tidak berubah bila master supplier diubah.
    ...(harga && { termin: po.termType ? { jenis: po.termType, hari: po.termDays, label: labelTermin(po.termType, po.termDays), sumber: po.termSource, alasan: po.termOverrideReason, olehId: po.termSetById, pada: po.termSetAt } : null }),
    ...(harga && { totalDipesan: total("nilaiDipesan"), totalDiterima: total("nilaiDiterima"), totalDitagih: total("nilaiDitagih") }),
  };

  if (denganPenerimaan) {
    const penerimaan = await tx.goodsReceipt.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, receiptNumber: true, status: true, deliveryNote: true, receivedDate: true, createdAt: true,
        finSupplierBills: { select: { id: true, billNumber: true, supplierRef: true, status: true, ...(harga && { amount: true }) } },
        // Faktur atas PO (Fase 2) menagih per baris penerimaan lewat alokasi.
        billAllocations: { select: { bill: { select: { id: true, billNumber: true, supplierRef: true, status: true } } } },
        lines: { select: { id: true, purchaseOrderLineId: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true } },
      },
    });
    if (harga) {
      const faktur = await tx.finSupplierBill.findMany({
        where: { purchaseOrderId: po.id }, orderBy: { createdAt: "asc" },
        select: { id: true, billNumber: true, supplierRef: true, status: true, amount: true, poReviewNote: true, createdAt: true },
      });
      keluaran.faktur = faktur.map((f) => ({ ...f, amount: Number(f.amount) }));
    }
    keluaran.penerimaan = penerimaan.map((r) => ({
      ...r,
      finSupplierBills: [
        ...r.finSupplierBills.map((t) => ({ ...t, ...(t.amount !== undefined && { amount: Number(t.amount) }) })),
        ...[...new Map(r.billAllocations.map((a) => [a.bill.id, a.bill])).values()].map((t) => ({ ...t, lewatPO: true })),
      ],
      billAllocations: undefined,
    }));
  }
  return keluaran;
}

export async function daftarRiwayat(tx, id) {
  const events = await tx.finPurchaseOrderEvent.findMany({
    where: { purchaseOrderId: id }, orderBy: { createdAt: "asc" },
    include: { actor: { select: { id: true, name: true } } },
  });
  return events.map((e) => ({ id: e.id, type: e.type, note: e.note, metadata: e.metadata, createdAt: e.createdAt, actor: e.actor }));
}

/** Daftar ringkas (tanpa detail penerimaan) — dipakai layar daftar Finance & pemilih Gudang. */
export async function daftarPO(tx, { status, supplierId, q, harga = true } = {}) {
  const where = {
    ...(status && { status: { in: String(status).split(",").map((s) => s.trim()).filter((s) => STATUS_PO.includes(s)) } }),
    ...(supplierId && { supplierId }),
    ...(q && { OR: [{ poNumber: { contains: String(q), mode: "insensitive" } }, { supplier: { name: { contains: String(q), mode: "insensitive" } } }] }),
  };
  const ids = await tx.finPurchaseOrder.findMany({ where, orderBy: [{ createdAt: "desc" }], take: 300, select: { id: true } });
  const hasil = [];
  for (const { id } of ids) hasil.push(await bentukPO(tx, id, { harga, denganPenerimaan: false }));
  return hasil;
}
