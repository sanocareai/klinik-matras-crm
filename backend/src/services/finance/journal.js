// MESIN JURNAL — SATU-SATUNYA pintu menulis ke fin_journal_entries /
// fin_journal_lines. ATURAN TUNGGAL, sama tegasnya dengan postStockMovement()
// di inventoryLedger.js: TIDAK ADA route/service lain yang boleh memanggil
// tx.finJournalEntry.create() langsung. Kalau ada jalur kedua, satu-satunya
// hal yang menjamin jurnal seimbang & idempoten (file ini) bisa dilewati.
//
// ── EMPAT JAMINAN YANG DITEGAKKAN DI SINI ────────────────────────────────
//
// 1. SEIMBANG. Σ debit === Σ kredit, dibandingkan sebagai Decimal (lihat
//    money.js soal kenapa Number tidak cukup). Selisih sekecil apa pun =
//    seluruh transaksi ditolak, bukan "dibulatkan biar lewat".
//
// 2. IDEMPOTEN. `idempotencyKey` unik di level DATABASE. Kalau dua request
//    bersamaan mencoba memposting kejadian yang sama, yang kalah race
//    ditolak Postgres (P2002) dan fungsi ini MENGEMBALIKAN jurnal yang
//    sudah ada — bukan melempar error ke pengguna untuk sesuatu yang
//    sebenarnya sudah berhasil. Pola yang sama dengan ensureInvoiceForOrder()
//    di services/invoice.js.
//
// 3. ATOMIK. WAJIB dipanggil dengan `tx` (klien transaksi) yang SAMA dengan
//    mutasi sumbernya. Konsekuensinya dua arah dan keduanya disengaja:
//    pembayaran gagal → jurnalnya ikut batal; jurnal gagal → pembayarannya
//    ikut batal. Tidak ada "uang tercatat tapi tidak terbukukan".
//
// 4. TIDAK PERNAH DIUBAH. Tidak ada updateJournal() di file ini, dan tidak
//    boleh ditambahkan. Koreksi = reverseJournal().

import { toMoney, sumMoney, ZERO, MoneyError } from "./money.js";

// Status jurnal yang IKUT DIHITUNG saat menyusun saldo/laporan.
//
// REVERSED IKUT, dan ini penting: jurnal yang dibatalkan TIDAK dihapus —
// pembatalannya diwujudkan sebagai jurnal BALIK terpisah yang meniadakannya.
// Kalau baris aslinya dibuang dari perhitungan SEKALIGUS jurnal baliknya
// ikut dihitung, efeknya ganda: saldo akan bergeser ke arah berlawanan
// sebesar nominal transaksi itu. DRAFT tidak pernah ikut — jurnal manual
// yang belum diposting bukan bagian buku besar.
export const STATUS_DIHITUNG = Object.freeze(["POSTED", "REVERSED"]);

export class JournalError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "JournalError";
    this.statusCode = statusCode;
  }
}

function assertTx(tx, fnName) {
  if (!tx?.finJournalEntry) {
    throw new Error(
      `${fnName} butuh \`tx\` (klien transaksi Prisma), bukan prisma singleton di luar transaksi — ` +
      "jurnal harus batal bersama transaksi sumbernya."
    );
  }
}

// Penomoran JV-DDMMYYYY-NNN, counter per bulan — memakai ULANG tabel
// OrderSequence yang sudah ada (kuncinya [prefix, year, month]), persis pola
// generateInvoiceNumber() di services/invoice.js. Tidak ada tabel counter
// kedua yang harus dirawat terpisah.
//
// ⚠️ `date` di sini adalah TANGGAL BUKU (hasil toBookDate/todayBookDateWIB —
// tengah malam UTC), BUKAN instant. Karena itu tanggal/bulan/tahunnya dibaca
// dengan getter UTC, bukan getter lokal.
//
// Bedanya bukan teoretis: tanggal buku "1 Oktober" tersimpan sebagai
// 2026-10-01T00:00:00Z; dibaca `getMonth()` di mesin ber-offset negatif ia
// jadi 30 September, sehingga nomor dokumennya memakai counter BULAN
// SEBELUMNYA — nomor bisa bentrok dengan dokumen September yang sudah ada,
// dan urutan dokumen di laporan jadi kacau tepat di batas bulan. Server
// production memang UTC sehingga gejalanya tidak muncul di sana, tapi
// mesin developer TIDAK, dan itulah yang membuat bug kelas ini lolos ke
// production di tempat lain (lihat aturan waktu di CLAUDE.md §11).
//
// Default-nya todayBookDateWIB(), bukan new Date(): dokumen yang dibuat jam
// 01:00 WIB harus bernomor tanggal HARI ITU, bukan kemarin.
export async function generateDocumentNumber(tx, prefix, date = todayBookDateWIB()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const record = await tx.orderSequence.upsert({
    where: { prefix_year_month: { prefix, year, month } },
    update: { lastSeq: { increment: 1 } },
    create: { prefix, year, month, lastSeq: 1 },
  });

  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${prefix}-${dd}${mm}${year}-${String(record.lastSeq).padStart(3, "0")}`;
}

/**
 * Pastikan periode akuntansi untuk `date` terbuka. Periode dibuat otomatis
 * (OPEN) kalau belum ada — penutupan SELALU keputusan manusia, pembukaan
 * tidak perlu.
 *
 * `date` di sini adalah TANGGAL BUKU (kolom @db.Date). Bulan/tahunnya
 * diambil dengan getUTCMonth/getUTCFullYear, BUKAN getMonth lokal: kolom
 * DATE di Postgres dibaca Prisma sebagai instant UTC tengah malam, jadi
 * membacanya dengan getter lokal di mesin ber-timezone negatif akan
 * menggeser tanggal 1 ke bulan sebelumnya — kelas bug yang persis dijaga
 * utils/wib.js untuk sisi query.
 */
export async function ensurePeriodOpen(tx, date, { allowClosed = false } = {}) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;

  const period = await tx.finPeriod.findUnique({ where: { year_month: { year, month } } });
  if (!period) {
    try {
      return await tx.finPeriod.create({ data: { year, month, status: "OPEN" } });
    } catch (e) {
      if (e.code !== "P2002") throw e; // dua request bersamaan — yang kalah baca ulang
      return tx.finPeriod.findUnique({ where: { year_month: { year, month } } });
    }
  }
  if (period.status === "CLOSED" && !allowClosed) {
    throw new JournalError(
      `Periode ${String(month).padStart(2, "0")}/${year} sudah ditutup — jurnal baru untuk periode itu ditolak. ` +
      "Buka kembali periodenya (Finance > Pengaturan) atau posting ke periode berjalan.",
      409
    );
  }
  return period;
}

/**
 * Normalisasi & validasi baris jurnal. Dipisah dari postJournal supaya bisa
 * dites sebagai fungsi MURNI (tanpa DB) — lihat tests/financeJournal.test.js.
 *
 * Menerima { accountId, debit?, credit?, description?, orderId?, customerId?,
 * supplierId?, cashAccountId?, unitId? }.
 */
export function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new JournalError("Jurnal wajib punya minimal 2 baris (satu debit, satu kredit)");
  }

  const normalized = lines.map((line, i) => {
    if (!line?.accountId) {
      throw new JournalError(`Baris ke-${i + 1}: akun wajib dipilih`);
    }
    const debit = line.debit == null || line.debit === "" ? ZERO : toMoney(line.debit, { field: `Debit baris ke-${i + 1}` });
    const credit = line.credit == null || line.credit === "" ? ZERO : toMoney(line.credit, { field: `Kredit baris ke-${i + 1}` });

    if (debit.isNegative() || credit.isNegative()) {
      throw new JournalError(`Baris ke-${i + 1}: debit/kredit tidak boleh negatif — pindahkan ke kolom sebelahnya`);
    }
    if (debit.isZero() && credit.isZero()) {
      throw new JournalError(`Baris ke-${i + 1}: isi salah satu kolom debit atau kredit`);
    }
    if (debit.greaterThan(0) && credit.greaterThan(0)) {
      throw new JournalError(`Baris ke-${i + 1}: satu baris hanya boleh debit ATAU kredit, bukan keduanya`);
    }

    return {
      lineNo: i + 1,
      accountId: line.accountId,
      debit,
      credit,
      description: line.description || null,
      orderId: line.orderId || null,
      customerId: line.customerId || null,
      supplierId: line.supplierId || null,
      cashAccountId: line.cashAccountId || null,
      unitId: line.unitId || null,
    };
  });

  const totalDebit = sumMoney(normalized.map((l) => l.debit));
  const totalCredit = sumMoney(normalized.map((l) => l.credit));

  if (!totalDebit.equals(totalCredit)) {
    throw new JournalError(
      `Jurnal tidak seimbang: total debit ${totalDebit.toFixed(2)} vs total kredit ${totalCredit.toFixed(2)} ` +
      `(selisih ${totalDebit.minus(totalCredit).toFixed(2)}). Jurnal TIDAK disimpan.`
    );
  }
  if (totalDebit.isZero()) {
    throw new JournalError("Jurnal bernilai nol — tidak ada yang perlu dibukukan");
  }

  return { lines: normalized, total: totalDebit };
}

// Tanggal buku: terima "YYYY-MM-DD" (dari UI) atau Date. Disimpan sebagai
// tengah malam UTC supaya kolom @db.Date tidak pernah bergeser sehari.
export function toBookDate(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const s = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new JournalError(`Tanggal buku tidak valid: ${String(value)} (format YYYY-MM-DD)`);
  }
  return new Date(`${s}T00:00:00.000Z`);
}

// Tanggal buku HARI INI menurut WIB — dipakai posting otomatis yang tidak
// punya tanggal eksplisit dari pengguna. Memakai jam server (UTC) apa adanya
// akan menaruh transaksi jam 00:00-07:00 WIB di tanggal buku KEMARIN.
export function todayBookDateWIB(now = new Date()) {
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate()));
}

/**
 * Tulis satu jurnal seimbang. Lihat empat jaminan di kepala file.
 *
 * @param {object} tx           klien transaksi Prisma (WAJIB)
 * @param {object} opts
 * @param {Date|string} opts.date          tanggal buku
 * @param {string} opts.description
 * @param {string} opts.source             FinJournalSource
 * @param {string} [opts.sourceId]
 * @param {string} [opts.idempotencyKey]   null untuk jurnal manual
 * @param {Array}  opts.lines
 * @param {string} [opts.userId]
 * @param {"DRAFT"|"POSTED"} [opts.status] DRAFT hanya untuk jurnal manual
 * @param {boolean} [opts.allowClosedPeriod]
 * @returns {Promise<{entry: object, created: boolean}>}
 *          created=false berarti jurnal untuk kejadian ini SUDAH ada
 *          (idempoten) — pemanggil TIDAK boleh menganggap ini kegagalan.
 */
export async function postJournal(tx, {
  date,
  description,
  source,
  sourceId = null,
  idempotencyKey = null,
  lines,
  userId = null,
  status = "POSTED",
  allowClosedPeriod = false,
}) {
  assertTx(tx, "postJournal");

  if (!description || !String(description).trim()) {
    throw new JournalError("Keterangan jurnal wajib diisi");
  }
  if (!source) throw new JournalError("Sumber jurnal wajib diisi");

  // Cek cepat SEBELUM kerja berat — kalau kejadian ini sudah pernah
  // dibukukan, keluar segera. Ini OPTIMASI, bukan jaminan: jaminannya
  // constraint @unique di DB (lihat penanganan P2002 di bawah).
  if (idempotencyKey) {
    const existing = await tx.finJournalEntry.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing) return { entry: existing, created: false };
  }

  const bookDate = toBookDate(date);
  const { lines: normalized } = normalizeLines(lines);

  if (status === "POSTED") {
    await ensurePeriodOpen(tx, bookDate, { allowClosed: allowClosedPeriod });
  }

  // Akun harus ADA, AKTIF, dan akun DETAIL (bukan header). Dicek dalam satu
  // query untuk semua baris — bukan per baris di dalam loop.
  const accountIds = [...new Set(normalized.map((l) => l.accountId))];
  const accounts = await tx.finAccount.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, code: true, name: true, isPostable: true, active: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const id of accountIds) {
    const acc = byId.get(id);
    if (!acc) throw new JournalError(`Akun ${id} tidak ditemukan di Bagan Akun`, 404);
    if (!acc.isPostable) {
      throw new JournalError(
        `Akun ${acc.code} ${acc.name} adalah akun kelompok (header) — jurnal harus menempel ke akun detail di bawahnya`
      );
    }
    if (!acc.active) {
      throw new JournalError(`Akun ${acc.code} ${acc.name} sudah dinonaktifkan — pilih akun lain`);
    }
  }

  const entryNumber = await generateDocumentNumber(tx, "JV", bookDate);

  try {
    const entry = await tx.finJournalEntry.create({
      data: {
        entryNumber,
        date: bookDate,
        description: String(description).trim(),
        source,
        sourceId,
        idempotencyKey,
        status,
        postedAt: status === "POSTED" ? new Date() : null,
        postedById: status === "POSTED" ? userId : null,
        createdById: userId,
        lines: {
          create: normalized.map((l) => ({
            lineNo: l.lineNo,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
            orderId: l.orderId,
            customerId: l.customerId,
            supplierId: l.supplierId,
            cashAccountId: l.cashAccountId,
            unitId: l.unitId,
          })),
        },
      },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    return { entry, created: true };
  } catch (e) {
    // P2002 pada idempotencyKey = request kembar yang lolos cek di atas.
    // Yang kalah race memakai jurnal yang menang, BUKAN gagal — hasil
    // akhirnya identik dari sudut pandang pemanggil.
    if (e.code === "P2002" && idempotencyKey && String(e.meta?.target || "").includes("idempotency")) {
      const existing = await tx.finJournalEntry.findUnique({
        where: { idempotencyKey },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
      if (existing) return { entry: existing, created: false };
    }
    throw e;
  }
}

/**
 * Batalkan jurnal terposting dengan JURNAL BALIK — satu-satunya cara
 * membatalkan sesuatu yang sudah dibukukan.
 *
 * Kenapa bukan hapus/edit: laporan bulan lalu yang sudah dilihat owner tidak
 * boleh berubah angkanya secara retroaktif. Reversal punya TANGGALNYA
 * SENDIRI (default hari ini) — jadi koreksi muncul di periode saat koreksi
 * benar-benar diputuskan, bukan menyelinap ke periode yang sudah dilaporkan.
 * Kalau memang koreksinya harus masuk periode asal (masih terbuka), pemanggil
 * boleh mengoper `date` eksplisit.
 */
export async function reverseJournal(tx, { entryId, date = null, reason, userId = null }) {
  assertTx(tx, "reverseJournal");

  if (!reason || !String(reason).trim()) {
    throw new JournalError("Alasan pembatalan wajib diisi — jurnal balik tanpa alasan tidak bisa diaudit");
  }

  const original = await tx.finJournalEntry.findUnique({
    where: { id: entryId },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
  if (!original) throw new JournalError("Jurnal tidak ditemukan", 404);
  if (original.status === "REVERSED") {
    throw new JournalError(`Jurnal ${original.entryNumber} sudah pernah dibatalkan`, 409);
  }
  if (original.status === "DRAFT") {
    throw new JournalError(
      `Jurnal ${original.entryNumber} masih draft dan belum masuk buku besar — hapus draft-nya, bukan dibalik`,
      409
    );
  }
  if (original.source === "REVERSAL") {
    throw new JournalError(
      `${original.entryNumber} adalah jurnal balik. Membalik jurnal balik hanya menambah kebingungan — ` +
      "posting jurnal koreksi baru kalau memang perlu.",
      409
    );
  }

  const bookDate = date ? toBookDate(date) : todayBookDateWIB();

  // Debit <-> kredit ditukar, dimensi (order/customer/supplier/kas/unit)
  // DIBAWA APA ADANYA — supaya saldo per dimensi ikut balik ke nol, bukan
  // cuma total per akun.
  const reversedLines = original.lines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: l.description,
    orderId: l.orderId,
    customerId: l.customerId,
    supplierId: l.supplierId,
    cashAccountId: l.cashAccountId,
    unitId: l.unitId,
  }));

  await ensurePeriodOpen(tx, bookDate);

  const entryNumber = await generateDocumentNumber(tx, "JV", bookDate);
  const reversal = await tx.finJournalEntry.create({
    data: {
      entryNumber,
      date: bookDate,
      description: `Pembatalan ${original.entryNumber} — ${String(reason).trim()}`,
      source: "REVERSAL",
      sourceId: original.id,
      // reversalOfId @unique: satu jurnal mustahil dibalik dua kali, dijaga
      // database — bukan cuma oleh cek status di atas.
      reversalOfId: original.id,
      status: "POSTED",
      postedAt: new Date(),
      postedById: userId,
      createdById: userId,
      lines: {
        create: reversedLines.map((l, i) => ({ ...l, lineNo: i + 1 })),
      },
    },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });

  await tx.finJournalEntry.update({
    where: { id: original.id },
    data: { status: "REVERSED", reversedAt: new Date(), reversalReason: String(reason).trim() },
  });

  return reversal;
}

/**
 * Cari jurnal yang lahir dari satu kejadian sumber. Dipakai UI ("lihat
 * jurnalnya") dan mesin posting yang perlu tahu apakah sebuah dokumen
 * pernah dibukukan sebelum mengizinkan pembatalan.
 */
export async function findEntryBySource(tx, source, sourceId) {
  return tx.finJournalEntry.findFirst({
    where: { source, sourceId, status: { not: "DRAFT" } },
    include: { lines: { orderBy: { lineNo: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function findEntryByKey(tx, idempotencyKey) {
  return tx.finJournalEntry.findUnique({
    where: { idempotencyKey },
    include: { lines: { orderBy: { lineNo: "asc" } } },
  });
}

/**
 * Catat GAP posting — jurnal yang seharusnya ada tapi datanya belum cukup.
 * Lihat model FinPostingGap di schema.prisma untuk alasan kenapa ini tabel,
 * bukan sekadar log yang hilang begitu saja.
 *
 * Idempoten lewat @@unique([source, sourceId]): satu kejadian sumber
 * menghasilkan MAKSIMAL satu baris gap yang terbuka.
 */
export async function recordPostingGap(tx, { source, sourceId, reason, detail, metadata = {} }) {
  assertTx(tx, "recordPostingGap");
  try {
    return await tx.finPostingGap.create({
      data: { source, sourceId, reason, detail, metadata },
    });
  } catch (e) {
    if (e.code !== "P2002") throw e;
    // Sudah pernah tercatat — perbarui detailnya (angka/qty bisa berubah)
    // tapi JANGAN buka kembali gap yang sudah diselesaikan.
    return tx.finPostingGap.update({
      where: { source_sourceId: { source, sourceId } },
      data: { reason, detail, metadata },
    });
  }
}

export async function resolvePostingGap(tx, { source, sourceId, entryId = null }) {
  const gap = await tx.finPostingGap.findUnique({ where: { source_sourceId: { source, sourceId } } });
  if (!gap || gap.resolvedAt) return gap || null;
  return tx.finPostingGap.update({
    where: { id: gap.id },
    data: { resolvedAt: new Date(), resolvedEntryId: entryId },
  });
}

export { MoneyError };
