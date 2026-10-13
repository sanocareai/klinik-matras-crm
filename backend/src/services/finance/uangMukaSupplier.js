// UANG MUKA SUPPLIER SEBELUM BARANG DATANG (Okt 2026) — memakai dan merapikan sistem DP yang SUDAH ADA, bukan sistem kedua:
//   • DP = FinPurchase kategori UANG_MUKA_PEMBELIAN (akun aset 1-1500), dijurnal oleh posting/purchase.js (Dr 1-1500 / Cr Kas-Bank, + Dr Beban Administrasi Bank bila ada biaya admin).
//     Yang baru: DP boleh TERTAUT ke satu PO (fin_purchases.purchase_order_id) dan dibayar lewat satu langkah "Bayar Uang Muka" dari PO.
//   • Penerapan DP ke FAKTUR supplier: baris FinSupplierBillAdvanceApplication + jurnal Dr Utang Usaha / Cr 1-1500; nilainya juga menambah fin_supplier_bills.credit_applied — angka pengurang
//     sisa utang yang SUDAH dibaca aging, kartu, supplier, export, dan pembayaran (tidak ada rumus sisa utang kedua).
//   • PO tetap dokumen komitmen: tidak menulis jurnal/stok/utang. Pembayaran TIDAK PERNAH menambah stok.
//
// Semua angka layar & Excel berasal dari fungsi baca di file ini (satu sumber). Frontend tidak menghitung ulang.
import { randomUUID } from "node:crypto";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { generateDocumentNumber, reverseJournal, toBookDate } from "./journal.js";
import { postPurchaseApproved } from "./posting/purchase.js";
import { postUangMukaDiterapkanKeFaktur } from "./posting/uangMukaSupplier.js";
import { recomputeBillStatus } from "./posting/supplier.js";
import { hitungBiayaTransfer } from "./transferFee.js";
import { pastikanBelumDirekonsiliasi } from "./koreksiGate.js";
import { RECEIPTS_URL_PREFIX } from "./receipts.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class UangMukaError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s = 400, c = null, x = null) => new UangMukaError(m, s, c, x);

export const KODE_KATEGORI_DP = "UANG_MUKA_PEMBELIAN";
const STATUS_PO_BISA_UANG_MUKA = ["DISETUJUI", "DITERIMA_SEBAGIAN"];
const STATUS_FAKTUR_AKTIF = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
const STATUS_FAKTUR_BISA_DITERAPKAN = ["DISETUJUI", "DIBAYAR_SEBAGIAN"];
const rp = (n) => Math.round(Number(n) * 100) / 100;
const uang = (d) => moneyToNumber(d);

/** Definisi tiap angka — dikirim server supaya semua layar (kartu, detail, tooltip, Excel) memakai arti yang sama. */
export const DEFINISI_KEUANGAN_PO = Object.freeze([
  { kunci: "nilaiPO", label: "Nilai PO", definisi: "Total komitmen pembelian pada PO (jumlah dipesan × harga satuan). Bukan utang." },
  { kunci: "uangMukaDibayar", label: "Uang muka dibayar", definisi: "Total uang muka yang sudah dibayar ke supplier untuk PO ini (tidak termasuk biaya admin bank). Aset: Uang Muka Supplier. Bukan stok, bukan biaya, bukan utang." },
  { kunci: "sudahDitagih", label: "Sudah ditagih", definisi: "Total nilai faktur supplier atas PO ini yang sudah DISETUJUI. Faktur belum disetujui tidak dihitung." },
  { kunci: "uangMukaDiterapkan", label: "Uang muka diterapkan", definisi: "Bagian uang muka yang sudah dipakai mengurangi utang faktur atas PO ini (Dr Utang Usaha / Cr Uang Muka)." },
  { kunci: "uangMukaBelumDiterapkan", label: "Uang muka belum diterapkan", definisi: "Uang muka yang sudah dibayar tetapi belum dipakai mengurangi faktur mana pun. Tetap aset; kelebihan di atas faktur menjadi Kredit Supplier (tidak ada refund kas otomatis)." },
  { kunci: "utangTercatat", label: "Utang tercatat", definisi: "Nilai faktur disetujui dikurangi uang muka yang diterapkan dan kredit lain (Debit Note). Utang baru ada setelah faktur disetujui." },
  { kunci: "dibayarAtasFaktur", label: "Sudah dibayar atas faktur", definisi: "Pembayaran kas ke supplier yang dialokasikan ke faktur PO ini (bukan uang muka)." },
  { kunci: "sisaUtang", label: "Sisa utang", definisi: "Utang tercatat dikurangi pembayaran atas faktur. Sama dengan angka di Supplier & Utang dan aging." },
  { kunci: "sisaKomitmen", label: "Sisa komitmen PO", definisi: "Nilai PO dikurangi uang muka dibayar dan pembayaran atas faktur: yang masih akan dibayar untuk PO ini. BUKAN utang — belum ada faktur." },
]);

// ── Pembacaan dasar ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nilai PO = Σ round((qty × harga satuan), 2) per baris — sama dengan yang tampil di detail PO (bentukPO.totalDipesan). */
export async function nilaiPO(db, poId) {
  const lines = await db.finPurchaseOrderLine.findMany({ where: { purchaseOrderId: poId }, select: { qty: true, unitPrice: true } });
  return lines.reduce((s, l) => s + rp((Math.round(Number(l.qty) * 1000) / 1000) * l.unitPrice), 0);
}

const dpWhere = (extra = {}) => ({ category: { code: KODE_KATEGORI_DP }, ...extra });

/**
 * Saldo per DP: nominal − penerapan AKTIF ke pembelian (alur lama) − penerapan AKTIF ke faktur. Map<dpId, { nominal, keFaktur, kePembelian, saldo }> (Decimal).
 * Satu fungsi, dipakai kandidat, ringkasan, daftar, export, dan validasi tulis.
 */
export async function saldoDpMap(db, dpIds) {
  const ids = [...new Set(dpIds)];
  const hasil = new Map();
  if (ids.length === 0) return hasil;
  const dps = await db.finPurchase.findMany({ where: { id: { in: ids } }, select: { id: true, amount: true } });
  const [lama, baru] = await Promise.all([
    db.finPurchaseAdvanceApplication.groupBy({ by: ["advancePurchaseId"], where: { advancePurchaseId: { in: ids }, status: "ACTIVE" }, _sum: { amount: true } }),
    db.finSupplierBillAdvanceApplication.groupBy({ by: ["advancePurchaseId"], where: { advancePurchaseId: { in: ids }, status: "ACTIVE" }, _sum: { amount: true } }),
  ]);
  const mLama = new Map(lama.map((r) => [r.advancePurchaseId, toMoney(r._sum.amount ?? 0)]));
  const mBaru = new Map(baru.map((r) => [r.advancePurchaseId, toMoney(r._sum.amount ?? 0)]));
  for (const dp of dps) {
    const nominal = toMoney(dp.amount);
    const kePembelian = mLama.get(dp.id) ?? ZERO;
    const keFaktur = mBaru.get(dp.id) ?? ZERO;
    hasil.set(dp.id, { nominal, kePembelian, keFaktur, saldo: nominal.minus(kePembelian).minus(keFaktur) });
  }
  return hasil;
}

/** Sisa utang satu faktur (amount − pembayaran aktif − credit_applied) — rumus yang sama dengan seluruh pembaca lain. */
export async function sisaFaktur(db, billId) {
  const b = await db.finSupplierBill.findUnique({
    where: { id: billId },
    select: { amount: true, creditApplied: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
  });
  if (!b) return null;
  const bayar = b.allocations.length === 0 ? ZERO : sumMoney(b.allocations.map((a) => a.amount));
  return toMoney(b.amount).minus(bayar).minus(toMoney(b.creditApplied ?? 0));
}

function bentukDp(p, saldo) {
  const biaya = toMoney(p.transferFeeAmount ?? 0);
  const s = saldo ?? { nominal: toMoney(p.amount), kePembelian: ZERO, keFaktur: ZERO, saldo: toMoney(p.amount) };
  return {
    id: p.id, nomor: p.purchaseNumber, tanggal: p.date, status: p.status,
    supplier: p.supplier ? { id: p.supplier.id, nama: p.supplier.name } : null,
    purchaseOrder: p.purchaseOrder ? { id: p.purchaseOrder.id, nomor: p.purchaseOrder.poNumber, status: p.purchaseOrder.status } : null,
    rekening: p.cashAccount?.name ?? null,
    nominal: uang(p.amount), biayaAdmin: uang(biaya), totalKeluarRekening: uang(toMoney(p.amount).plus(biaya)),
    referensi: p.paymentReference ?? null, catatan: p.notes ?? null, bukti: p.receiptUrl ?? null,
    diterapkanKeFaktur: uang(s.keFaktur), diterapkanKePembelian: uang(s.kePembelian),
    diterapkan: uang(s.keFaktur.plus(s.kePembelian)),
    saldoBelumDiterapkan: p.status === "DIBAYAR" ? uang(s.saldo) : 0,
    melebihiPO: !!p.advanceOverPoReason, alasanMelebihiPO: p.advanceOverPoReason ?? null,
    dibuatOleh: p.createdBy ? { id: p.createdBy.id, nama: p.createdBy.name } : null, dibuatPada: p.createdAt,
  };
}
const dpInclude = {
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  cashAccount: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
};

/** Daftar DP (satu sumber untuk layar & Excel). Filter: supplierId, purchaseOrderId, belumDiterapkan (hanya saldo > 0), status. */
export async function daftarUangMuka(db, { supplierId = null, purchaseOrderId = null, belumDiterapkan = false, status = null, take = 500 } = {}) {
  const rows = await db.finPurchase.findMany({
    where: dpWhere({ ...(supplierId && { supplierId }), ...(purchaseOrderId && { purchaseOrderId }), ...(status && { status }) }),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }], take, include: dpInclude,
  });
  const peta = await saldoDpMap(db, rows.map((r) => r.id));
  let hasil = rows.map((r) => bentukDp(r, peta.get(r.id)));
  if (belumDiterapkan) hasil = hasil.filter((d) => d.status === "DIBAYAR" && d.saldoBelumDiterapkan > 0);
  return hasil;
}

/** Penerapan uang muka ke faktur (aktif + dibatalkan) — untuk panel PO, detail faktur, dan Excel. */
export async function daftarPenerapan(db, { billId = null, purchaseOrderId = null, supplierId = null, take = 500 } = {}) {
  const rows = await db.finSupplierBillAdvanceApplication.findMany({
    where: {
      ...(billId && { billId }),
      ...(purchaseOrderId && { bill: { purchaseOrderId } }),
      ...(supplierId && { bill: { supplierId } }),
    },
    orderBy: { createdAt: "desc" }, take,
    include: {
      advancePurchase: { select: { id: true, purchaseNumber: true, purchaseOrder: { select: { poNumber: true } } } },
      bill: { select: { id: true, billNumber: true, supplierRef: true, supplier: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } } } },
      journal: { select: { entryNumber: true } }, reversalJournal: { select: { entryNumber: true } },
      createdBy: { select: { name: true } }, reversedBy: { select: { name: true } },
    },
  });
  return rows.map((a) => ({
    id: a.id, status: a.status, jumlah: uang(a.amount), tanggal: a.createdAt, catatan: a.note,
    uangMuka: { id: a.advancePurchase.id, nomor: a.advancePurchase.purchaseNumber, po: a.advancePurchase.purchaseOrder?.poNumber ?? null },
    faktur: { id: a.bill.id, nomor: a.bill.billNumber, nomorSupplier: a.bill.supplierRef, po: a.bill.purchaseOrder?.poNumber ?? null },
    supplier: a.bill.supplier.name, jurnal: a.journal.entryNumber, jurnalBalik: a.reversalJournal?.entryNumber ?? null,
    dibuatOleh: a.createdBy?.name ?? null, dibatalkanOleh: a.reversedBy?.name ?? null, dibatalkanPada: a.reversedAt ?? null, alasanBatal: a.reverseReason ?? null,
  }));
}

// ── Ringkasan keuangan PO ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Kelompok "Keuangan" detail PO (hanya Finance). Semua angka dari tabel sumber, tidak ada angka tersimpan di PO.
 *   sisaUtang = utangTercatat − dibayarAtasFaktur  = Σ sisa faktur aktif PO ini (identik dengan Supplier & Utang / aging).
 *   sisaKomitmen = max(0, nilaiPO − uangMukaDibayar − dibayarAtasFaktur); kelebihan (negatif) dilaporkan terpisah — tidak ada refund kas otomatis.
 */
export async function ringkasanKeuanganPO(db, poId) {
  const po = await db.finPurchaseOrder.findUnique({ where: { id: poId }, select: { id: true, status: true, supplierId: true } });
  if (!po) return null;
  const [nilai, dps, faktur] = await Promise.all([
    nilaiPO(db, poId),
    db.finPurchase.findMany({ where: dpWhere({ purchaseOrderId: poId, status: "DIBAYAR" }), orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: dpInclude }),
    db.finSupplierBill.findMany({
      where: { purchaseOrderId: poId, status: { in: STATUS_FAKTUR_AKTIF } },
      select: { id: true, billNumber: true, supplierRef: true, status: true, amount: true, creditApplied: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
    }),
  ]);
  const peta = await saldoDpMap(db, dps.map((d) => d.id));
  const uangMukaDibayar = sumMoney(dps.map((d) => d.amount));
  const sudahDitagih = faktur.length ? sumMoney(faktur.map((f) => f.amount)) : ZERO;
  const kreditTotal = faktur.length ? sumMoney(faktur.map((f) => f.creditApplied ?? 0)) : ZERO;
  const dibayar = faktur.reduce((s, f) => s.plus(f.allocations.length ? sumMoney(f.allocations.map((a) => a.amount)) : ZERO), ZERO);
  const perFaktur = faktur.length
    ? await db.finSupplierBillAdvanceApplication.groupBy({ by: ["billId"], where: { status: "ACTIVE", billId: { in: faktur.map((f) => f.id) } }, _sum: { amount: true } })
    : [];
  const diterapkanPerFaktur = new Map(perFaktur.map((r) => [r.billId, toMoney(r._sum.amount ?? 0)]));
  const diterapkanKeFakturPO = [...diterapkanPerFaktur.values()].reduce((a, b) => a.plus(b), ZERO);
  const belumDiterapkan = dps.reduce((s, d) => s.plus(peta.get(d.id)?.saldo ?? ZERO), ZERO);
  const utangTercatat = sudahDitagih.minus(kreditTotal);
  const sisaUtang = utangTercatat.minus(dibayar);
  const mentah = toMoney(nilai).minus(uangMukaDibayar).minus(dibayar);
  const sisaKomitmen = mentah.isNegative() ? ZERO : mentah;
  const kelebihan = mentah.isNegative() ? mentah.negated() : ZERO;
  const dibatalkanAdaUangMuka = po.status === "DIBATALKAN" && belumDiterapkan.greaterThan(0);
  return {
    nilaiPO: nilai,
    uangMukaDibayar: uang(uangMukaDibayar),
    sudahDitagih: uang(sudahDitagih),
    uangMukaDiterapkan: uang(diterapkanKeFakturPO),
    uangMukaBelumDiterapkan: uang(belumDiterapkan),
    utangTercatat: uang(utangTercatat),
    dibayarAtasFaktur: uang(dibayar),
    sisaUtang: uang(sisaUtang),
    sisaKomitmen: uang(sisaKomitmen),
    kelebihanPembayaran: uang(kelebihan),
    pengurangLain: uang(kreditTotal.minus(diterapkanKeFakturPO)),
    bolehBayarUangMuka: STATUS_PO_BISA_UANG_MUKA.includes(po.status),
    peringatan: dibatalkanAdaUangMuka
      ? { kode: "UANG_MUKA_PERLU_DIKEMBALIKAN_ATAU_DIALIHKAN", pesan: "PO dibatalkan tetapi uang muka belum diterapkan. Uang muka perlu dikembalikan oleh supplier atau dialihkan ke faktur supplier yang sama." }
      : null,
    // Per faktur aktif (untuk kartu faktur di detail PO): uang muka diterapkan, pengurang lain (Debit Note), dibayar kas, sisa utang — rumus sisa sama dengan seluruh pembaca lain.
    faktur: faktur.map((fk) => {
      const dibayarFk = fk.allocations.length ? sumMoney(fk.allocations.map((a) => a.amount)) : ZERO;
      const dp = diterapkanPerFaktur.get(fk.id) ?? ZERO;
      const kredit = toMoney(fk.creditApplied ?? 0);
      return { id: fk.id, nomor: fk.billNumber, nomorSupplier: fk.supplierRef, status: fk.status, nilai: uang(fk.amount), uangMukaDiterapkan: uang(dp), pengurangLain: uang(kredit.minus(dp)), dibayar: uang(dibayarFk), sisa: uang(toMoney(fk.amount).minus(dibayarFk).minus(kredit)) };
    }),
    uangMuka: dps.map((d) => bentukDp(d, peta.get(d.id))),
    penerapan: await daftarPenerapan(db, { purchaseOrderId: poId }),
    definisi: DEFINISI_KEUANGAN_PO,
  };
}

// ── Bayar uang muka dari PO ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Bayar Uang Muka" pada PO disetujui — SATU langkah: membuat DP (FinPurchase LANGSUNG, DIBAYAR) + jurnal Dr 1-1500 / Cr Kas-Bank (+ biaya admin). Tidak menyentuh stok, GRNI, persediaan, utang.
 * Wajib: jumlah, tanggal, rekening, bukti (foto nota/transfer lewat media bukti yang sudah ada). Idempotensi dijaga middleware Idempotency-Key + baris PO dikunci (dua pembayaran paralel diserialkan).
 * Melebihi nilai PO: hanya Admin Finance, dengan alasan + konfirmasi eksplisit; kelebihannya menjadi Kredit Supplier (tidak ada refund kas otomatis).
 */
export async function bayarUangMukaPO(tx, { poId, body, userId, bolehAdmin = false }) {
  const b = body ?? {};
  await lockRowForUpdate(tx, "fin_purchase_orders", poId);
  const po = await tx.finPurchaseOrder.findUnique({ where: { id: poId }, select: { id: true, poNumber: true, status: true, supplierId: true, supplier: { select: { id: true, name: true, active: true } } } });
  if (!po) throw gagal("PO tidak ditemukan", 404);
  if (!STATUS_PO_BISA_UANG_MUKA.includes(po.status)) {
    throw gagal(po.status === "DRAFT" ? "PO masih draf — setujui PO dulu sebelum membayar uang muka" : po.status === "DIBATALKAN" ? "PO sudah dibatalkan — uang muka tidak bisa dibayar" : `PO berstatus ${po.status} — uang muka tidak bisa dibayar`, 409, "PO_TIDAK_BISA_UANG_MUKA");
  }

  let nominal;
  try { nominal = toMoney(b.amount, { field: "Nominal uang muka" }); } catch { throw gagal("Nominal uang muka bukan angka yang sah"); }
  if (nominal.lessThanOrEqualTo(0)) throw gagal("Nominal uang muka harus lebih dari 0");
  if (!b.cashAccountId) throw gagal("Rekening sumber pembayaran wajib dipilih");
  if (!b.date) throw gagal("Tanggal pembayaran wajib diisi");
  const tanggal = toBookDate(b.date);
  const bukti = String(b.receiptUrl ?? "").trim();
  if (!bukti) throw gagal("Bukti transfer wajib diunggah sebelum uang muka dicatat", 422, "BUKTI_WAJIB");
  if (!bukti.startsWith(`${RECEIPTS_URL_PREFIX}/`)) throw gagal("Bukti tidak valid — unggah ulang lewat tombol unggah bukti");
  const referensi = b.reference == null ? null : String(b.reference).trim().slice(0, 120) || null;
  const catatan = b.notes == null ? null : String(b.notes).trim().slice(0, 500) || null;

  const rek = await tx.finCashAccount.findUnique({ where: { id: b.cashAccountId }, select: { id: true, name: true, active: true } });
  if (!rek) throw gagal("Rekening kas/bank tidak ditemukan", 404);
  if (rek.active === false) throw gagal(`Rekening ${rek.name} tidak aktif`, 409);
  const biaya = await hitungBiayaTransfer(tx, { cashAccountId: b.cashAccountId, paymentMethod: b.paymentMethod, transferFeeType: b.transferFeeType, transferFeeAmount: b.transferFeeAmount });

  const [nilai, sudah] = await Promise.all([
    nilaiPO(tx, poId),
    tx.finPurchase.aggregate({ where: dpWhere({ purchaseOrderId: poId, status: "DIBAYAR" }), _sum: { amount: true } }),
  ]);
  const sudahDibayar = toMoney(sudah._sum.amount ?? 0);
  const sesudah = sudahDibayar.plus(nominal);
  let alasanMelebihi = null;
  if (sesudah.greaterThan(nilai)) {
    const info = { nilaiPO: nilai, uangMukaSudahDibayar: uang(sudahDibayar), nominalBaru: uang(nominal), kelebihan: uang(sesudah.minus(nilai)) };
    if (!bolehAdmin) throw gagal(`Total uang muka (${sesudah.toFixed(2)}) melebihi nilai PO (${nilai.toFixed(2)}). Hanya Admin Finance yang boleh melebihi nilai PO, dengan alasan tertulis.`, 403, "UANG_MUKA_MELEBIHI_PO", info);
    alasanMelebihi = String(b.alasanMelebihi ?? "").trim();
    if (b.konfirmasiMelebihi !== true || alasanMelebihi.length < 5) {
      throw gagal(`Total uang muka (${sesudah.toFixed(2)}) melebihi nilai PO (${nilai.toFixed(2)}). Isi alasan (minimal 5 karakter) dan konfirmasi eksplisit untuk melanjutkan; kelebihan menjadi Kredit Supplier (tanpa refund kas otomatis).`, 409, "UANG_MUKA_MELEBIHI_PO", info);
    }
  }

  const kategori = await tx.finPurchaseCategory.findFirst({ where: { code: KODE_KATEGORI_DP }, select: { id: true } });
  if (!kategori) throw gagal("Kategori Uang Muka Pembelian belum ada di pengaturan — hubungi Admin", 409, "KATEGORI_DP_TIDAK_ADA");

  const dp = await tx.finPurchase.create({
    data: {
      purchaseNumber: await generateDocumentNumber(tx, "PUR", tanggal),
      date: tanggal, amount: nominal,
      description: `Uang muka ${po.poNumber} — ${po.supplier.name}${referensi ? ` [Ref ${referensi}]` : ""}`,
      categoryId: kategori.id, division: "UMUM", mode: "LANGSUNG",
      cashAccountId: rek.id, supplierId: po.supplierId, purchaseOrderId: po.id,
      receiptUrl: bukti, notes: catatan, paymentReference: referensi, advanceOverPoReason: alasanMelebihi,
      paymentMethod: biaya.paymentMethod, transferFeeType: biaya.transferFeeType, transferFeeAmount: biaya.transferFeeAmount,
      status: "DIBAYAR", submittedAt: new Date(), approvedAt: new Date(), approvedById: userId, paidAt: new Date(), paidById: userId, createdById: userId,
    },
  });
  await postPurchaseApproved(tx, { purchaseId: dp.id, userId });

  const total = toMoney(nominal).plus(biaya.transferFeeAmount);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: dp.id, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: {
      aksi: "bayar_uang_muka_po", purchaseNumber: dp.purchaseNumber, poNumber: po.poNumber, amount: nominal.toFixed(2), biayaAdmin: toMoney(biaya.transferFeeAmount).toFixed(2), totalKeluarRekening: total.toFixed(2),
      uangMukaSebelumnya: sudahDibayar.toFixed(2), uangMukaSesudahnya: sesudah.toFixed(2), nilaiPO: String(nilai), ...(alasanMelebihi && { melebihiPO: true, alasanMelebihi }),
    },
  });
  await tx.finPurchaseOrderEvent.create({
    data: {
      purchaseOrderId: po.id, type: "UANG_MUKA_DIBAYAR", actorId: userId, note: referensi ? `Ref ${referensi}` : null,
      metadata: { dokumen: dp.purchaseNumber, jumlah: nominal.toFixed(2), biayaAdmin: toMoney(biaya.transferFeeAmount).toFixed(2), rekening: rek.name, sebelum: sudahDibayar.toFixed(2), sesudah: sesudah.toFixed(2), ...(alasanMelebihi && { melebihiPO: true }) },
    },
  });
  return { dp: dp.id, nomor: dp.purchaseNumber };
}

// ── Terapkan ke faktur ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Kandidat DP untuk satu faktur (picker UI) + sisa faktur — saran penerapan = min(saldo DP, sisa faktur), diprioritaskan DP milik PO yang sama. */
export async function kandidatUntukFaktur(db, billId) {
  const bill = await db.finSupplierBill.findUnique({ where: { id: billId }, select: { id: true, billNumber: true, status: true, supplierId: true, purchaseOrderId: true, amount: true, supplier: { select: { name: true } }, purchaseOrder: { select: { poNumber: true } } } });
  if (!bill) throw gagal("Faktur tidak ditemukan", 404);
  const sisa = (await sisaFaktur(db, billId)) ?? ZERO;
  const dps = await db.finPurchase.findMany({ where: dpWhere({ supplierId: bill.supplierId, status: "DIBAYAR" }), orderBy: [{ date: "asc" }, { createdAt: "asc" }], include: dpInclude });
  const peta = await saldoDpMap(db, dps.map((d) => d.id));
  const daftar = dps.map((d) => bentukDp(d, peta.get(d.id))).filter((d) => d.saldoBelumDiterapkan > 0)
    .map((d) => ({ ...d, samaPO: !!bill.purchaseOrderId && d.purchaseOrder?.id === bill.purchaseOrderId, bedaPO: !!bill.purchaseOrderId && !!d.purchaseOrder && d.purchaseOrder.id !== bill.purchaseOrderId }))
    .sort((a, b) => Number(b.samaPO) - Number(a.samaPO));
  return {
    faktur: { id: bill.id, nomor: bill.billNumber, status: bill.status, supplier: bill.supplier.name, po: bill.purchaseOrder?.poNumber ?? null, nilai: uang(bill.amount), sisaUtang: uang(sisa), bolehDiterapkan: STATUS_FAKTUR_BISA_DITERAPKAN.includes(bill.status) },
    uangMuka: daftar.map((d) => ({ ...d, saran: Math.min(d.saldoBelumDiterapkan, uang(sisa.isNegative() ? ZERO : sisa)) })),
  };
}

/**
 * Terapkan uang muka ke faktur (dikonfirmasi Finance). Aturan: DP DIBAYAR & supplier sama; faktur DISETUJUI/DIBAYAR_SEBAGIAN; jumlah ≤ saldo DP dan ≤ sisa faktur; baris DP & faktur dikunci;
 * Idempotency-Key unik (replay = baris yang sama, tanpa jurnal kedua; isi beda = 422). Jurnal Dr Utang Usaha / Cr Uang Muka; credit_applied faktur bertambah sebesar yang sama.
 */
export async function terapkanKeFaktur(tx, { advanceId, billId, amount, idempotencyKey, konfirmasi, konfirmasiBedaPO = false, sisaFakturDilihat, catatan = null, userId }) {
  if (!idempotencyKey) throw gagal("Header Idempotency-Key wajib", 428);
  if (konfirmasi !== true) throw gagal("Penerapan uang muka harus dikonfirmasi Finance (konfirmasi: true) setelah memeriksa pratinjau.", 409, "PENERAPAN_PERLU_KONFIRMASI");
  if (!advanceId) throw gagal("Uang muka sumber wajib dipilih");
  if (!billId) throw gagal("Faktur tujuan wajib dipilih");
  let nominal;
  try { nominal = toMoney(amount, { field: "Nominal penerapan" }); } catch { throw gagal("Nominal penerapan bukan angka yang sah"); }
  if (nominal.lessThanOrEqualTo(0)) throw gagal("Nominal penerapan harus lebih dari 0");

  await lockRowForUpdate(tx, '"fin_purchases"', advanceId);
  await lockRowForUpdate(tx, '"fin_supplier_bills"', billId);

  // Replay: kunci yang sama setelah kunci baris (paralel yang kalah melihat baris pemenang).
  const ada = await tx.finSupplierBillAdvanceApplication.findUnique({ where: { idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.advancePurchaseId !== advanceId || ada.billId !== billId || !toMoney(ada.amount).equals(nominal)) {
      throw gagal("Idempotency-Key ini sudah dipakai untuk penerapan lain (isi berbeda)", 422, "IDEMPOTENCY_BEDA_ISI");
    }
    return { application: ada, replay: true };
  }

  const [dp, bill] = await Promise.all([
    tx.finPurchase.findUnique({ where: { id: advanceId }, include: { category: { select: { code: true } }, purchaseOrder: { select: { poNumber: true } } } }),
    tx.finSupplierBill.findUnique({ where: { id: billId }, include: { purchaseOrder: { select: { poNumber: true } } } }),
  ]);
  if (!dp) throw gagal("Uang muka tidak ditemukan", 404);
  if (!bill) throw gagal("Faktur tidak ditemukan", 404);
  if (dp.category.code !== KODE_KATEGORI_DP) throw gagal(`${dp.purchaseNumber} bukan pembelian berkategori Uang Muka Pembelian`, 400);
  if (dp.status !== "DIBAYAR") throw gagal(`Uang muka ${dp.purchaseNumber} berstatus ${dp.status} — hanya uang muka yang sudah Dibayar yang bisa diterapkan`, 409);
  if (!STATUS_FAKTUR_BISA_DITERAPKAN.includes(bill.status)) throw gagal(`Faktur ${bill.billNumber} berstatus ${bill.status} — uang muka hanya bisa diterapkan ke faktur yang sudah disetujui dan belum lunas`, 409, "FAKTUR_TIDAK_BISA_DITERAPKAN");
  if (!dp.supplierId || dp.supplierId !== bill.supplierId) throw gagal("Uang muka dan faktur harus dari supplier yang sama", 400);
  if (dp.purchaseOrderId && bill.purchaseOrderId && dp.purchaseOrderId !== bill.purchaseOrderId && konfirmasiBedaPO !== true) {
    throw gagal(`Uang muka ${dp.purchaseNumber} dibayar untuk ${dp.purchaseOrder?.poNumber ?? "PO lain"}, sedangkan faktur ${bill.billNumber} atas ${bill.purchaseOrder?.poNumber ?? "PO lain"}. Konfirmasi bila memang dialihkan.`, 409, "UANG_MUKA_BEDA_PO");
  }

  const saldoAwal = (await saldoDpMap(tx, [advanceId])).get(advanceId);
  const sisaAwal = await sisaFaktur(tx, billId);
  if (sisaFakturDilihat !== undefined && sisaFakturDilihat !== null && !toMoney(sisaFakturDilihat).equals(sisaAwal)) {
    throw gagal(`Sisa faktur berubah sejak Anda melihatnya (sekarang ${sisaAwal.toFixed(2)}). Muat ulang lalu ulangi.`, 409, "SISA_FAKTUR_BERUBAH");
  }
  if (nominal.greaterThan(saldoAwal.saldo)) throw gagal(`Nominal (${nominal.toFixed(2)}) melebihi saldo uang muka yang belum diterapkan (${saldoAwal.saldo.toFixed(2)})`, 400, "MELEBIHI_SALDO_UANG_MUKA");
  if (nominal.greaterThan(sisaAwal)) throw gagal(`Nominal (${nominal.toFixed(2)}) melebihi sisa faktur (${sisaAwal.toFixed(2)})`, 400, "MELEBIHI_SISA_FAKTUR");

  const applicationId = randomUUID();
  const { entry } = await postUangMukaDiterapkanKeFaktur(tx, { idemKey: String(idempotencyKey), sourceId: applicationId, advance: dp, bill, amount: nominal, userId });
  const application = await tx.finSupplierBillAdvanceApplication.create({
    data: { id: applicationId, advancePurchaseId: advanceId, billId, amount: nominal, journalId: entry.id, idempotencyKey: String(idempotencyKey), note: catatan ? String(catatan).trim().slice(0, 300) : null, status: "ACTIVE", createdById: userId },
  });
  await tx.finSupplierBill.update({ where: { id: billId }, data: { creditApplied: { increment: nominal } } });
  const status = await recomputeBillStatus(tx, billId);

  const meta = {
    aksi: "terapkan_uang_muka", uangMuka: dp.purchaseNumber, faktur: bill.billNumber, jumlah: nominal.toFixed(2),
    sisaFakturSebelum: sisaAwal.toFixed(2), sisaFakturSesudah: sisaAwal.minus(nominal).toFixed(2),
    saldoUangMukaSebelum: saldoAwal.saldo.toFixed(2), saldoUangMukaSesudah: saldoAwal.saldo.minus(nominal).toFixed(2), statusFaktur: status?.status ?? bill.status, applicationId,
    ...(dp.purchaseOrderId && bill.purchaseOrderId && dp.purchaseOrderId !== bill.purchaseOrderId && { bedaPO: true }),
  };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: billId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: advanceId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: meta });
  for (const poId of new Set([dp.purchaseOrderId, bill.purchaseOrderId].filter(Boolean))) {
    await tx.finPurchaseOrderEvent.create({ data: { purchaseOrderId: poId, type: "UANG_MUKA_DITERAPKAN", actorId: userId, note: catatan ?? null, metadata: { uangMuka: dp.purchaseNumber, faktur: bill.billNumber, jumlah: nominal.toFixed(2), sisaFakturSebelum: meta.sisaFakturSebelum, sisaFakturSesudah: meta.sisaFakturSesudah } } });
  }
  return { application, replay: false };
}

/** Batalkan penerapan (reversal jurnal; baris tidak dihapus). Ditolak bila faktur sudah LUNAS atau jurnal sudah dicocokkan dengan mutasi bank. */
export async function batalkanPenerapan(tx, { applicationId, reason, userId }) {
  const alasan = String(reason ?? "").trim();
  if (alasan.length < 5) throw gagal("Alasan pembatalan wajib diisi (minimal 5 karakter)");
  await lockRowForUpdate(tx, '"fin_supplier_bill_advance_applications"', applicationId);
  const a0 = await tx.finSupplierBillAdvanceApplication.findUnique({ where: { id: applicationId }, select: { advancePurchaseId: true, billId: true } });
  if (!a0) throw gagal("Penerapan uang muka tidak ditemukan", 404);
  await lockRowForUpdate(tx, '"fin_purchases"', a0.advancePurchaseId);
  await lockRowForUpdate(tx, '"fin_supplier_bills"', a0.billId);
  const a = await tx.finSupplierBillAdvanceApplication.findUnique({ where: { id: applicationId }, include: { advancePurchase: { select: { purchaseNumber: true, purchaseOrderId: true } }, bill: { select: { billNumber: true, status: true, purchaseOrderId: true } } } });
  if (a.status === "REVERSED") throw gagal("Penerapan ini sudah dibatalkan sebelumnya", 409);
  if (a.bill.status === "LUNAS") throw gagal(`Faktur ${a.bill.billNumber} sudah lunas — batalkan/koreksi pelunasannya dulu sebelum membatalkan penerapan uang muka ini`, 409, "FAKTUR_SUDAH_LUNAS");
  await pastikanBelumDirekonsiliasi(tx, [{ source: "TERAPKAN_UANG_MUKA", sourceId: a.id }]);
  const sisaSebelum = await sisaFaktur(tx, a.billId);
  const balik = await reverseJournal(tx, { entryId: a.journalId, reason: `Penerapan uang muka ${a.advancePurchase.purchaseNumber} → ${a.bill.billNumber} dibatalkan — ${alasan}`, userId });
  await tx.finSupplierBillAdvanceApplication.update({ where: { id: a.id }, data: { status: "REVERSED", reversalJournalId: balik.id, reversedById: userId, reversedAt: new Date(), reverseReason: alasan } });
  await tx.finSupplierBill.update({ where: { id: a.billId }, data: { creditApplied: { decrement: a.amount } } });
  const status = await recomputeBillStatus(tx, a.billId);
  const meta = { aksi: "batalkan_penerapan_uang_muka", uangMuka: a.advancePurchase.purchaseNumber, faktur: a.bill.billNumber, jumlah: toMoney(a.amount).toFixed(2), reason: alasan, sisaFakturSebelum: sisaSebelum.toFixed(2), sisaFakturSesudah: sisaSebelum.plus(a.amount).toFixed(2), statusFaktur: status?.status ?? a.bill.status };
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_SUPPLIER_BILL, entityId: a.billId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: meta });
  await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_PURCHASE, entityId: a.advancePurchaseId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: meta });
  for (const poId of new Set([a.advancePurchase.purchaseOrderId, a.bill.purchaseOrderId].filter(Boolean))) {
    await tx.finPurchaseOrderEvent.create({ data: { purchaseOrderId: poId, type: "UANG_MUKA_PENERAPAN_DIBATALKAN", actorId: userId, note: alasan, metadata: { uangMuka: a.advancePurchase.purchaseNumber, faktur: a.bill.billNumber, jumlah: toMoney(a.amount).toFixed(2) } } });
  }
  return { id: a.id };
}

/** Jumlah penerapan AKTIF pada satu DP (alur lama + faktur) — dipakai guard batal/koreksi DP agar tidak meninggalkan penerapan yatim. */
export async function jumlahPenerapanAktifDp(db, dpId) {
  const [lama, baru] = await Promise.all([
    db.finPurchaseAdvanceApplication.count({ where: { status: "ACTIVE", advancePurchaseId: dpId } }),
    db.finSupplierBillAdvanceApplication.count({ where: { status: "ACTIVE", advancePurchaseId: dpId } }),
  ]);
  return lama + baru;
}

// ── Ringkasan per supplier (Supplier & Utang) ───────────────────────────────────────────────────────────────────────────

/**
 * Per supplier: total uang muka (DIBAYAR), uang muka terpakai, uang muka belum diterapkan, utang aktif (hanya faktur disetujui/dibayar sebagian), saldo bersih = utang aktif − uang muka belum diterapkan.
 * `kartu.uangMukaBelumDiterapkan` = Σ semua supplier (kartu baru di layar). Aging tetap hanya dari faktur — uang muka tidak masuk aging.
 */
export async function ringkasUangMukaSupplier(db, { supplierId = null } = {}) {
  const dps = await db.finPurchase.findMany({ where: dpWhere({ status: "DIBAYAR", supplierId: supplierId ?? { not: null } }), select: { id: true, supplierId: true, amount: true } });
  const peta = await saldoDpMap(db, dps.map((d) => d.id));
  const baris = new Map();
  const ambil = (id) => { if (!baris.has(id)) baris.set(id, { supplierId: id, totalUangMuka: ZERO, uangMukaTerpakai: ZERO, uangMukaBelumDiterapkan: ZERO, utangAktif: ZERO }); return baris.get(id); };
  for (const d of dps) {
    const s = peta.get(d.id); const r = ambil(d.supplierId);
    r.totalUangMuka = r.totalUangMuka.plus(s.nominal);
    r.uangMukaTerpakai = r.uangMukaTerpakai.plus(s.kePembelian).plus(s.keFaktur);
    r.uangMukaBelumDiterapkan = r.uangMukaBelumDiterapkan.plus(s.saldo);
  }
  const bills = await db.finSupplierBill.findMany({
    where: { status: { in: STATUS_FAKTUR_BISA_DITERAPKAN }, ...(supplierId && { supplierId }) },
    select: { supplierId: true, amount: true, creditApplied: true, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } },
  });
  for (const b of bills) {
    const bayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
    const r = ambil(b.supplierId);
    r.utangAktif = r.utangAktif.plus(toMoney(b.amount).minus(bayar).minus(toMoney(b.creditApplied ?? 0)));
  }
  const suppliers = await db.finSupplier.findMany({ where: { id: { in: [...baris.keys()] } }, select: { id: true, name: true, code: true } });
  const nama = new Map(suppliers.map((s) => [s.id, s]));
  const daftar = [...baris.values()].map((r) => ({
    supplierId: r.supplierId, supplier: nama.get(r.supplierId)?.name ?? "—", kode: nama.get(r.supplierId)?.code ?? null,
    totalUangMuka: uang(r.totalUangMuka), uangMukaTerpakai: uang(r.uangMukaTerpakai), uangMukaBelumDiterapkan: uang(r.uangMukaBelumDiterapkan), utangAktif: uang(r.utangAktif),
    saldoBersih: uang(r.utangAktif.minus(r.uangMukaBelumDiterapkan)),
  })).filter((r) => r.totalUangMuka > 0 || r.utangAktif > 0).sort((a, b) => b.uangMukaBelumDiterapkan - a.uangMukaBelumDiterapkan || a.supplier.localeCompare(b.supplier));
  const jumlah = (f) => rp(daftar.reduce((s, r) => s + r[f], 0));
  return {
    suppliers: daftar,
    kartu: { totalUangMuka: jumlah("totalUangMuka"), uangMukaTerpakai: jumlah("uangMukaTerpakai"), uangMukaBelumDiterapkan: jumlah("uangMukaBelumDiterapkan"), utangAktif: jumlah("utangAktif"), saldoBersih: jumlah("saldoBersih") },
    definisi: [
      { kunci: "uangMukaBelumDiterapkan", label: "Uang Muka Supplier Belum Diterapkan", definisi: "Saldo uang muka yang sudah dibayar ke supplier tetapi belum mengurangi faktur mana pun. Aset (bukan utang, bukan stok)." },
      { kunci: "utangAktif", label: "Utang Aktif", definisi: "Sisa utang faktur yang sudah DISETUJUI (setelah uang muka diterapkan dan pembayaran). Sisa PO yang belum ditagih bukan utang." },
      { kunci: "saldoBersih", label: "Saldo bersih", definisi: "Utang aktif dikurangi uang muka belum diterapkan. Negatif = supplier masih berutang barang/kredit kepada kita." },
    ],
  };
}

