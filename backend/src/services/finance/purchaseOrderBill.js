// PO FASE 2 — PENCOCOKAN FAKTUR SUPPLIER PER BARIS.
//
// Faktur (FinSupplierBill dengan purchaseOrderId) menagih jumlah per BARIS PO pada harga faktur. Aturan yang TIDAK BOLEH dilonggarkan:
//   1. Faktur/pembayaran TIDAK menambah stok. Stok hanya lahir saat putaway penerimaan (routes/goodsReceipt.js). Tidak ada postStockMovement di sini.
//   2. Jumlah barang baik yang sama tidak boleh ditagih dua kali. Klaim = alokasi faktur berstatus masuk buku (DISETUJUI/DIBAYAR/LUNAS) per BARIS
//      PENERIMAAN; ditegakkan saat faktur DISETUJUI di bawah kunci baris PO (dua persetujuan paralel diserialkan; yang kedua melihat klaim pertama).
//      Faktur yang menagih lebih dari barang baik yang belum ditagih TERTAHAN (tidak bisa disetujui) dengan alasan per baris.
//   3. TIDAK ADA toleransi otomatis. Selisih harga sekecil apa pun wajib melalui tinjauan Finance (catatan tinjauan saat menyetujui); setelah
//      disetujui, selisihnya dijurnal oleh kebijakan Selisih Harga Pembelian yang sudah ada (posting/supplier.js: Dr/Cr akun SELISIH_HARGA_PEMBELIAN).
//   4. Nilai penutupan GRNI = jumlah teralokasi × HARGA PO (harga yang sama dengan nilai stok saat putaway), bukan harga faktur.
import { lockRowForUpdate } from "../inventoryLedger.js";
import { generateDocumentNumber, toBookDate, todayBookDateWIB, findEntryByKey } from "./journal.js";
import { toMoney, sumMoney, ZERO, moneyToNumber } from "./money.js";

export class TagihanPoError extends Error {
  constructor(message, statusCode = 409, code) { super(message); this.statusCode = statusCode; if (code) this.code = code; }
}
const gagal = (m, s = 400, c) => new TagihanPoError(m, s, c);

export const STATUS_MASUK_BUKU = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const STATUS_TERBUKA = ["DRAFT", "MENUNGGU_APPROVAL"];
const MIN_CATATAN_TINJAUAN = 5;

// Kuantitas dihitung dalam seperseribu (bilangan bulat) supaya perbandingan Float penerimaan vs Decimal tidak bocor ke 0.1+0.2.
const k = (v) => Math.round(Number(v ?? 0) * 1000);
const dariK = (n) => n / 1000;
const jumlahTeks = (n) => dariK(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });

// ── Konteks penerimaan PO ────────────────────────────────────────────────

/**
 * Baris penerimaan yang SUDAH menulis stok (COMPLETED) beserta klaim penagihannya.
 * tersedia = diterima baik − klaim. Penerimaan yang sudah ditagih lewat tagihan LAMA (satu tagihan menutup seluruh penerimaan, goodsReceiptId)
 * dianggap terklaim penuh. `kecualiBillId` mengabaikan alokasi faktur itu (untuk mengevaluasi faktur yang sedang diperiksa).
 */
export async function muatKonteks(tx, poId, { kecualiBillId = null } = {}) {
  const baris = await tx.goodsReceiptLine.findMany({
    where: { purchaseOrderLine: { purchaseOrderId: poId }, goodsReceipt: { status: "COMPLETED" }, acceptedQty: { gt: 0 } },
    select: {
      id: true, purchaseOrderLineId: true, acceptedQty: true,
      goodsReceipt: {
        select: {
          id: true, receiptNumber: true, receivedDate: true, createdAt: true,
          finSupplierBills: { where: { status: { in: STATUS_MASUK_BUKU } }, select: { id: true } },
        },
      },
    },
  });
  const ids = baris.map((b) => b.id);
  const alokasi = ids.length
    ? await tx.finSupplierBillAllocation.findMany({
        where: { goodsReceiptLineId: { in: ids }, bill: { status: { in: STATUS_MASUK_BUKU } }, ...(kecualiBillId && { billId: { not: kecualiBillId } }) },
        select: { goodsReceiptLineId: true, qty: true },
      })
    : [];
  const klaim = new Map();
  for (const a of alokasi) klaim.set(a.goodsReceiptLineId, (klaim.get(a.goodsReceiptLineId) ?? 0) + k(a.qty));

  const hasil = baris.map((b) => {
    const diterimaK = k(b.acceptedQty);
    const lama = b.goodsReceipt.finSupplierBills.length > 0;
    const diklaimK = Math.min(diterimaK, lama ? diterimaK : klaim.get(b.id) ?? 0);
    return {
      id: b.id, purchaseOrderLineId: b.purchaseOrderLineId,
      receiptId: b.goodsReceipt.id, receiptNumber: b.goodsReceipt.receiptNumber,
      urut: `${(b.goodsReceipt.receivedDate ?? b.goodsReceipt.createdAt).toISOString()}|${b.goodsReceipt.receiptNumber}|${b.id}`,
      diterimaK, diklaimK, tersediaK: diterimaK - diklaimK, ditagihLama: lama,
    };
  });
  hasil.sort((a, b) => (a.urut < b.urut ? -1 : 1));
  return hasil;
}

/** Alokasi FIFO jumlah faktur per baris PO ke baris penerimaan (hanya penerimaan terpilih bila ada). Mengembalikan alokasi + kekurangan per baris. */
export function alokasiFifo(konteks, barisFaktur, penerimaanTerpilih = []) {
  const terpilih = new Set(penerimaanTerpilih);
  const sisa = new Map(konteks.map((b) => [b.id, b.tersediaK]));
  const alokasi = [];
  const kurang = new Map();
  for (const f of barisFaktur) {
    let butuh = k(f.qty);
    for (const b of konteks) {
      if (butuh <= 0) break;
      if (b.purchaseOrderLineId !== f.purchaseOrderLineId) continue;
      if (terpilih.size > 0 && !terpilih.has(b.receiptId)) continue;
      const ambil = Math.min(butuh, sisa.get(b.id));
      if (ambil <= 0) continue;
      alokasi.push({ purchaseOrderLineId: f.purchaseOrderLineId, billPoLineId: f.id, goodsReceiptLineId: b.id, goodsReceiptId: b.receiptId, receiptNumber: b.receiptNumber, qtyK: ambil });
      sisa.set(b.id, sisa.get(b.id) - ambil);
      butuh -= ambil;
    }
    if (butuh > 0) kurang.set(f.purchaseOrderLineId, butuh);
  }
  return { alokasi, kurang };
}

const tersediaPerBaris = (konteks, poLineId, terpilih = []) => {
  const t = new Set(terpilih);
  return konteks.filter((b) => b.purchaseOrderLineId === poLineId && (t.size === 0 || t.has(b.receiptId))).reduce((s, b) => s + b.tersediaK, 0);
};

// ── Masukan ──────────────────────────────────────────────────────────────

async function siapkanMasukan(tx, body, { po }) {
  const b = body ?? {};
  if (!po || ["DRAFT", "DIBATALKAN"].includes(po.status)) throw gagal(`PO ${po?.poNumber ?? ""} berstatus ${po?.status ?? "tidak ada"} — hanya PO yang sudah disetujui dan bukan dibatalkan yang bisa difakturkan`, 409, "PO_TIDAK_BISA_DIFAKTURKAN");
  if (b.supplierId && b.supplierId !== po.supplierId) throw gagal("Supplier faktur harus sama dengan supplier PO", 400, "SUPPLIER_BEDA");
  const ref = String(b.supplierRef ?? "").trim();
  if (!ref) throw gagal("Nomor faktur supplier wajib diisi untuk faktur atas PO");
  const tgl = b.billDate ? toBookDate(b.billDate) : todayBookDateWIB();
  const jatuhTempo = b.dueDate ? toBookDate(b.dueDate) : null;

  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) throw gagal("Minimal satu baris faktur wajib diisi");
  const dipakai = new Set();
  const hasil = [];
  for (const [i, l] of lines.entries()) {
    const no = i + 1;
    const poLine = po.lines.find((x) => x.id === l?.purchaseOrderLineId);
    if (!poLine) throw gagal(`Baris ${no}: bukan bagian dari ${po.poNumber}`);
    if (dipakai.has(poLine.id)) throw gagal(`Baris ${no}: baris PO yang sama diisi dua kali — gabungkan jumlahnya`);
    dipakai.add(poLine.id);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw gagal(`Baris ${no}: jumlah faktur harus lebih dari 0`);
    if (Math.abs(qty * 100 - Math.round(qty * 100)) > 1e-6) throw gagal(`Baris ${no}: jumlah maksimal 2 angka di belakang koma`);
    const harga = Number(l.unitPrice);
    if (!Number.isFinite(harga) || harga <= 0) throw gagal(`Baris ${no}: harga faktur harus lebih dari 0`);
    if (Math.abs(harga * 100 - Math.round(harga * 100)) > 1e-6) throw gagal(`Baris ${no}: harga faktur maksimal 2 angka di belakang koma`);
    hasil.push({ purchaseOrderLineId: poLine.id, qty: dariK(k(qty)), invoiceUnitPrice: harga, poUnitPrice: poLine.unitPrice, sortOrder: i });
  }

  const idPenerimaan = [...new Set((Array.isArray(b.receiptIds) ? b.receiptIds : []).filter(Boolean))];
  if (idPenerimaan.length > 0) {
    const ada = await tx.goodsReceipt.findMany({ where: { id: { in: idPenerimaan }, purchaseOrderId: po.id, status: "COMPLETED" }, select: { id: true } });
    if (ada.length !== idPenerimaan.length) throw gagal("Ada penerimaan yang dipilih bukan penerimaan selesai dari PO ini");
  }
  const jumlah = sumMoney(hasil.map((h) => toMoney(h.qty).times(toMoney(h.invoiceUnitPrice))));
  if (b.amount !== undefined && b.amount !== null && b.amount !== "" && !toMoney(b.amount).equals(jumlah)) {
    throw gagal(`Nominal faktur (${moneyToNumber(toMoney(b.amount))}) harus sama dengan jumlah baris (${moneyToNumber(jumlah)}). Biaya lain (ongkir/pajak) belum didukung pada faktur atas PO.`, 400, "NOMINAL_TIDAK_SAMA");
  }
  return { ref, tgl, jatuhTempo, lines: hasil, idPenerimaan, jumlah, deskripsi: String(b.description ?? "").trim() };
}

async function muatPo(tx, poId) {
  return tx.finPurchaseOrder.findUnique({ where: { id: poId }, include: { lines: { orderBy: { sortOrder: "asc" }, include: { material: { select: { code: true, name: true } } } }, supplier: { select: { id: true, name: true, paymentTermDays: true } } } });
}

// ── Perintah ─────────────────────────────────────────────────────────────

/** Catat faktur atas PO (status Menunggu Persetujuan). Jumlah yang melebihi barang baik belum ditagih TIDAK ditolak di sini — faktur tertahan saat disetujui. */
export async function buatTagihanDariPO(tx, { poId, body, userId }) {
  const po = await muatPo(tx, poId);
  if (!po) throw gagal("PO tidak ditemukan", 404);
  const m = await siapkanMasukan(tx, body, { po });
  let jatuhTempo = m.jatuhTempo;
  if (!jatuhTempo && po.supplier.paymentTermDays) jatuhTempo = new Date(m.tgl.getTime() + po.supplier.paymentTermDays * 86400000);
  const bill = await tx.finSupplierBill.create({
    data: {
      billNumber: await generateDocumentNumber(tx, "BILL", m.tgl),
      supplierRef: m.ref, supplierId: po.supplierId, billDate: m.tgl, dueDate: jatuhTempo,
      amount: m.jumlah,
      description: m.deskripsi || `Faktur ${m.ref} atas ${po.poNumber}`,
      billType: "BAHAN_BAKU", purchaseOrderId: po.id,
      status: "MENUNGGU_APPROVAL", createdById: userId,
      poLines: { create: m.lines },
      poReceipts: { create: m.idPenerimaan.map((goodsReceiptId) => ({ goodsReceiptId })) },
    },
  });
  return bill.id;
}

/** Ubah baris/penerimaan/header faktur PO yang BELUM disetujui. Mengganti seluruh baris; nominal dihitung ulang. */
export async function ubahTagihanPO(tx, { billId, body, userId, adalahAdmin }) {
  const alasan = String(body?.reason ?? "").trim();
  if (!alasan) throw gagal("Alasan perubahan wajib diisi");
  await lockRowForUpdate(tx, '"fin_supplier_bills"', billId);
  const bill = await tx.finSupplierBill.findUnique({ where: { id: billId } });
  if (!bill || !bill.purchaseOrderId) throw gagal("Faktur atas PO tidak ditemukan", 404);
  if (!STATUS_TERBUKA.includes(bill.status)) throw gagal(`Tagihan berstatus ${bill.status} tidak bisa diubah. Yang sudah masuk buku: batalkan lalu catat ulang.`, 409);
  if (bill.createdById !== userId && !adalahAdmin) throw gagal("Hanya pembuat tagihan (atau admin keuangan) yang boleh mengedit", 403);
  const po = await muatPo(tx, bill.purchaseOrderId);
  const m = await siapkanMasukan(tx, { supplierRef: bill.supplierRef, billDate: bill.billDate, dueDate: bill.dueDate, description: bill.description, ...body }, { po });
  await tx.finSupplierBillPoLine.deleteMany({ where: { billId } });
  await tx.finSupplierBillPoReceipt.deleteMany({ where: { billId } });
  await tx.finSupplierBill.update({
    where: { id: billId },
    data: {
      supplierRef: m.ref, billDate: m.tgl, dueDate: m.jatuhTempo ?? bill.dueDate, amount: m.jumlah,
      description: m.deskripsi || bill.description,
      poLines: { create: m.lines },
      poReceipts: { create: m.idPenerimaan.map((goodsReceiptId) => ({ goodsReceiptId })) },
    },
  });
  return billId;
}

// ── Evaluasi (baca) ──────────────────────────────────────────────────────

/**
 * Pencocokan satu faktur dengan PO: per baris dipesan, diterima baik, sudah ditagih (faktur lain yang masuk buku), diajukan pada faktur ini,
 * harga PO, harga faktur, selisih; plus status TERTAHAN (+alasan) dan PERLU TINJAUAN HARGA. Murni baca.
 */
export async function evaluasiTagihanPO(tx, billId) {
  const bill = await tx.finSupplierBill.findUnique({
    where: { id: billId },
    include: { poLines: { orderBy: { sortOrder: "asc" } }, poReceipts: { select: { goodsReceiptId: true } }, poAllocations: { include: { goodsReceiptLine: { select: { id: true } }, goodsReceipt: { select: { id: true, receiptNumber: true } } } } },
  });
  if (!bill?.purchaseOrderId) return null;
  const po = await muatPo(tx, bill.purchaseOrderId);
  const konteks = await muatKonteks(tx, po.id, { kecualiBillId: bill.id });
  const terpilih = bill.poReceipts.map((r) => r.goodsReceiptId);
  const masukBuku = STATUS_MASUK_BUKU.includes(bill.status);
  const terbuka = STATUS_TERBUKA.includes(bill.status);

  const baris = bill.poLines.map((l) => {
    const pl = po.lines.find((x) => x.id === l.purchaseOrderLineId);
    const diterima = konteks.filter((b) => b.purchaseOrderLineId === l.purchaseOrderLineId).reduce((s, b) => s + b.diterimaK, 0);
    const ditagihLain = konteks.filter((b) => b.purchaseOrderLineId === l.purchaseOrderLineId).reduce((s, b) => s + b.diklaimK, 0);
    const tersedia = tersediaPerBaris(konteks, l.purchaseOrderLineId, terpilih);
    const selisihSatuan = toMoney(l.invoiceUnitPrice).minus(toMoney(l.poUnitPrice));
    const selisihNilai = selisihSatuan.times(toMoney(l.qty));
    return {
      id: l.id, purchaseOrderLineId: l.purchaseOrderLineId, kode: pl?.material?.code ?? null, nama: pl?.material?.name ?? null, satuan: pl?.unit ?? null,
      dipesan: Number(pl?.qty ?? 0), diterimaBaik: dariK(diterima), sudahDitagih: dariK(ditagihLain), tersedia: dariK(tersedia),
      diajukanIni: Number(l.qty), hargaPO: l.poUnitPrice, hargaFaktur: moneyToNumber(toMoney(l.invoiceUnitPrice)),
      selisihHarga: moneyToNumber(selisihSatuan), selisihNilai: moneyToNumber(selisihNilai),
      melebihi: terbuka && k(l.qty) > tersedia,
    };
  });

  const alasan = [];
  if (terbuka) {
    if (["DRAFT", "DIBATALKAN"].includes(po.status)) alasan.push(`PO ${po.poNumber} berstatus ${po.status}`);
    for (const b of baris.filter((x) => x.melebihi)) {
      alasan.push(
        `${b.kode}: faktur menagih ${jumlahTeks(k(b.diajukanIni))} ${b.satuan}, barang baik yang belum ditagih hanya ${jumlahTeks(k(b.tersedia))} ` +
        `(diterima baik ${jumlahTeks(k(b.diterimaBaik))}, sudah ditagih ${jumlahTeks(k(b.sudahDitagih))}${terpilih.length ? ", dari penerimaan terpilih" : ""})`);
    }
    // Penerimaan terpilih harus sudah dibukukan ke Persediaan (Dr Persediaan / Cr GRNI).
    const dipakai = [...new Set(konteks.filter((b) => bill.poLines.some((l) => l.purchaseOrderLineId === b.purchaseOrderLineId) && (terpilih.length === 0 || terpilih.includes(b.receiptId))).map((b) => b.receiptId))];
    for (const gr of dipakai) {
      const j = await findEntryByKey(tx, `PENERIMAAN_BAHAN:${gr}`);
      if (!j || j.status !== "POSTED") alasan.push(`Penerimaan ${konteks.find((b) => b.receiptId === gr).receiptNumber} belum dibukukan ke Persediaan (lengkapi di Finance › Data Belum Lengkap)`);
    }
  }
  const adaSelisih = baris.some((b) => b.selisihHarga !== 0);
  return {
    billId: bill.id, billNumber: bill.billNumber, status: bill.status, supplierRef: bill.supplierRef, billDate: bill.billDate, dueDate: bill.dueDate, purchaseOrderId: po.id, poNumber: po.poNumber,
    amount: moneyToNumber(toMoney(bill.amount)),
    penerimaanTerpilih: terpilih,
    tertahan: alasan.length > 0, alasanTertahan: alasan,
    perluTinjauanHarga: adaSelisih, selisihHargaTotal: moneyToNumber(sumMoney(baris.map((b) => b.selisihNilai))),
    catatanTinjauan: bill.poReviewNote, ditinjauOleh: bill.poReviewedBy, ditinjauPada: bill.poReviewedAt,
    barisFaktur: baris,
    alokasi: bill.poAllocations.map((a) => ({ goodsReceiptId: a.goodsReceiptId, receiptNumber: a.goodsReceipt.receiptNumber, goodsReceiptLineId: a.goodsReceiptLineId, qty: Number(a.qty), hargaPO: a.poUnitPrice })),
    masukBuku,
  };
}

/** Pandangan penagihan satu PO untuk membuat faktur: per baris dipesan/diterima baik/sudah ditagih/tersedia + penerimaan beserta sisa tertagihnya. */
export async function pandanganPenagihan(tx, poId) {
  const po = await muatPo(tx, poId);
  if (!po) return null;
  const konteks = await muatKonteks(tx, po.id);
  const penerimaan = new Map();
  for (const b of konteks) {
    const r = penerimaan.get(b.receiptId) ?? { id: b.receiptId, receiptNumber: b.receiptNumber, diterimaBaik: 0, sudahDitagih: 0, tersedia: 0 };
    r.diterimaBaik += b.diterimaK; r.sudahDitagih += b.diklaimK; r.tersedia += b.tersediaK;
    penerimaan.set(b.receiptId, r);
  }
  const fakturTerbuka = await tx.finSupplierBill.findMany({
    where: { purchaseOrderId: po.id, status: { in: ["DRAFT", "MENUNGGU_APPROVAL"] } }, orderBy: { createdAt: "asc" },
    select: { id: true, billNumber: true, supplierRef: true, status: true, amount: true },
  });
  return {
    purchaseOrderId: po.id, poNumber: po.poNumber, status: po.status, supplier: { id: po.supplier.id, name: po.supplier.name },
    bisaDifakturkan: !["DRAFT", "DIBATALKAN"].includes(po.status),
    barisPO: po.lines.map((l) => {
      const per = konteks.filter((b) => b.purchaseOrderLineId === l.id);
      const sum = (f) => dariK(per.reduce((s, b) => s + b[f], 0));
      return { purchaseOrderLineId: l.id, kode: l.material.code, nama: l.material.name, satuan: l.unit, dipesan: Number(l.qty), hargaPO: l.unitPrice, diterimaBaik: sum("diterimaK"), sudahDitagih: sum("diklaimK"), tersedia: sum("tersediaK") };
    }),
    penerimaan: [...penerimaan.values()].map((r) => ({ ...r, diterimaBaik: dariK(r.diterimaBaik), sudahDitagih: dariK(r.sudahDitagih), tersedia: dariK(r.tersedia) })),
    fakturTerbuka: fakturTerbuka.map((f) => ({ ...f, amount: moneyToNumber(toMoney(f.amount)) })),
  };
}

// ── Persetujuan ──────────────────────────────────────────────────────────

/**
 * Dipanggil di DALAM transaksi persetujuan (baris tagihan sudah terkunci): mengunci PO, memastikan jumlah faktur tidak melebihi barang baik yang belum
 * ditagih (jika melebihi → 409 TAGIHAN_PO_TERTAHAN, tanpa alokasi tertulis), mewajibkan catatan tinjauan bila harga berbeda, lalu MENULIS alokasi
 * ke baris penerimaan. Tidak menulis stok maupun jurnal (jurnal ditulis postSupplierBill setelah ini).
 */
export async function setujuiTagihanPO(tx, { bill, catatanTinjauan, userId }) {
  await lockRowForUpdate(tx, "fin_purchase_orders", bill.purchaseOrderId);
  const po = await muatPo(tx, bill.purchaseOrderId);
  if (["DRAFT", "DIBATALKAN"].includes(po.status)) throw gagal(`PO ${po.poNumber} berstatus ${po.status} — faktur tidak bisa disetujui`, 409, "PO_TIDAK_BISA_DIFAKTURKAN");
  if (bill.supplierId !== po.supplierId) throw gagal("Supplier tagihan berbeda dari supplier PO", 409, "SUPPLIER_BEDA");

  const poLines = await tx.finSupplierBillPoLine.findMany({ where: { billId: bill.id }, orderBy: { sortOrder: "asc" } });
  if (poLines.length === 0) throw gagal("Faktur atas PO ini tidak punya baris", 409);
  const jumlah = sumMoney(poLines.map((l) => toMoney(l.qty).times(toMoney(l.invoiceUnitPrice))));
  if (!jumlah.equals(toMoney(bill.amount))) throw gagal("Nominal faktur tidak sama dengan jumlah baris — edit faktur lalu coba lagi", 409, "NOMINAL_TIDAK_SAMA");

  const terpilih = (await tx.finSupplierBillPoReceipt.findMany({ where: { billId: bill.id }, select: { goodsReceiptId: true } })).map((r) => r.goodsReceiptId);
  const konteks = await muatKonteks(tx, po.id, { kecualiBillId: bill.id });
  const { alokasi, kurang } = alokasiFifo(konteks, poLines, terpilih);

  if (kurang.size > 0) {
    const rincian = [];
    for (const [poLineId, kurangK] of kurang) {
      const pl = po.lines.find((x) => x.id === poLineId);
      const l = poLines.find((x) => x.purchaseOrderLineId === poLineId);
      const per = konteks.filter((b) => b.purchaseOrderLineId === poLineId);
      const diterima = per.reduce((s, b) => s + b.diterimaK, 0);
      const ditagih = per.reduce((s, b) => s + b.diklaimK, 0);
      rincian.push(`${pl.material.code}: faktur menagih ${jumlahTeks(k(l.qty))} ${pl.unit}, barang baik yang belum ditagih hanya ${jumlahTeks(tersediaPerBaris(konteks, poLineId, terpilih))} (diterima baik ${jumlahTeks(diterima)}, sudah ditagih ${jumlahTeks(ditagih)}${terpilih.length ? ", dari penerimaan terpilih" : ""}; kurang ${jumlahTeks(kurangK)})`);
    }
    throw gagal(`Faktur ${bill.supplierRef ?? bill.billNumber} TERTAHAN — menagih lebih dari barang baik yang belum ditagih. ${rincian.join("; ")}. Tunggu penerimaan berikutnya ditempatkan atau koreksi jumlah faktur.`, 409, "TAGIHAN_PO_TERTAHAN");
  }

  for (const gr of [...new Set(alokasi.map((a) => a.goodsReceiptId))]) {
    const j = await findEntryByKey(tx, `PENERIMAAN_BAHAN:${gr}`);
    if (!j || j.status !== "POSTED") {
      throw gagal(`Penerimaan ${alokasi.find((a) => a.goodsReceiptId === gr).receiptNumber} belum dibukukan ke Persediaan. Lengkapi lewat Finance › Data Belum Lengkap sebelum menyetujui faktur.`, 409, "PENERIMAAN_BELUM_DIBUKUKAN");
    }
  }

  const berbeda = poLines.filter((l) => !toMoney(l.invoiceUnitPrice).equals(toMoney(l.poUnitPrice)));
  let catatan = null;
  if (berbeda.length > 0) {
    catatan = String(catatanTinjauan ?? "").trim();
    if (catatan.length < MIN_CATATAN_TINJAUAN) {
      const rinci = berbeda.map((l) => {
        const pl = po.lines.find((x) => x.id === l.purchaseOrderLineId);
        return `${pl.material.code}: harga PO ${moneyToNumber(toMoney(l.poUnitPrice))} vs faktur ${moneyToNumber(toMoney(l.invoiceUnitPrice))}`;
      }).join("; ");
      throw gagal(`Harga faktur berbeda dari harga PO (${rinci}). Tidak ada toleransi otomatis: tinjau selisihnya dan setujui dengan catatan tinjauan Finance (minimal ${MIN_CATATAN_TINJAUAN} karakter). Selisih dijurnal ke Selisih Harga Pembelian.`, 409, "SELISIH_HARGA_PERLU_TINJAUAN");
    }
  }

  for (const a of alokasi) {
    await tx.finSupplierBillAllocation.create({
      data: {
        billId: bill.id, billPoLineId: a.billPoLineId, goodsReceiptId: a.goodsReceiptId, goodsReceiptLineId: a.goodsReceiptLineId,
        qty: dariK(a.qtyK), poUnitPrice: poLines.find((l) => l.id === a.billPoLineId).poUnitPrice,
      },
    });
  }
  if (catatan) await tx.finSupplierBill.update({ where: { id: bill.id }, data: { poReviewNote: catatan, poReviewedBy: userId, poReviewedAt: new Date() } });
  return { alokasi: alokasi.length, selisihHarga: berbeda.length > 0 };
}

/** Penutupan GRNI untuk jurnal persetujuan: per penerimaan, Σ jumlah teralokasi × harga PO. Dipakai posting/supplier.js. */
export async function grniDebitPerPenerimaan(tx, billId) {
  const rows = await tx.finSupplierBillAllocation.findMany({
    where: { billId }, select: { goodsReceiptId: true, qty: true, poUnitPrice: true, goodsReceipt: { select: { receiptNumber: true } } },
  });
  const per = new Map();
  for (const r of rows) {
    const nilai = toMoney(r.qty).times(toMoney(r.poUnitPrice));
    const x = per.get(r.goodsReceiptId) ?? { goodsReceiptId: r.goodsReceiptId, receiptNumber: r.goodsReceipt.receiptNumber, nilai: ZERO };
    x.nilai = x.nilai.plus(nilai);
    per.set(r.goodsReceiptId, x);
  }
  const daftar = [...per.values()].map((x) => ({ ...x, nilai: toMoney(x.nilai) })).sort((a, b) => (a.receiptNumber < b.receiptNumber ? -1 : 1));
  return { daftar, total: sumMoney(daftar.map((d) => d.nilai)) };
}
