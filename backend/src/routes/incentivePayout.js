// Pembayaran Insentif Driver — ledger append-only (24 September 2026).
// Lihat komentar panjang di schema.prisma model IncentivePayout dan
// services/incentivePayoutEngine.js. APPROVED di IncentiveSnapshot berarti
// "angka disahkan", BUKAN "sudah dibayar" — modul ini yang mencatat
// pembayaran SUNGGUHAN, terpisah dari alur DRAFT->REVIEWED->APPROVED.
import { adalahGalatInfraDb, kirimGalatInfraDb } from "../lib/dbInfraError.js";
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/authorize.js";
import { idempotency } from "../middleware/idempotency.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { saldoLine, statusSnapshotDariLines } from "../services/incentivePayoutEngine.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { postIncentivePayout, reverseIncentivePayout, resolveCashAccountForPayout } from "../services/finance/posting/incentivePayout.js";

export const incentivePayoutRouter = express.Router();
incentivePayoutRouter.use(requireAuth);
incentivePayoutRouter.use(idempotency);

class PayoutError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof PayoutError) return res.status(err.statusCode).json({ error: err.message });
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  if (err?.code === "P2002") {
    return res.status(409).json({ error: "Idempotency-Key ini sudah dipakai untuk pembayaran lain — muat ulang lalu coba lagi.", code: "PAYOUT_IDEMPOTENCY_CONFLICT" });
  }
  if (adalahGalatInfraDb(err)) return kirimGalatInfraDb(res, err, "[incentivePayout]");
  if (err?.code === "P2010" && err?.meta?.code === "55P03") {
    return res.status(409).json({ error: "Aksi sedang diproses di perangkat lain. Muat ulang status lalu coba lagi." });
  }
  if (err?.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("[incentivePayout]", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

const METODE_VALID = ["TRANSFER", "CASH", "OTHER"];

// GET /incentive-payouts/queue — daftar Snapshot APPROVED yang PUNYA
// kewajiban bayar (totalRupiah > 0 — spec: "Snapshot Rp0 tidak boleh
// muncul sebagai pekerjaan pembayaran Finance"), dengan progress
// dibayar/sisa per snapshot DAN per orang. Status SELALU dihitung ulang
// dari ledger (lihat incentivePayoutEngine.js), tidak pernah dari kolom
// status tersimpan.
incentivePayoutRouter.get("/incentive-payouts/queue", requirePermission(P.INCENTIVE_PAYOUT_READ), async (req, res) => {
  try {
    const snapshots = await prisma.incentiveSnapshot.findMany({
      // isTestData: false — lapisan KEDUA di atas totalRupiah>0 (lihat
      // catatan panjang di schema.prisma) — khusus utk Snapshot APPROVED
      // yang lahir dari smoke-test/administratif, bukan data nyata.
      where: { status: "APPROVED", totalRupiah: { gt: 0 }, isTestData: false },
      include: { lines: { include: { payouts: { orderBy: { createdAt: "desc" } } } } },
      orderBy: [{ periodFrom: "desc" }],
    });
    const hasil = snapshots.map((s) => {
      let totalDibayar = 0;
      const lines = s.lines.map((l) => {
        const { dibayar, sisa, status } = saldoLine(l.totalRupiah, l.payouts);
        totalDibayar += dibayar;
        return {
          id: l.id, userId: l.userId, userName: l.userName, hasSim: l.hasSim, ratePerAlamat: l.ratePerAlamat,
          totalAlamat: l.totalAlamat, totalRupiah: l.totalRupiah, dibayar, sisa, status,
        };
      });
      return {
        id: s.id, periodFrom: s.periodFrom, periodTo: s.periodTo, totalRupiah: s.totalRupiah,
        totalDibayar, totalSisa: s.totalRupiah - totalDibayar,
        progress: s.totalRupiah > 0 ? Math.round((totalDibayar / s.totalRupiah) * 1000) / 1000 : 0,
        status: statusSnapshotDariLines(lines),
        lines,
      };
    });
    res.json({ snapshots: hasil });
  } catch (err) { handleErr(err, res); }
});

// GET /incentive-payouts/cash-accounts — pilihan sumber dana untuk form
// Catat Pembayaran. Endpoint sendiri (bukan /finance/cash-accounts) karena
// peran pencatat payout belum tentu punya FINANCE_READ; tanpa saldo.
incentivePayoutRouter.get("/incentive-payouts/cash-accounts", requirePermission(P.INCENTIVE_PAYOUT_CREATE), async (req, res) => {
  try {
    const accounts = await prisma.finCashAccount.findMany({
      where: { active: true, account: { active: true, isPostable: true } },
      select: { id: true, name: true, kind: true, bankName: true, accountNumber: true },
      orderBy: { name: "asc" },
    });
    res.json({ accounts });
  } catch (err) { handleErr(err, res); }
});

// GET /incentive-payouts?snapshotLineId= — riwayat pembayaran (TERMASUK
// yang voided, untuk transparansi audit) satu baris/orang.
incentivePayoutRouter.get("/incentive-payouts", requirePermission(P.INCENTIVE_PAYOUT_READ), async (req, res) => {
  try {
    const { snapshotLineId } = req.query;
    if (!snapshotLineId) throw new PayoutError("snapshotLineId wajib diisi");
    const payouts = await prisma.incentivePayout.findMany({
      where: { snapshotLineId },
      include: {
        recordedBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
        cashAccount: { select: { id: true, name: true } },
        journalEntry: { select: { id: true, entryNumber: true } },
        voidJournalEntry: { select: { id: true, entryNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ payouts });
  } catch (err) { handleErr(err, res); }
});

// POST /incentive-payouts — catat pembayaran. Idempotency-Key WAJIB untuk
// SEMUA klien (BEDA dari default middleware yang opsional untuk web) —
// ini ledger uang sungguhan, "retry tidak boleh menggandakan pembayaran"
// adalah aturan eksplisit, bukan sekadar nice-to-have.
incentivePayoutRouter.post("/incentive-payouts", requirePermission(P.INCENTIVE_PAYOUT_CREATE), async (req, res) => {
  try {
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) throw new PayoutError("Header Idempotency-Key wajib untuk mencatat pembayaran (mencegah pembayaran ganda kalau koneksi putus)", 428);

    const { snapshotLineId, amount, method, paidAt, referenceNumber, proofUrl, note, cashAccountId } = req.body || {};
    if (!snapshotLineId) throw new PayoutError("snapshotLineId wajib diisi");
    if (!Number.isInteger(amount) || amount <= 0) throw new PayoutError("Nominal wajib bilangan bulat lebih dari 0");
    if (!METODE_VALID.includes(method)) throw new PayoutError("Metode wajib TRANSFER, CASH, atau OTHER");
    if (!paidAt || Number.isNaN(new Date(paidAt).getTime())) throw new PayoutError("Tanggal bayar wajib diisi dan valid");
    if (!cashAccountId) throw new PayoutError("Akun sumber dana (Kas/Bank) wajib dipilih");

    const payout = await prisma.$transaction(async (tx) => {
      // Kunci baris LINE (bukan payout individual) — serialisasi SEMUA
      // percobaan pembayaran untuk line yang sama, proteksi overpayment
      // pada balapan dua request (proteksi ditegaskan lewat ulang baca
      // sisaSebelum SETELAH lock didapat, bukan sebelum).
      await lockRowForUpdate(tx, '"incentive_snapshot_lines"', snapshotLineId);
      const line = await tx.incentiveSnapshotLine.findUnique({ where: { id: snapshotLineId }, include: { snapshot: true } });
      if (!line) throw new PayoutError("Baris snapshot tidak ditemukan", 404);
      // Hanya baris dari Snapshot APPROVED yang bisa dibayar (spec eksplisit
      // — DRAFT/REVIEWED/REJECTED semuanya ditolak, bukan hanya REJECTED).
      if (line.snapshot.status !== "APPROVED") {
        throw new PayoutError(`Snapshot berstatus ${line.snapshot.status} — hanya baris dari Snapshot yang sudah APPROVED yang bisa dibayar`, 409);
      }

      const cashAccount = await resolveCashAccountForPayout(tx, cashAccountId);

      const payoutsSebelum = await tx.incentivePayout.findMany({ where: { snapshotLineId } });
      const { sisa: sisaSebelum } = saldoLine(line.totalRupiah, payoutsSebelum);
      if (amount > sisaSebelum) {
        throw new PayoutError(`Nominal Rp${amount.toLocaleString("id-ID")} melebihi sisa Rp${sisaSebelum.toLocaleString("id-ID")} — tidak boleh overpayment`, 409);
      }

      const hasil = await tx.incentivePayout.create({
        data: {
          snapshotId: line.snapshotId, snapshotLineId, userId: line.userId, amount, method,
          paidAt: new Date(paidAt), referenceNumber: referenceNumber?.trim() || null, proofUrl: proofUrl?.trim() || null,
          note: note?.trim() || null, recordedById: req.user.id, idempotencyKey: String(idempotencyKey),
          cashAccountId: cashAccount.id,
        },
      });

      // Jurnal double-entry di transaksi YANG SAMA — gagal posting (akun
      // beban belum ada, periode tutup, rekening nonaktif) = payout batal.
      const { entry } = await postIncentivePayout(tx, { payout: hasil, cashAccount, personName: line.userName, userId: req.user.id });
      const withJournal = await tx.incentivePayout.update({ where: { id: hasil.id }, data: { journalEntryId: entry.id } });

      const sisaSesudah = sisaSebelum - amount;
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_PAYOUT, entityId: hasil.id, eventType: EVENT_TYPES.INCENTIVE_PAYOUT_CREATED,
        actorId: req.user.id,
        metadata: {
          snapshotId: line.snapshotId, snapshotLineId, userId: line.userId, amount, method,
          referenceNumber: referenceNumber?.trim() || null, sisaSebelum, sisaSesudah,
          cashAccountId: cashAccount.id, journalEntryId: entry.id, journalEntryNumber: entry.entryNumber,
        },
      });
      return withJournal;
    });

    res.status(201).json(payout);
  } catch (err) { handleErr(err, res); }
});

// POST /incentive-payouts/:id/void — batalkan pembayaran yang salah catat.
// TIDAK menghapus baris (append-only) — saldo line otomatis pulih begitu
// baris ini dikecualikan dari SUM (lihat saldoLine()).
incentivePayoutRouter.post("/incentive-payouts/:id/void", requirePermission(P.INCENTIVE_PAYOUT_VOID), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw new PayoutError("Alasan pembatalan wajib diisi");

    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"incentive_payouts"', req.params.id);
      const payout = await tx.incentivePayout.findUnique({ where: { id: req.params.id } });
      if (!payout) throw new PayoutError("Pembayaran tidak ditemukan", 404);
      if (payout.voidedAt) throw new PayoutError("Pembayaran ini sudah dibatalkan sebelumnya", 409);

      // Reversal jurnal lebih dulu (payout lama tanpa jurnal — sebelum
      // integrasi Finance — tidak punya apa-apa untuk dibalik).
      let reversal = null;
      if (payout.journalEntryId) {
        reversal = await reverseIncentivePayout(tx, { journalEntryId: payout.journalEntryId, reason, userId: req.user.id });
      }
      const updated = await tx.incentivePayout.update({
        where: { id: payout.id },
        data: { voidedAt: new Date(), voidedById: req.user.id, voidReason: reason, voidJournalEntryId: reversal?.id ?? null },
      });

      const line = await tx.incentiveSnapshotLine.findUnique({ where: { id: payout.snapshotLineId } });
      const payoutsLainValid = await tx.incentivePayout.findMany({ where: { snapshotLineId: payout.snapshotLineId, id: { not: payout.id } } });
      const { sisa: sisaSesudah } = saldoLine(line.totalRupiah, payoutsLainValid);
      const sisaSebelum = sisaSesudah - payout.amount;

      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_PAYOUT, entityId: payout.id, eventType: EVENT_TYPES.INCENTIVE_PAYOUT_VOIDED,
        actorId: req.user.id,
        metadata: {
          snapshotId: payout.snapshotId, snapshotLineId: payout.snapshotLineId, userId: payout.userId,
          amount: payout.amount, method: payout.method, reason, sisaSebelum, sisaSesudah,
          journalEntryId: payout.journalEntryId, voidJournalEntryId: reversal?.id ?? null,
        },
      });
      return updated;
    });

    res.json(hasil);
  } catch (err) { handleErr(err, res); }
});
