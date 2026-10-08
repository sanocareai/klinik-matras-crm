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

export class PurchaseOrderError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
const gagal = (m, s = 400) => new PurchaseOrderError(m, s);

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

/** Validasi + normalisasi isi PO (dipakai buat & ubah draf). Mengembalikan data siap simpan. */
async function siapkanMasukan(tx, body) {
  const b = body ?? {};
  if (!b.supplierId) throw gagal("Supplier wajib dipilih");
  const supplier = await tx.finSupplier.findUnique({ where: { id: b.supplierId }, select: { id: true, name: true, active: true } });
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
  for (const [i, l] of lines.entries()) {
    const no = i + 1;
    if (!l?.materialId) throw gagal(`Baris ${no}: item katalog wajib dipilih`);
    if (dipakai.has(l.materialId)) throw gagal(`Baris ${no}: item yang sama sudah ada di PO ini — gabungkan jumlahnya jadi satu baris`);
    dipakai.add(l.materialId);

    const material = await tx.material.findUnique({ where: { id: l.materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
    if (!material) throw gagal(`Baris ${no}: item katalog tidak ditemukan`, 404);
    if (!material.active) throw gagal(`Baris ${no}: ${material.code} nonaktif di katalog`, 409);

    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw gagal(`Baris ${no} (${material.code}): jumlah harus lebih dari 0`);
    if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 1e-6) throw gagal(`Baris ${no} (${material.code}): jumlah maksimal 3 angka di belakang koma`);
    if (qty > 99_999_999) throw gagal(`Baris ${no} (${material.code}): jumlah terlalu besar`);

    const harga = Number(l.unitPrice);
    if (!Number.isInteger(harga) || harga <= 0) throw gagal(`Baris ${no} (${material.code}): harga satuan harus rupiah bulat lebih dari 0`);
    if (harga > 2_000_000_000) throw gagal(`Baris ${no} (${material.code}): harga satuan terlalu besar`);

    hasil.push({ materialId: material.id, unit: String(material.unit), qty: dariK(k(qty)), unitPrice: harga, notes: l.notes?.trim() || null, sortOrder: i });
  }
  return { supplier, orderDate, expectedDate, notes: b.notes?.trim() || null, lines: hasil };
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

export async function buatPO(tx, { body, userId }) {
  const m = await siapkanMasukan(tx, body);
  const poNumber = await generateDocumentNumber(tx, "PO", m.orderDate);
  const po = await tx.finPurchaseOrder.create({
    data: {
      poNumber, supplierId: m.supplier.id, orderDate: m.orderDate, expectedDate: m.expectedDate, notes: m.notes,
      status: "DRAFT", createdById: userId,
      lines: { create: m.lines },
    },
  });
  await catat(tx, po, "DIBUAT", userId, { metadata: { supplier: m.supplier.name, jumlahBaris: m.lines.length } });
  return po.id;
}

export async function ubahDraf(tx, { id, body, userId }) {
  const po = await kunciDanMuat(tx, id);
  if (po.status !== "DRAFT") throw gagal(`PO berstatus ${po.status} tidak bisa diubah — hanya draf yang bisa diedit (batalkan dan buat PO baru bila perlu)`, 409);
  const m = await siapkanMasukan(tx, body);
  await tx.finPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: po.id } });
  await tx.finPurchaseOrder.update({
    where: { id: po.id },
    data: { supplierId: m.supplier.id, orderDate: m.orderDate, expectedDate: m.expectedDate, notes: m.notes, lines: { create: m.lines } },
  });
  await catat(tx, po, "DIUBAH", userId, { metadata: { supplier: m.supplier.name, jumlahBaris: m.lines.length } });
  return po.id;
}

export async function setujuiPO(tx, { id, userId }) {
  const po = await kunciDanMuat(tx, id);
  if (po.status !== "DRAFT") throw gagal(`PO ini sudah berstatus ${po.status}`, 409);
  // Validasi ulang isi saat disetujui: supplier/katalog bisa berubah sejak draf dibuat.
  await siapkanMasukan(tx, {
    supplierId: po.supplierId, orderDate: po.orderDate, expectedDate: po.expectedDate,
    lines: po.lines.map((l) => ({ materialId: l.materialId, qty: Number(l.qty), unitPrice: l.unitPrice })),
  });
  await tx.finPurchaseOrder.update({ where: { id: po.id }, data: { status: "DISETUJUI", approvedAt: new Date(), approvedById: userId } });
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
      if (b.goodsReceipt.finSupplierBills.some((t) => STATUS_TAGIHAN_AKTIF.includes(t.status))) a.ditagihK += k(b.acceptedQty);
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
  for (const [nama, v] of [["Diterima", receivedQty], ["Baik", acceptedQty], ["Ditolak", rejectedQty]]) {
    if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0)) throw gagal(`Jumlah ${nama.toLowerCase()} tidak boleh negatif`);
  }
  if (receivedQty != null && k(acceptedQty ?? 0) + k(rejectedQty ?? 0) > k(receivedQty)) {
    throw gagal(`Jumlah baik (${acceptedQty ?? 0}) + ditolak (${rejectedQty ?? 0}) tidak boleh melebihi jumlah yang datang (${receivedQty})`);
  }
  if (acceptedQty != null && Number(acceptedQty) > 0) {
    const baris = await tx.finPurchaseOrderLine.findUnique({ where: { id: receiptLine.purchaseOrderLineId }, include: { purchaseOrder: true } });
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
    throw gagal(`PO ${po.poNumber} berstatus ${po.status} — penerimaan ini tidak bisa ditempatkan. Hubungi Finance.`, 409);
  }
  const kuantitas = await hitungKuantitas(tx, po);
  const harga = new Map();
  for (const l of receipt.lines) {
    if (!l.purchaseOrderLineId || !(Number(l.acceptedQty) > 0)) continue;
    const baris = po.lines.find((x) => x.id === l.purchaseOrderLineId);
    if (!baris) throw gagal("Baris penerimaan menunjuk baris PO yang tidak dikenal", 409);
    const q = kuantitas.get(baris.id);
    if (k(l.acceptedQty) > k(q.belumDiterima)) {
      throw gagal(
        `Jumlah baik ${l.material?.code ?? ""} (${l.acceptedQty}) melebihi sisa PO ${po.poNumber} (${q.belumDiterima} dari ${q.dipesan} dipesan; ` +
        `${q.diterimaBaik} sudah masuk stok). Putaway dibatalkan, tidak ada stok yang tertulis. Kurangi jumlah baik atau minta Finance merevisi jumlah PO.`, 409);
    }
    harga.set(l.purchaseOrderLineId, baris.unitPrice);
  }
  return { po, harga };
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
    catatan: l.notes,
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
    ...(harga && { totalDipesan: total("nilaiDipesan"), totalDiterima: total("nilaiDiterima"), totalDitagih: total("nilaiDitagih") }),
  };

  if (denganPenerimaan) {
    const penerimaan = await tx.goodsReceipt.findMany({
      where: { purchaseOrderId: po.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, receiptNumber: true, status: true, deliveryNote: true, receivedDate: true, createdAt: true,
        finSupplierBills: { select: { id: true, billNumber: true, supplierRef: true, status: true, ...(harga && { amount: true }) } },
        lines: { select: { id: true, purchaseOrderLineId: true, orderedQty: true, receivedQty: true, acceptedQty: true, rejectedQty: true } },
      },
    });
    keluaran.penerimaan = penerimaan.map((r) => ({
      ...r,
      finSupplierBills: r.finSupplierBills.map((t) => ({ ...t, ...(t.amount !== undefined && { amount: Number(t.amount) }) })),
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
