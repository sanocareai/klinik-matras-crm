// POSTING SISI SUPPLIER — tagihan masuk (utang) & pembayarannya, plus
// NILAI PERSEDIAAN dari penerimaan barang yang SUDAH tercatat gudang.
//
// ════════════════════════════════════════════════════════════════════════
// ATURAN PALING PENTING DI FILE INI: TIDAK MENGGANDAKAN PERGERAKAN STOK.
// ════════════════════════════════════════════════════════════════════════
// Kuantitas barang adalah milik stock_movements (services/inventoryLedger.js)
// dan TIDAK ADA satu baris pun di file ini yang menulis ke sana. Yang
// dikerjakan di sini murni sisi RUPIAH-nya.
//
// ── ALUR TIGA LANGKAH (pola standar GR/IR) ──────────────────────────────
//
// 1. BARANG MASUK (gudang menekan "Putaway" — stock_movements RECEIPT sudah
//    tertulis, lengkap dengan unitCost per baris):
//        Dr  Persediaan Bahan Baku          nilai terima
//            Cr  Utang Barang Belum Ditagih     nilai terima
//
// 2. TAGIHAN SUPPLIER DATANG & DISETUJUI:
//        Dr  Utang Barang Belum Ditagih     nilai terima
//        Dr/Cr Selisih Harga Pembelian      selisih (kalau ada)
//            Cr  Utang Usaha                    nilai tagihan
//
//    Selisih antara yang ditagih supplier dan nilai penerimaan (ongkos
//    kirim, pembulatan, koreksi harga) masuk akun selisih — nilai
//    persediaan yang SUDAH tercatat TIDAK diubah surut. Mengubahnya berarti
//    nilai per satuan di buku berbeda dari unitCost di ledger stok, dan dua
//    angka yang seharusnya sama jadi mustahil direkonsiliasi.
//
// 3. TAGIHAN DIBAYAR:
//        Dr  Utang Usaha                    nilai bayar
//            Cr  Kas/Bank                       nilai bayar
//
// Tagihan TANPA tautan goods receipt (jasa, sewa, maklon) melewati langkah 1
// sama sekali: langkah 2 mendebet akun beban dari kategori biaya yang
// dipilih, bukan Utang Barang Belum Ditagih.

import { postJournal, recordPostingGap, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { toMoney, sumMoney, ZERO } from "../money.js";

export const KEY = {
  goodsReceipt: (id) => `PENERIMAAN_BAHAN:${id}`,
  bill: (id) => `TAGIHAN_SUPPLIER:${id}`,
  supplierPayment: (id) => `PEMBAYARAN_SUPPLIER:${id}`,
};

/**
 * Nilai rupiah sebuah goods receipt MENURUT LEDGER STOK — Σ(qty × unitCost)
 * dari baris RECEIPT yang dokumen sumbernya adalah goods receipt ini.
 *
 * Mengembalikan juga daftar baris yang TIDAK punya unitCost. Itu bukan
 * detail teknis: material tanpa harga perolehan berarti nilai persediaan
 * yang kita bukukan lebih kecil dari barang yang benar-benar ada di rak,
 * dan itu harus terlihat sebagai pekerjaan (FinPostingGap), bukan
 * ditambal dengan harga tebakan.
 */
export async function nilaiPenerimaan(tx, goodsReceiptId) {
  const movements = await tx.stockMovement.findMany({
    where: { goodsReceiptId, type: "RECEIPT" },
    select: {
      id: true, qty: true, unitCost: true,
      material: { select: { id: true, code: true, name: true } },
    },
  });

  const berharga = movements.filter((m) => m.unitCost != null && m.unitCost > 0);
  const tanpaHarga = movements.filter((m) => m.unitCost == null || m.unitCost <= 0);

  const total = berharga.length === 0
    ? ZERO
    : sumMoney(berharga.map((m) => toMoney(m.qty).times(toMoney(m.unitCost))));

  return { total, jumlahBaris: movements.length, tanpaHarga };
}

/**
 * Bukukan NILAI penerimaan barang. Dipanggil dari alur putaway gudang
 * SETELAH stock_movements-nya tertulis — urutan itu penting, karena fungsi
 * ini membaca ledger yang baru saja ditulis.
 */
export async function postGoodsReceiptValue(tx, { goodsReceiptId, userId = null }) {
  const gr = await tx.goodsReceipt.findUnique({
    where: { id: goodsReceiptId },
    select: { id: true, receiptNumber: true, supplier: true, receivedDate: true, createdAt: true },
  });
  if (!gr) throw new Error(`Goods receipt ${goodsReceiptId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.goodsReceipt(goodsReceiptId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const { total, jumlahBaris, tanpaHarga } = await nilaiPenerimaan(tx, goodsReceiptId);

  if (tanpaHarga.length > 0) {
    await recordPostingGap(tx, {
      source: "PENERIMAAN_BAHAN",
      sourceId: goodsReceiptId,
      reason: "TANPA_HARGA_PEROLEHAN",
      detail:
        `Penerimaan ${gr.receiptNumber}: ${tanpaHarga.length} dari ${jumlahBaris} baris tidak punya harga satuan, ` +
        "jadi nilainya belum ikut dibukukan ke Persediaan. Isi harga satuan di dokumen penerimaan lalu posting ulang. " +
        `Material: ${tanpaHarga.map((m) => m.material?.code || "-").join(", ")}`,
      metadata: {
        goodsReceiptId,
        materialTanpaHarga: tanpaHarga.map((m) => ({ code: m.material?.code, name: m.material?.name, qty: String(m.qty) })),
      },
    });
  }

  if (total.lessThanOrEqualTo(0)) {
    return { posted: false, gap: true, reason: "nilai_nol" };
  }

  try {
    const persediaan = await resolveAccount(tx, SYSTEM_KEYS.PERSEDIAAN_BAHAN);
    const grir = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);

    const { entry, created } = await postJournal(tx, {
      date: gr.receivedDate || gr.createdAt,
      description: `Penerimaan barang ${gr.receiptNumber}${gr.supplier ? ` — ${gr.supplier}` : ""}`,
      source: "PENERIMAAN_BAHAN",
      sourceId: goodsReceiptId,
      idempotencyKey: KEY.goodsReceipt(goodsReceiptId),
      userId,
      lines: [
        { accountId: persediaan.id, debit: total, description: `Nilai barang masuk (${jumlahBaris} baris)` },
        { accountId: grir.id, credit: total, description: `Belum ditagih — ${gr.supplier || "supplier"}` },
      ],
    });
    return { posted: true, entry, created };
  } catch (err) {
    if (!(err instanceof AccountError)) throw err;
    await recordPostingGap(tx, {
      source: "PENERIMAAN_BAHAN",
      sourceId: goodsReceiptId,
      reason: "AKUN_SISTEM_BELUM_SIAP",
      detail: `Nilai penerimaan ${gr.receiptNumber} belum dibukukan: ${err.message}`,
      metadata: { goodsReceiptId, total: total.toFixed(2) },
    });
    return { posted: false, gap: true };
  }
}

/**
 * Bukukan tagihan supplier yang DISETUJUI → Utang Usaha lahir.
 * Idempoten per tagihan.
 */
export async function postSupplierBill(tx, { billId, userId = null }) {
  const bill = await tx.finSupplierBill.findUnique({
    where: { id: billId },
    include: {
      supplier: { select: { id: true, name: true } },
      goodsReceipt: { select: { id: true, receiptNumber: true } },
    },
  });
  if (!bill) throw new Error(`Tagihan ${billId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.bill(billId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const nilaiTagihan = toMoney(bill.amount);
  const utangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
  const lines = [];

  if (bill.goodsReceiptId) {
    // Tagihan atas barang yang penerimaannya SUDAH tercatat di ledger stok.
    const grir = await resolveAccount(tx, SYSTEM_KEYS.UTANG_BELUM_DITAGIH);
    const { total: nilaiTerima, jumlahBaris, tanpaHarga } = await nilaiPenerimaan(tx, bill.goodsReceiptId);

    // ⚠️ Kalau penerimaannya BELUM PUNYA NILAI SAMA SEKALI (material belum
    // punya harga perolehan, atau memang belum ada baris RECEIPT untuk
    // goodsReceiptId ini), JANGAN lanjut memposting. `nilaiTerima` akan
    // bernilai 0, dan tanpa pengaman ini seluruh nominal tagihan akan
    // "kebetulan" masuk ke Selisih Harga Pembelian di bawah (selisih =
    // tagihan - 0 = tagihan penuh) — bukan salah HITUNG, tapi salah
    // KLASIFIKASI: nilai persediaan yang sesungguhnya diam-diam berubah
    // jadi beban varian harga, understating Persediaan & overstating beban.
    // Berhenti di sini dan minta Gudang melengkapi harga dulu — sama
    // prinsipnya dengan postGoodsReceiptValue yang juga menolak mengarang
    // nilai untuk baris tanpa harga.
    if (tanpaHarga.length > 0 || jumlahBaris === 0) {
      throw new AccountError(
        `Penerimaan ${bill.goodsReceipt?.receiptNumber || bill.goodsReceiptId} yang ditagih ${bill.billNumber} ` +
        (jumlahBaris === 0
          ? "belum punya satu pun baris penerimaan di ledger stok."
          : `punya ${tanpaHarga.length} dari ${jumlahBaris} baris tanpa harga satuan.`) +
        " Lengkapi harga di Gudang lalu posting ulang Penerimaan Barang (Finance > Data Belum Lengkap) " +
        "sebelum tagihan ini bisa disetujui — supaya nilai persediaan tidak salah tercatat sebagai beban.",
        409
      );
    }

    if (nilaiTerima.greaterThan(0)) {
      lines.push({
        accountId: grir.id,
        debit: nilaiTerima,
        description: `Penutup penerimaan ${bill.goodsReceipt?.receiptNumber || ""}`.trim(),
        supplierId: bill.supplierId,
      });
    }

    const selisih = nilaiTagihan.minus(nilaiTerima);
    if (!selisih.isZero()) {
      const akunSelisih = await resolveAccount(tx, SYSTEM_KEYS.SELISIH_HARGA_PEMBELIAN);
      lines.push({
        accountId: akunSelisih.id,
        // Tagihan LEBIH BESAR dari nilai terima → beban tambahan (debit).
        // LEBIH KECIL → keuntungan pembelian (kredit).
        ...(selisih.greaterThan(0) ? { debit: selisih } : { credit: selisih.negated() }),
        description: "Selisih tagihan supplier vs nilai penerimaan gudang",
        supplierId: bill.supplierId,
      });
    }
  } else {
    // Tagihan jasa/sewa/maklon — langsung ke akun beban kategorinya.
    if (!bill.expenseCategoryId) {
      throw new AccountError(
        "Tagihan tanpa tautan penerimaan barang wajib memilih kategori biaya, supaya tahu akun beban tujuannya",
        400
      );
    }
    const kat = await tx.finExpenseCategory.findUnique({
      where: { id: bill.expenseCategoryId },
      select: { id: true, name: true, accountId: true, active: true },
    });
    if (!kat || !kat.active) {
      throw new AccountError("Kategori biaya tagihan ini tidak ditemukan atau sudah nonaktif", 409);
    }
    lines.push({
      accountId: kat.accountId,
      debit: nilaiTagihan,
      description: kat.name,
      supplierId: bill.supplierId,
    });
  }

  lines.push({
    accountId: utangUsaha.id,
    credit: nilaiTagihan,
    description: `Utang ke ${bill.supplier.name}${bill.supplierRef ? ` (${bill.supplierRef})` : ""}`,
    supplierId: bill.supplierId,
  });

  const { entry, created } = await postJournal(tx, {
    date: bill.billDate,
    description: `${bill.billNumber} — ${bill.supplier.name}: ${bill.description}`,
    source: "TAGIHAN_SUPPLIER",
    sourceId: billId,
    idempotencyKey: KEY.bill(billId),
    userId,
    lines,
  });
  return { posted: true, entry, created };
}

/** Bukukan pembayaran ke supplier → Utang Usaha berkurang, kas keluar. */
export async function postSupplierPayment(tx, { paymentId, userId = null }) {
  const p = await tx.finSupplierPayment.findUnique({
    where: { id: paymentId },
    include: {
      supplier: { select: { id: true, name: true } },
      cashAccount: { select: { id: true, name: true, accountId: true } },
      allocations: { include: { bill: { select: { billNumber: true } } } },
    },
  });
  if (!p) throw new Error(`Pembayaran supplier ${paymentId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.supplierPayment(paymentId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const utangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
  const amount = toMoney(p.amount);
  const nomorTagihan = p.allocations.map((a) => a.bill.billNumber).join(", ");

  const { entry, created } = await postJournal(tx, {
    date: p.date,
    description: `${p.paymentNumber} — pembayaran ke ${p.supplier.name}${nomorTagihan ? ` untuk ${nomorTagihan}` : ""}`,
    source: "PEMBAYARAN_SUPPLIER",
    sourceId: paymentId,
    idempotencyKey: KEY.supplierPayment(paymentId),
    userId,
    lines: [
      {
        accountId: utangUsaha.id,
        debit: amount,
        description: `Pelunasan utang ${p.supplier.name}`,
        supplierId: p.supplierId,
      },
      {
        accountId: p.cashAccount.accountId,
        credit: amount,
        description: `Uang keluar — ${p.cashAccount.name}${p.reference ? ` (${p.reference})` : ""}`,
        cashAccountId: p.cashAccountId,
        supplierId: p.supplierId,
      },
    ],
  });
  return { posted: true, entry, created };
}

/**
 * Status tagihan yang DITURUNKAN dari alokasi pembayaran — tidak pernah
 * diketik manusia (pola yang sama dengan Invoice.statusEfektif di
 * services/invoice.js dan Order.paymentStatus).
 */
export function statusTagihanEfektif(bill, totalTeralokasi) {
  if (["DRAFT", "MENUNGGU_APPROVAL", "DITOLAK", "DIBATALKAN"].includes(bill.status)) return bill.status;
  const nilai = toMoney(bill.amount);
  const bayar = toMoney(totalTeralokasi || 0);
  if (bayar.greaterThanOrEqualTo(nilai)) return "LUNAS";
  if (bayar.greaterThan(0)) return "DIBAYAR_SEBAGIAN";
  return "DISETUJUI";
}

/** Hitung ulang & simpan status tagihan setelah alokasi berubah. */
export async function recomputeBillStatus(tx, billId) {
  const bill = await tx.finSupplierBill.findUnique({
    where: { id: billId },
    select: { id: true, amount: true, status: true },
  });
  if (!bill) return null;

  const alokasi = await tx.finSupplierPaymentAllocation.findMany({
    where: { billId, payment: { cancelledAt: null } },
    select: { amount: true },
  });
  const total = alokasi.length === 0 ? ZERO : sumMoney(alokasi.map((a) => a.amount));
  const status = statusTagihanEfektif(bill, total);

  if (status !== bill.status) {
    await tx.finSupplierBill.update({ where: { id: billId }, data: { status } });
  }
  return { status, terbayar: total };
}
