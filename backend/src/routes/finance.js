// FINANCE WORKSPACE — bagan akun, rekening kas/bank, periode, jurnal umum,
// dan seluruh laporan keuangan. Transaksi harian (pengeluaran, tagihan
// supplier, transfer kas, refund, rekonsiliasi bank) ada di file tetangga
// routes/financeTransactions.js — dipisah semata karena panjangnya, dua-
// duanya di-mount di prefix /api/finance yang sama.
//
// ── OTORISASI ───────────────────────────────────────────────────────────
// Empat permission dengan pembagian tugas yang tegas (lihat komentar
// panjang di constants/permissions.js):
//   finance:read    membaca apa pun di sini
//   finance:post    membuat & memposting transaksi
//   finance:approve menyetujui pengeluaran/tagihan/refund
//   finance:admin   bagan akun, rekening, periode, pengaturan, REVERSAL
//
// Endpoint REVERSAL sengaja dijaga finance:admin, bukan finance:post —
// membatalkan sesuatu yang sudah masuk laporan bukan pekerjaan harian.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import {
  postJournal, reverseJournal, toBookDate, todayBookDateWIB, ensurePeriodOpen,
  JournalError, STATUS_DIHITUNG, recordPostingGap,
} from "../services/finance/journal.js";
import {
  ensureDefaultChartOfAccounts, DEFAULT_COA, SYSTEM_KEYS, AccountError,
} from "../services/finance/accounts.js";
import { MoneyError, moneyToNumber, toMoney, sumMoney } from "../services/finance/money.js";
import {
  SETTING_KEYS, getAllSettings, setSetting, getVerificationGate, parseBool,
} from "../services/finance/settings.js";
import {
  neracaSaldo, labaRugi, neraca, arusKas, bukuBesar, umurPiutang, umurUtang,
  saldoKasBank, catatanLaporan,
} from "../services/finance/reports.js";
import { startOfDayWIB, endOfDayExclusiveWIB } from "../utils/wib.js";
// hitungNominal & statusEfektif DIPAKAI ULANG dari services/invoice.js —
// BUKAN dihitung ulang di sini. Itu satu-satunya tempat arti nominal
// invoice didefinisikan (harga final per item, ongkir ditagihkan,
// ongkirKlaimGaransi TIDAK), dan invoice yang dilihat finance wajib
// menampilkan angka yang SAMA PERSIS dengan yang sudah dikirim sales ke
// customer lewat WA/PDF. Menyalin rumusnya ke sini = dua dokumen ke
// customer yang sama saling bertentangan begitu salah satunya diubah.
import { hitungNominal, statusEfektif } from "../services/invoice.js";

export const financeRouter = express.Router();
financeRouter.use(requireAuth);

// Satu penanganan error untuk seluruh router — MoneyError/JournalError/
// AccountError semuanya membawa statusCode sendiri dan pesan Bahasa
// Indonesia yang memang ditujukan ke pengguna, jadi diteruskan apa adanya.
// Error lain TIDAK pernah bocor detailnya ke klien.
export function handleFinanceError(err, res) {
  if (err instanceof MoneyError || err instanceof JournalError || err instanceof AccountError) {
    return res.status(err.statusCode || 400).json({ error: err.message });
  }
  if (err?.statusCode) return res.status(err.statusCode).json({ error: err.message });
  if (err?.code === "P2002") {
    return res.status(409).json({ error: "Data dengan kunci yang sama sudah ada" });
  }
  if (err?.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("[finance]", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

/**
 * Rentang tanggal dari query ?from=&to= (tanggal WIB) → batas instant.
 * Default: bulan berjalan. SELALU lewat utils/wib.js — memakai
 * new Date(y,m,d) akan menggeser batas 7 jam dan membuang transaksi
 * jam 00:00–07:00 WIB dari laporan (bug kelas ini pernah nyata di
 * routes/analytics.js, lihat CLAUDE.md §11).
 */
export function rentangDariQuery(query) {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const lastDay = new Date(Date.UTC(y, wib.getUTCMonth() + 1, 0)).getUTCDate();

  const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(query.from || "") ? query.from : `${y}-${m}-01`;
  const toStr = /^\d{4}-\d{2}-\d{2}$/.test(query.to || "") ? query.to : `${y}-${m}-${String(lastDay).padStart(2, "0")}`;

  // Kolom fin_journal_entries.date bertipe DATE (bukan instant), jadi
  // pembandingnya tanggal polos tengah malam UTC — bukan batas WIB seperti
  // kolom createdAt. Dua jenis kolom, dua cara banding; menyamakannya akan
  // membuang jurnal tanggal terakhir periode.
  return {
    from: new Date(`${fromStr}T00:00:00.000Z`),
    to: new Date(`${toStr}T00:00:00.000Z`),
    fromStr,
    toStr,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// BAGAN AKUN
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/accounts", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { includeInactive } = req.query;
    const accounts = await prisma.finAccount.findMany({
      where: includeInactive === "1" ? {} : { active: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, type: true, normalBalance: true,
        parentId: true, isPostable: true, cashFlowCategory: true, systemKey: true,
        active: true, description: true,
      },
    });
    const terpasang = accounts.length > 0;
    res.json({
      accounts,
      // UI butuh tahu apakah bagan akun bawaan sudah dipasang, supaya bisa
      // menampilkan langkah pertama yang jelas alih-alih tabel kosong.
      bawaanTerpasang: terpasang,
      jumlahBawaan: DEFAULT_COA.length,
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/accounts/install-defaults", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      const r = await ensureDefaultChartOfAccounts(tx);
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_ACCOUNT,
        entityId: "bagan-akun",
        eventType: EVENT_TYPES.CHART_OF_ACCOUNTS_CHANGED,
        actorId: req.user.id,
        metadata: { aksi: "pasang_bawaan", jumlah: r.accounts },
      });
      return r;
    });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/accounts", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { code, name, type, normalBalance, parentId, isPostable, cashFlowCategory, description } = req.body;
    if (!code?.trim() || !name?.trim()) {
      return res.status(400).json({ error: "Kode & nama akun wajib diisi" });
    }
    if (!["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN_POKOK", "BEBAN"].includes(type)) {
      return res.status(400).json({ error: "Tipe akun tidak valid" });
    }
    if (!["DEBIT", "KREDIT"].includes(normalBalance)) {
      return res.status(400).json({ error: "Saldo normal wajib DEBIT atau KREDIT" });
    }

    const account = await prisma.$transaction(async (tx) => {
      const a = await tx.finAccount.create({
        data: {
          code: code.trim(), name: name.trim(), type, normalBalance,
          parentId: parentId || null,
          isPostable: isPostable !== false,
          cashFlowCategory: cashFlowCategory || null,
          description: description?.trim() || null,
          // systemKey SENGAJA tidak bisa diisi dari sini. Kunci sistem
          // menentukan akun mana yang dipakai MESIN POSTING — membiarkannya
          // diketik bebas berarti seseorang bisa diam-diam mengalihkan
          // seluruh penerimaan kas ke akun karangan. Kunci hanya lahir dari
          // DEFAULT_COA.
          systemKey: null,
        },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_ACCOUNT, entityId: a.id,
        eventType: EVENT_TYPES.CHART_OF_ACCOUNTS_CHANGED, actorId: req.user.id,
        metadata: { aksi: "dibuat", code: a.code, name: a.name, type: a.type },
      });
      return a;
    });
    res.status(201).json(account);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.patch("/accounts/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { name, description, cashFlowCategory, active, parentId } = req.body;
    const account = await prisma.$transaction(async (tx) => {
      const sebelum = await tx.finAccount.findUnique({ where: { id: req.params.id } });
      if (!sebelum) throw Object.assign(new Error("Akun tidak ditemukan"), { statusCode: 404 });

      // Akun ber-systemKey TIDAK boleh dinonaktifkan — mesin posting akan
      // berhenti bekerja tanpanya, dan kegagalannya baru terasa berhari-hari
      // kemudian sebagai tumpukan "Data Belum Lengkap". Namanya boleh
      // diganti (silakan sesuaikan dengan kebiasaan tim), fungsinya tidak.
      if (sebelum.systemKey && active === false) {
        throw Object.assign(
          new Error(
            `Akun ${sebelum.code} ${sebelum.name} dipakai mesin pembukuan otomatis (kunci sistem: ${sebelum.systemKey}) ` +
            "dan tidak bisa dinonaktifkan. Namanya boleh diganti."
          ),
          { statusCode: 409 }
        );
      }

      const changes = {};
      if (name !== undefined && name !== sebelum.name) changes.name = { from: sebelum.name, to: name };
      if (active !== undefined && active !== sebelum.active) changes.active = { from: sebelum.active, to: active };
      if (cashFlowCategory !== undefined && cashFlowCategory !== sebelum.cashFlowCategory) {
        changes.cashFlowCategory = { from: sebelum.cashFlowCategory, to: cashFlowCategory };
      }

      const a = await tx.finAccount.update({
        where: { id: req.params.id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(description !== undefined && { description: description?.trim() || null }),
          ...(cashFlowCategory !== undefined && { cashFlowCategory: cashFlowCategory || null }),
          ...(active !== undefined && { active: Boolean(active) }),
          ...(parentId !== undefined && { parentId: parentId || null }),
        },
      });
      if (Object.keys(changes).length > 0) {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.FIN_ACCOUNT, entityId: a.id,
          eventType: EVENT_TYPES.CHART_OF_ACCOUNTS_CHANGED, actorId: req.user.id,
          metadata: { code: a.code, changes },
        });
      }
      return a;
    });
    res.json(account);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// REKENING KAS & BANK
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/cash-accounts", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const saldo = await saldoKasBank(prisma, { to: new Date() });
    const semua = await prisma.finCashAccount.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { account: { select: { id: true, code: true, name: true } } },
    });
    const petaSaldo = new Map(saldo.map((s) => [s.id, s.saldo]));
    res.json({
      accounts: semua.map((a) => ({ ...a, saldo: petaSaldo.get(a.id) ?? 0 })),
      totalSaldo: saldo.reduce((s, a) => s + a.saldo, 0),
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/cash-accounts", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { name, kind, bankName, accountNumber, accountHolder, accountId, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Nama rekening wajib diisi" });
    if (!["KAS", "BANK", "EWALLET"].includes(kind)) {
      return res.status(400).json({ error: "Jenis rekening wajib KAS, BANK, atau EWALLET" });
    }

    // Akun COA tujuan: kalau tidak dipilih, pakai akun sistem yang sesuai
    // jenisnya. Ini BUKAN tebakan — KAS/BANK adalah akun bawaan yang memang
    // disiapkan persis untuk ini (lihat DEFAULT_COA).
    let coaId = accountId;
    if (!coaId) {
      const bawaan = await prisma.finAccount.findUnique({
        where: { systemKey: kind === "KAS" ? SYSTEM_KEYS.KAS : SYSTEM_KEYS.BANK },
        select: { id: true },
      });
      if (!bawaan) {
        return res.status(409).json({
          error: "Bagan akun belum dipasang. Buka Finance > Bagan Akun lalu jalankan \"Pasang Akun Bawaan\" dulu.",
        });
      }
      coaId = bawaan.id;
    }

    const created = await prisma.finCashAccount.create({
      data: {
        name: name.trim(), kind,
        bankName: bankName?.trim() || null,
        accountNumber: accountNumber?.trim() || null,
        accountHolder: accountHolder?.trim() || null,
        accountId: coaId,
        notes: notes?.trim() || null,
      },
      include: { account: { select: { code: true, name: true } } },
    });
    res.status(201).json(created);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.patch("/cash-accounts/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { name, bankName, accountNumber, accountHolder, active, notes } = req.body;
    const updated = await prisma.finCashAccount.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(bankName !== undefined && { bankName: bankName?.trim() || null }),
        ...(accountNumber !== undefined && { accountNumber: accountNumber?.trim() || null }),
        ...(accountHolder !== undefined && { accountHolder: accountHolder?.trim() || null }),
        ...(active !== undefined && { active: Boolean(active) }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
    });
    res.json(updated);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// KATEGORI BIAYA
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/expense-categories", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const categories = await prisma.finExpenseCategory.findMany({
      where: req.query.includeInactive === "1" ? {} : { active: true },
      orderBy: [{ division: "asc" }, { name: "asc" }],
      include: { account: { select: { id: true, code: true, name: true, type: true } } },
    });
    res.json({ categories });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/expense-categories", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { code, name, accountId, division } = req.body;
    if (!code?.trim() || !name?.trim() || !accountId) {
      return res.status(400).json({ error: "Kode, nama, dan akun tujuan wajib diisi" });
    }
    const akun = await prisma.finAccount.findUnique({ where: { id: accountId }, select: { isPostable: true, type: true } });
    if (!akun) return res.status(404).json({ error: "Akun tujuan tidak ditemukan" });
    if (!akun.isPostable) return res.status(400).json({ error: "Akun tujuan harus akun detail, bukan akun kelompok" });
    if (!["BEBAN", "BEBAN_POKOK"].includes(akun.type)) {
      return res.status(400).json({
        error: "Kategori biaya harus menunjuk akun bertipe Beban atau Beban Pokok — memilih akun aset/kewajiban akan membuat laba rugi salah",
      });
    }

    const created = await prisma.finExpenseCategory.create({
      data: {
        code: code.trim().toUpperCase(), name: name.trim(), accountId,
        division: division || "UMUM",
        // autoMapKey hanya lahir dari DEFAULT_EXPENSE_CATEGORIES — sama
        // alasannya dengan systemKey pada akun.
        autoMapKey: null,
      },
      include: { account: { select: { code: true, name: true } } },
    });
    res.status(201).json(created);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.patch("/expense-categories/:id", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { name, accountId, division, active } = req.body;
    const updated = await prisma.finExpenseCategory.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(accountId !== undefined && { accountId }),
        ...(division !== undefined && { division }),
        ...(active !== undefined && { active: Boolean(active) }),
      },
      include: { account: { select: { code: true, name: true } } },
    });
    res.json(updated);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PERIODE AKUNTANSI
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/periods", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const periods = await prisma.finPeriod.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      include: { closedBy: { select: { id: true, name: true } } },
      take: 36,
    });
    res.json({ periods });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/periods/close", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const year = Number(req.body.year);
    const month = Number(req.body.month);
    const note = req.body.note?.trim() || null;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: "Tahun & bulan periode tidak valid" });
    }

    const hasil = await prisma.$transaction(async (tx) => {
      // Menutup periode yang masih punya gap posting berarti mengunci angka
      // yang SUDAH DIKETAHUI kurang. Ditolak — bukan sekadar diperingatkan.
      const gapDiperiode = await tx.finPostingGap.count({ where: { resolvedAt: null } });
      if (gapDiperiode > 0 && req.body.abaikanGap !== true) {
        throw Object.assign(
          new Error(
            `Masih ada ${gapDiperiode} transaksi yang belum bisa dibukukan. Menutup periode sekarang akan mengunci ` +
            "laporan yang sudah diketahui kurang. Bereskan dulu di Finance > Data Belum Lengkap, " +
            "atau tutup dengan sadar lewat pilihan \"tutup walau ada data belum lengkap\"."
          ),
          { statusCode: 409 }
        );
      }

      const period = await tx.finPeriod.upsert({
        where: { year_month: { year, month } },
        update: { status: "CLOSED", closedAt: new Date(), closedById: req.user.id, closeNote: note },
        create: { year, month, status: "CLOSED", closedAt: new Date(), closedById: req.user.id, closeNote: note },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PERIOD, entityId: period.id,
        eventType: EVENT_TYPES.PERIOD_CLOSED, actorId: req.user.id,
        metadata: { periode: `${String(month).padStart(2, "0")}/${year}`, note, gapTerbuka: gapDiperiode },
      });
      return period;
    });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.post("/periods/reopen", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const year = Number(req.body.year);
    const month = Number(req.body.month);
    const note = req.body.note?.trim() || null;
    if (!note) {
      return res.status(400).json({
        error: "Alasan membuka kembali periode wajib diisi — laporan yang sudah dikunci akan bisa berubah lagi",
      });
    }
    const hasil = await prisma.$transaction(async (tx) => {
      const period = await tx.finPeriod.update({
        where: { year_month: { year, month } },
        data: { status: "OPEN", closedAt: null, closedById: null, closeNote: note },
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_PERIOD, entityId: period.id,
        eventType: EVENT_TYPES.PERIOD_REOPENED, actorId: req.user.id,
        metadata: { periode: `${String(month).padStart(2, "0")}/${year}`, note },
      });
      return period;
    });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// JURNAL UMUM
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/journal", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const { source, status, search } = req.query;
    const take = Math.min(Number(req.query.limit) || 100, 500);
    const skip = Number(req.query.offset) || 0;

    const where = {
      date: { gte: from, lte: to },
      ...(source && { source }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { entryNumber: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [entries, total] = await Promise.all([
      prisma.finJournalEntry.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take, skip,
        include: {
          lines: {
            orderBy: { lineNo: "asc" },
            include: { account: { select: { id: true, code: true, name: true } } },
          },
          createdBy: { select: { id: true, name: true } },
          reversedBy: { select: { id: true, entryNumber: true } },
          reversalOf: { select: { id: true, entryNumber: true } },
        },
      }),
      prisma.finJournalEntry.count({ where }),
    ]);

    res.json({
      entries: entries.map((e) => ({
        ...e,
        totalDebit: moneyToNumber(sumMoney(e.lines.map((l) => l.debit))),
        lines: e.lines.map((l) => ({
          ...l, debit: moneyToNumber(l.debit), credit: moneyToNumber(l.credit),
        })),
      })),
      total,
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/journal/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const entry = await prisma.finJournalEntry.findUnique({
      where: { id: req.params.id },
      include: {
        lines: {
          orderBy: { lineNo: "asc" },
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
            order: { select: { id: true, orderNumber: true } },
            customer: { select: { id: true, name: true } },
            supplier: { select: { id: true, name: true } },
            cashAccount: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, name: true } },
        postedBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, entryNumber: true, date: true } },
        reversalOf: { select: { id: true, entryNumber: true, date: true } },
      },
    });
    if (!entry) return res.status(404).json({ error: "Jurnal tidak ditemukan" });
    res.json({
      ...entry,
      lines: entry.lines.map((l) => ({
        ...l, debit: moneyToNumber(l.debit), credit: moneyToNumber(l.credit),
      })),
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// POST /api/finance/journal — jurnal MANUAL (termasuk saldo awal).
financeRouter.post("/journal", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { date, description, lines, saldoAwal, simpanDraft } = req.body;
    const entry = await prisma.$transaction(async (tx) => {
      const { entry: e } = await postJournal(tx, {
        date: date || todayBookDateWIB(),
        description,
        // Jurnal saldo awal DIBEDAKAN sumbernya supaya laporan bisa jujur
        // menjawab "saldo awal sudah diinput atau belum" (lihat
        // catatanLaporan di reports.js) — bukan tenggelam di antara jurnal
        // manual biasa.
        source: saldoAwal === true ? "SALDO_AWAL" : "MANUAL",
        lines,
        userId: req.user.id,
        status: simpanDraft === true ? "DRAFT" : "POSTED",
      });
      return e;
    });
    res.status(201).json(entry);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// Posting sebuah DRAFT jurnal manual.
financeRouter.post("/journal/:id/post", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      const draft = await tx.finJournalEntry.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      });
      if (!draft) throw Object.assign(new Error("Jurnal tidak ditemukan"), { statusCode: 404 });
      if (draft.status !== "DRAFT") {
        throw Object.assign(new Error("Jurnal ini sudah diposting"), { statusCode: 409 });
      }
      // Periode dicek SEKARANG (bukan saat draft dibuat) — draft bisa saja
      // menganggur berminggu-minggu sampai periodenya keburu ditutup.
      await ensurePeriodOpen(tx, draft.date);

      return tx.finJournalEntry.update({
        where: { id: draft.id },
        data: { status: "POSTED", postedAt: new Date(), postedById: req.user.id },
        include: { lines: { orderBy: { lineNo: "asc" } } },
      });
    });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.delete("/journal/:id", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const entry = await prisma.finJournalEntry.findUnique({
      where: { id: req.params.id },
      select: { id: true, status: true, entryNumber: true },
    });
    if (!entry) return res.status(404).json({ error: "Jurnal tidak ditemukan" });
    if (entry.status !== "DRAFT") {
      return res.status(409).json({
        error: `Jurnal ${entry.entryNumber} sudah masuk buku besar dan tidak bisa dihapus. Batalkan lewat jurnal balik (reversal).`,
      });
    }
    await prisma.finJournalEntry.delete({ where: { id: entry.id } });
    res.json({ ok: true });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// Pembatalan jurnal terposting — SATU-SATUNYA cara, dan sengaja finance:admin.
financeRouter.post("/journal/:id/reverse", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const { reason, date } = req.body;
    const hasil = await prisma.$transaction(async (tx) => {
      const reversal = await reverseJournal(tx, {
        entryId: req.params.id, date: date || null, reason, userId: req.user.id,
      });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: req.params.id,
        eventType: EVENT_TYPES.JOURNAL_REVERSED, actorId: req.user.id,
        metadata: { entryNumber: reversal.description, reason, reversalNumber: reversal.entryNumber },
      });
      return reversal;
    });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// INVOICE & JATUH TEMPO
// ═════════════════════════════════════════════════════════════════════════
//
// Invoice TIDAK dibuat dari sini — ia lahir OTOMATIS sebagai draft begitu
// order dibuat (services/invoice.js#ensureInvoiceForOrder, dipanggil di
// routes/customers.js). Halaman Finance memakai daftar ini untuk satu
// pekerjaan yang memang milik finance: memastikan tagihan punya JATUH TEMPO
// dan menindaklanjuti yang lewat tempo.
//
// Pengubahan jatuh tempo TETAP lewat endpoint lama PATCH /orders/:id/invoice
// — tidak ada jalur tulis kedua untuk kolom yang sama.
financeRouter.get("/invoices", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { status, jatuhTempo, search } = req.query;
    const take = Math.min(Number(req.query.limit) || 200, 500);

    const invoices = await prisma.invoice.findMany({
      where: {
        // Anggota bundle invoice gabungan TIDAK ditampilkan sebagai baris
        // sendiri — dokumen yang benar-benar dikirim ke customer adalah
        // punya PRIMARY (lihat Invoice.combinedIntoId di schema.prisma).
        // Menampilkan keduanya akan menghitung tagihan yang sama dua kali.
        combinedIntoId: null,
        ...(status && { lifecycleStatus: status }),
        ...(search && {
          OR: [
            { invoiceNumber: { contains: search, mode: "insensitive" } },
            { order: { orderNumber: { contains: search, mode: "insensitive" } } },
            { order: { customer: { name: { contains: search, mode: "insensitive" } } } },
          ],
        }),
      },
      orderBy: [{ createdAt: "desc" }],
      take,
      include: {
        order: {
          include: {
            promo: { select: { code: true, discountPercent: true } },
            // cancelledAt: null — entri yang dibatalkan tidak ikut dihitung
            // DAN tidak ditampilkan, persis seperti di buildInvoiceView().
            payments: { where: { cancelledAt: null }, select: { amount: true } },
            customer: { select: { id: true, name: true, assignedSales: { select: { name: true } } } },
          },
        },
        // Invoice gabungan: anggotanya ikut dijumlahkan, bukan dihitung
        // ulang dari order mentah gabungan (itu akan mengacak diskon/promo
        // per order yang sudah benar).
        bundledInvoices: {
          include: {
            order: {
              include: {
                promo: { select: { code: true, discountPercent: true } },
                payments: { where: { cancelledAt: null }, select: { amount: true } },
              },
            },
          },
        },
      },
    });

    const sekarang = new Date();
    const baris = invoices.map((inv) => {
      const semuaOrder = [inv.order, ...inv.bundledInvoices.map((b) => b.order)].filter(Boolean);
      const nominalPerOrder = semuaOrder.map((o) => hitungNominal(o, o.payments));

      const gabung = (kunci) => nominalPerOrder.reduce((s, n) => s + (n[kunci] || 0), 0);
      const nominal = {
        totalTagihan: gabung("totalTagihan"),
        dibayar: gabung("dibayar"),
        sisa: gabung("sisa"),
        lunas: nominalPerOrder.every((n) => n.lunas),
        // Kalau SALAH SATU order memakai jalur status manual (ledger
        // kosong), seluruh baris ditandai begitu — angkanya memang tidak
        // punya rincian pembayaran, dan UI wajib jujur soal itu.
        sumber: nominalPerOrder.some((n) => n.sumber === "statusManual") ? "statusManual" : "ledger",
        dibayarTidakRinci: nominalPerOrder.some((n) => n.dibayarTidakRinci),
      };

      const statusTampil = statusEfektif({ invoice: inv, nominal, now: sekarang });
      const hariLewat = inv.dueDate
        ? Math.floor((sekarang - new Date(inv.dueDate)) / 86400000)
        : null;

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        orderId: inv.orderId,
        orderNumber: inv.order?.orderNumber || null,
        orderStatus: inv.order?.status || null,
        customerId: inv.order?.customer?.id || null,
        customerName: inv.order?.customer?.name || null,
        salesName: inv.order?.customer?.assignedSales?.name || null,
        lifecycleStatus: inv.lifecycleStatus,
        status: statusTampil,
        dueDate: inv.dueDate,
        sentAt: inv.sentAt,
        createdAt: inv.createdAt,
        jumlahOrder: semuaOrder.length,
        hariLewat,
        ...nominal,
      };
    });

    const tersaring = jatuhTempo === "lewat"
      ? baris.filter((b) => b.hariLewat != null && b.hariLewat > 0 && !b.lunas)
      : jatuhTempo === "belum_diatur"
        ? baris.filter((b) => !b.dueDate && !b.lunas && b.lifecycleStatus !== "CANCELLED")
        : baris;

    res.json({
      invoices: tersaring,
      ringkasan: {
        total: tersaring.length,
        tanpaJatuhTempo: baris.filter((b) => !b.dueDate && !b.lunas && b.lifecycleStatus !== "CANCELLED").length,
        lewatTempo: baris.filter((b) => b.hariLewat != null && b.hariLewat > 0 && !b.lunas).length,
        nilaiBelumLunas: baris.filter((b) => !b.lunas).reduce((s, b) => s + b.sisa, 0),
        // JUJUR: berapa baris yang angkanya TIDAK berasal dari ledger
        // pembayaran, melainkan dari dropdown status bayar manual.
        dariStatusManual: baris.filter((b) => b.sumber === "statusManual").length,
      },
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// DATA BELUM LENGKAP (posting gap)
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/gaps", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const gaps = await prisma.finPostingGap.findMany({
      where: req.query.includeResolved === "1" ? {} : { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ gaps, terbuka: gaps.filter((g) => !g.resolvedAt).length });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// Coba posting ulang satu gap — idempoten, aman ditekan berkali-kali.
financeRouter.post("/gaps/:id/retry", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const gap = await prisma.finPostingGap.findUnique({ where: { id: req.params.id } });
    if (!gap) return res.status(404).json({ error: "Data tidak ditemukan" });
    if (gap.resolvedAt) return res.json({ ok: true, sudahSelesai: true });

    const { bukukanPembayaran, bukukanPengakuanPendapatan } = await import("../services/finance/hooks.js");
    const { postVehicleExpense, postVehicleService, postAdSpend } = await import("../services/finance/posting/expense.js");
    const { postGoodsReceiptValue } = await import("../services/finance/posting/supplier.js");
    const { postMaterialIssueCost, postStockMovementCost } = await import("../services/finance/posting/inventory.js");

    const hasil = await prisma.$transaction(async (tx) => {
      switch (gap.source) {
        case "PEMBAYARAN_ORDER":
          return bukukanPembayaran(tx, { paymentId: gap.sourceId, userId: req.user.id });
        case "PENGAKUAN_PENDAPATAN":
          return bukukanPengakuanPendapatan(tx, { orderId: gap.sourceId, userId: req.user.id });
        case "BIAYA_KENDARAAN": {
          // Satu sumber enum, dua tabel asal (VehicleExpense & VehicleService)
          // — dibedakan dengan mencoba yang mana yang punya baris itu.
          const ve = await tx.vehicleExpense.findUnique({ where: { id: gap.sourceId }, select: { id: true } });
          return ve
            ? postVehicleExpense(tx, { vehicleExpenseId: gap.sourceId, userId: req.user.id })
            : postVehicleService(tx, { vehicleServiceId: gap.sourceId, userId: req.user.id });
        }
        case "BIAYA_IKLAN":
          return postAdSpend(tx, { adSpendId: gap.sourceId, userId: req.user.id });
        case "PENERIMAAN_BAHAN":
          return postGoodsReceiptValue(tx, { goodsReceiptId: gap.sourceId, userId: req.user.id });
        case "PEMAKAIAN_BAHAN": {
          const mi = await tx.materialIssue.findUnique({ where: { id: gap.sourceId }, select: { id: true } });
          return mi
            ? postMaterialIssueCost(tx, { materialIssueId: gap.sourceId, userId: req.user.id })
            : postStockMovementCost(tx, { movementId: gap.sourceId, userId: req.user.id });
        }
        default:
          throw Object.assign(
            new Error(`Sumber "${gap.source}" tidak punya jalur posting ulang otomatis — bereskan lewat jurnal manual.`),
            { statusCode: 400 }
          );
      }
    });

    if (hasil?.posted) {
      await prisma.finPostingGap.update({
        where: { id: gap.id },
        data: { resolvedAt: new Date(), resolvedEntryId: hasil.entry?.id || null },
      });
    }
    res.json({ ok: Boolean(hasil?.posted), hasil });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// PENGATURAN
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/settings", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const [settings, gate, cashAccounts] = await Promise.all([
      getAllSettings(prisma),
      getVerificationGate(prisma),
      prisma.finCashAccount.findMany({
        where: { active: true },
        select: { id: true, name: true, kind: true },
        orderBy: { name: "asc" },
      }),
    ]);
    res.json({ settings, gate, cashAccounts, keys: SETTING_KEYS });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.patch("/settings", requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    const perubahan = req.body?.settings;
    if (!perubahan || typeof perubahan !== "object") {
      return res.status(400).json({ error: "Tidak ada pengaturan yang dikirim" });
    }

    const hasil = await prisma.$transaction(async (tx) => {
      const sebelum = await getAllSettings(tx);
      for (const [key, value] of Object.entries(perubahan)) {
        if (sebelum[key] === String(value)) continue;

        // Menyalakan gerbang verifikasi MENGUNCI tanggal mulainya ke SAAT
        // INI — supaya pembayaran lama tidak pernah berubah arti secara
        // surut. Lihat komentar panjang di services/finance/allocation.js
        // #isPaymentCounted.
        if (key === SETTING_KEYS.PAYMENT_VERIFICATION_GATE && parseBool(String(value))) {
          const sudahPunyaTanggal = sebelum[SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE];
          if (!sudahPunyaTanggal) {
            await setSetting(tx, SETTING_KEYS.PAYMENT_VERIFICATION_GATE_SINCE, new Date().toISOString(), req.user.id);
          }
        }

        await setSetting(tx, key, value, req.user.id);
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.FIN_SETTING, entityId: key,
          eventType: EVENT_TYPES.FINANCE_SETTING_CHANGED, actorId: req.user.id,
          metadata: { key, from: sebelum[key], to: String(value) },
        });
      }
      return getAllSettings(tx);
    });
    res.json({ settings: hasil });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// LAPORAN
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/reports/trial-balance", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    res.json(await neracaSaldo(prisma, { from, to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/income-statement", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    res.json(await labaRugi(prisma, { from, to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/balance-sheet", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { to } = rentangDariQuery(req.query);
    res.json(await neraca(prisma, { to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/cash-flow", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    res.json(await arusKas(prisma, { from, to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/ledger/:accountId", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to } = rentangDariQuery(req.query);
    const hasil = await bukuBesar(prisma, { accountId: req.params.accountId, from, to });
    if (!hasil) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(hasil);
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/receivables", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { to } = rentangDariQuery(req.query);
    res.json(await umurPiutang(prisma, { to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

financeRouter.get("/reports/payables", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { to } = rentangDariQuery(req.query);
    res.json(await umurUtang(prisma, { to }));
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════════════

financeRouter.get("/dashboard", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    const { from, to, fromStr, toStr } = rentangDariQuery(req.query);
    const sekarang = new Date();

    const [
      kasBank, lr, piutang, utang, gate, catatan,
      pembayaranBelumVerifikasi, pengeluaranMenunggu, tagihanMenunggu, refundMenunggu,
      jurnalTerakhir,
    ] = await Promise.all([
      saldoKasBank(prisma, { to: sekarang }),
      labaRugi(prisma, { from, to }),
      umurPiutang(prisma, { to: sekarang }),
      umurUtang(prisma, { to: sekarang }),
      getVerificationGate(prisma),
      catatanLaporan(prisma),
      // Antrean verifikasi — payment yang belum punya baris verifikasi.
      prisma.payment.findMany({
        where: { cancelledAt: null, verifications: { none: {} } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true, amount: true, method: true, createdAt: true, proofPhotoUrl: true,
          order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } },
          recordedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.finExpense.count({ where: { status: "MENUNGGU_APPROVAL" } }),
      prisma.finSupplierBill.count({ where: { status: "MENUNGGU_APPROVAL" } }),
      prisma.finRefund.count({ where: { status: "MENUNGGU_APPROVAL" } }),
      prisma.finJournalEntry.findMany({
        where: { status: { in: STATUS_DIHITUNG } },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true, entryNumber: true, date: true, description: true, source: true, status: true,
          lines: { select: { debit: true } },
        },
      }),
    ]);

    const totalKas = kasBank.reduce((s, a) => s + a.saldo, 0);

    res.json({
      periode: { from: fromStr, to: toStr },
      kasBank,
      totalKas,
      labaRugi: lr.ringkasan,
      piutang: { total: piutang.total, ringkasan: piutang.ringkasan, teratas: piutang.baris.slice(0, 8) },
      utang: { total: utang.total, ringkasan: utang.ringkasan, teratas: utang.baris.slice(0, 8) },
      antrean: {
        pembayaranBelumVerifikasi: pembayaranBelumVerifikasi.map((p) => ({
          ...p,
          orderNumber: p.order?.orderNumber || null,
          customerName: p.order?.customer?.name || null,
        })),
        jumlahPembayaranBelumVerifikasi: pembayaranBelumVerifikasi.length,
        pengeluaranMenunggu,
        tagihanMenunggu,
        refundMenunggu,
      },
      // Gerbang verifikasi ditampilkan apa adanya: kalau MATI, UI harus
      // jujur bilang antrean verifikasi tidak memengaruhi status bayar di
      // CRM — bukan membiarkan orang mengira sudah begitu.
      gate,
      jurnalTerakhir: jurnalTerakhir.map((e) => ({
        ...e,
        total: moneyToNumber(sumMoney(e.lines.map((l) => l.debit))),
        lines: undefined,
      })),
      catatan,
    });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

// ═════════════════════════════════════════════════════════════════════════
// SINKRONISASI SUMBER LAMA (biaya kendaraan, iklan, gudang)
// ═════════════════════════════════════════════════════════════════════════
// Membukukan transaksi yang SUDAH tercatat di workspace lain tapi belum
// punya jurnal — karena modul finance baru dinyalakan belakangan, atau
// karena dulu gagal (rekening belum dipetakan) dan sekarang sudah bisa.
//
// IDEMPOTEN: baris yang sudah punya jurnal dilewati lewat idempotencyKey,
// jadi tombol ini aman ditekan berapa kali pun. TIDAK MENGARANG APA PUN —
// hanya membaca baris yang memang sudah ada beserta tanggal aslinya.
financeRouter.post("/sync/:sumber", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    const { sumber } = req.params;
    const sejak = /^\d{4}-\d{2}-\d{2}$/.test(req.body?.sejak || "")
      ? new Date(`${req.body.sejak}T00:00:00.000Z`)
      : null;
    const batas = Math.min(Number(req.body?.batas) || 200, 500);

    const { postVehicleExpense, postVehicleService, postAdSpend } = await import("../services/finance/posting/expense.js");
    const { postGoodsReceiptValue } = await import("../services/finance/posting/supplier.js");
    const { postMaterialIssueCost } = await import("../services/finance/posting/inventory.js");

    let diproses = 0;
    let dibukukan = 0;
    let gap = 0;

    async function jalankan(rows, fn) {
      for (const row of rows) {
        diproses++;
        // Satu transaksi PER BARIS, bukan satu transaksi untuk semuanya:
        // satu baris bermasalah tidak boleh membatalkan 199 baris lain yang
        // sudah benar.
        const hasil = await prisma.$transaction((tx) => fn(tx, row.id));
        if (hasil?.posted) dibukukan++;
        if (hasil?.gap) gap++;
      }
    }

    switch (sumber) {
      case "biaya-kendaraan": {
        const rows = await prisma.vehicleExpense.findMany({
          where: sejak ? { date: { gte: sejak } } : {},
          orderBy: { date: "asc" }, take: batas, select: { id: true },
        });
        await jalankan(rows, (tx, id) => postVehicleExpense(tx, { vehicleExpenseId: id, userId: req.user.id }));

        const servis = await prisma.vehicleService.findMany({
          where: sejak ? { date: { gte: sejak } } : {},
          orderBy: { date: "asc" }, take: batas, select: { id: true },
        });
        await jalankan(servis, (tx, id) => postVehicleService(tx, { vehicleServiceId: id, userId: req.user.id }));
        break;
      }
      case "iklan": {
        const rows = await prisma.adSpend.findMany({
          orderBy: [{ year: "asc" }, { month: "asc" }], take: batas, select: { id: true },
        });
        await jalankan(rows, (tx, id) => postAdSpend(tx, { adSpendId: id, userId: req.user.id }));
        break;
      }
      case "penerimaan-barang": {
        const rows = await prisma.goodsReceipt.findMany({
          where: { status: "COMPLETED", ...(sejak ? { receivedDate: { gte: sejak } } : {}) },
          orderBy: { createdAt: "asc" }, take: batas, select: { id: true },
        });
        await jalankan(rows, (tx, id) => postGoodsReceiptValue(tx, { goodsReceiptId: id, userId: req.user.id }));
        break;
      }
      case "pemakaian-bahan": {
        const rows = await prisma.materialIssue.findMany({
          where: { status: "ISSUED", ...(sejak ? { issuedAt: { gte: sejak } } : {}) },
          orderBy: { createdAt: "asc" }, take: batas, select: { id: true },
        });
        await jalankan(rows, (tx, id) => postMaterialIssueCost(tx, { materialIssueId: id, userId: req.user.id }));
        break;
      }
      default:
        return res.status(400).json({ error: `Sumber "${sumber}" tidak dikenal` });
    }

    res.json({ sumber, diproses, dibukukan, gap });
  } catch (err) {
    handleFinanceError(err, res);
  }
});

export default financeRouter;
