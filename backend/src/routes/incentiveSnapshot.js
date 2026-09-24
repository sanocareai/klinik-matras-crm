// Snapshot Insentif Driver — pembekuan untuk pembayaran (24 September
// 2026). Lihat komentar panjang di schema.prisma model IncentiveSnapshot
// untuk penjelasan alur & kenapa modul ini ADA DI SAMPING (bukan
// pengganti) GET /armada/incentive-summary (estimasi live, TETAP jalan
// apa adanya — lihat services/incentiveEngine.js).
//
// SLICE INI TIDAK memposting apa pun ke Finance (jurnal/pembayaran) —
// murni membekukan angka & bukti pendukungnya untuk alur persetujuan
// Finance review -> Owner approval.
import { adalahGalatInfraDb, kirimGalatInfraDb } from "../lib/dbInfraError.js";
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission } from "../middleware/authorize.js";
import { idempotency } from "../middleware/idempotency.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { computeIncentiveSummary, INCENTIVE_FORMULA_VERSION } from "../services/incentiveEngine.js";
import { saldoLine } from "../services/incentivePayoutEngine.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export const incentiveSnapshotRouter = express.Router();
incentiveSnapshotRouter.use(requireAuth);
incentiveSnapshotRouter.use(idempotency);

class SnapshotError extends Error {
  constructor(message, statusCode = 400) { super(message); this.statusCode = statusCode; }
}
function handleErr(err, res) {
  if (err instanceof SnapshotError) return res.status(err.statusCode).json({ error: err.message });
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message });
  if (err?.code === "P2002") {
    return res.status(409).json({
      error: "Sebagian alamat pada periode ini sudah diklaim Snapshot lain (tumpang tindih terdeteksi saat penulisan) — muat ulang lalu coba lagi.",
      code: "SNAPSHOT_OVERLAP_RACE",
    });
  }
  if (adalahGalatInfraDb(err)) return kirimGalatInfraDb(res, err, "[incentiveSnapshot]");
  if (err?.code === "P2010" && err?.meta?.code === "55P03") {
    return res.status(409).json({ error: "Aksi sedang diproses di perangkat lain. Muat ulang status lalu coba lagi." });
  }
  if (err?.code === "P2025") return res.status(404).json({ error: "Data tidak ditemukan" });
  console.error("[incentiveSnapshot]", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// Kandidat historis UnitRevision yang TIDAK BISA dibuktikan tanpa
// heuristic (investigasi read-only 24 September 2026 — lihat laporan di
// riwayat percakapan/commit). SENGAJA daftar STATIS, ditulis tangan per
// kasus yang sudah diinvestigasi — BUKAN deteksi otomatis apa pun. Dampak
// finansialnya Rp0 (job ini berbagi tanggal WIB dengan job SAH lain di
// order+driver yang sama, dedup sudah menyerapnya) — flag ini MURNI
// catatan transparansi utk Ops, TIDAK PERNAH mengubah totalAlamat/
// totalRupiah atau membuat link ke unit_revision_job_links.
const KANDIDAT_BELUM_TERVERIFIKASI = [
  {
    jobId: "7410ff7b-a476-41be-8bb3-cf5756a8d308",
    revisionId: "502368c9-bde0-4ac9-8dbb-6475a011561a",
    catatan: "Kandidat PICKUP historis UnitRevision — Menunggu konfirmasi Ops (dampak finansial Rp0, lihat investigasi 24 September 2026)",
  },
];
function tandaiKandidatBelumTerverifikasi(jobIds) {
  const cocok = KANDIDAT_BELUM_TERVERIFIKASI.filter((k) => jobIds.includes(k.jobId));
  return cocok.length ? cocok.map((k) => k.catatan) : undefined;
}

// Hari terakhir bulan (WIB, kalender) sebagai string YYYY-MM-DD — dipakai
// resolvePeriode() mode "monthly". `month` 1-12 (bukan 0-11 seperti Date).
function akhirBulanWIB(year, month) {
  const d = new Date(Date.UTC(year, month, 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Body -> {from, to} string YYYY-MM-DD INKLUSIF — dua mode sesuai spec
// ("Default periode bulanan WIB. Custom range diperbolehkan."). Dipisah
// dari computeIncentiveSummary (yang defaultnya "bulan ini SAMPAI HARI
// INI") karena Snapshot bulanan WAJIB mencakup SATU BULAN PENUH (1 sampai
// akhir bulan), bukan "sampai hari ini" — periode yang sudah lewat tidak
// boleh terpotong diam-diam.
export function resolvePeriode(body = {}) {
  const { mode } = body;
  if (mode === "custom") {
    const { from, to } = body;
    if (!from || !to) throw new SnapshotError("Custom range wajib mengisi from dan to (YYYY-MM-DD)");
    if (from > to) throw new SnapshotError("Tanggal awal tidak boleh setelah tanggal akhir");
    return { from, to };
  }
  if (mode === "monthly") {
    const { year, month } = body;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new SnapshotError("Mode monthly wajib mengisi year dan month (1-12) yang valid");
    }
    const from = `${year}-${String(month).padStart(2, "0")}-01`;
    return { from, to: akhirBulanWIB(year, month) };
  }
  throw new SnapshotError("mode wajib 'monthly' atau 'custom'");
}

// Overlap kalender (proteksi #1, lapisan PERINGATAN — bukan pemblokir
// keras, itu tugas IncentiveSourceClaim di bawah) — dua periode beririsan
// kalau from1<=to2 DAN to1>=from2. String YYYY-MM-DD terurut sama dengan
// kronologis, jadi perbandingan string apa adanya sudah benar.
async function cariOverlapKalender({ from, to }, kecualikanSnapshotId) {
  return prisma.incentiveSnapshot.findMany({
    where: {
      status: { not: "REJECTED" },
      ...(kecualikanSnapshotId && { id: { not: kecualikanSnapshotId } }),
      periodFrom: { lte: to },
      periodTo: { gte: from },
    },
    select: { id: true, periodFrom: true, periodTo: true, status: true },
  });
}

// GET /preview — READ-ONLY, tidak menulis apa pun. Dipakai Admin UI utk
// menampilkan hasil hitung SEBELUM benar-benar membuat Snapshot (spec:
// "Preview per orang sebelum dibuat").
incentiveSnapshotRouter.post("/incentive-snapshots/preview", requirePermission(P.INCENTIVE_SNAPSHOT_CREATE), async (req, res) => {
  try {
    const { from, to } = resolvePeriode(req.body);
    const hasil = await computeIncentiveSummary(prisma, { from, to });

    const semuaJobIds = hasil.orang.flatMap((o) => o.detail.flatMap((d) => d.jobIds));
    const overlapKalender = await cariOverlapKalender({ from, to }, req.body.adjustsSnapshotId);

    // Klaim yang SUDAH ada utk kombinasi (userId,orderId,tanggalWIB) yang
    // AKAN diklaim Snapshot ini — dicek terhadap SEMUA snapshot aktif
    // KECUALI yang direferensikan adjustsSnapshotId (proteksi #7: koreksi
        // boleh menyentuh ulang klaim milik snapshot yang dikoreksinya sendiri).
    const kandidatKunci = hasil.orang.flatMap((o) => o.detail.map((d) => ({ userId: o.id, orderId: d.orderId, tanggalWIB: d.date })));
    const klaimBentrok = kandidatKunci.length
      ? await prisma.incentiveSourceClaim.findMany({
          where: {
            OR: kandidatKunci.map((k) => ({ userId: k.userId, orderId: k.orderId, tanggalWIB: k.tanggalWIB })),
            ...(req.body.adjustsSnapshotId && { snapshotId: { not: req.body.adjustsSnapshotId } }),
          },
          select: { userId: true, orderId: true, tanggalWIB: true, snapshotId: true },
        })
      : [];

    const orangDenganCatatan = hasil.orang.map((o) => ({
      ...o,
      detail: o.detail.map((d) => ({
        ...d,
        kandidatBelumTerverifikasi: tandaiKandidatBelumTerverifikasi(d.jobIds),
        klaimBentrok: klaimBentrok.some((k) => k.userId === o.id && k.orderId === d.orderId && k.tanggalWIB === d.date) || undefined,
      })),
    }));

    res.json({
      periodFrom: from, periodTo: to, formulaVersion: INCENTIVE_FORMULA_VERSION,
      totalAlamat: hasil.orang.reduce((s, o) => s + o.totalAlamat, 0),
      totalRupiah: hasil.orang.reduce((s, o) => s + o.totalInsentif, 0),
      orang: orangDenganCatatan,
      peringatan: {
        overlapKalender: overlapKalender.map((s) => ({ id: s.id, periodFrom: s.periodFrom, periodTo: s.periodTo, status: s.status })),
        klaimBentrok: klaimBentrok.length,
        kandidatBelumTerverifikasi: semuaJobIds.some((id) => KANDIDAT_BELUM_TERVERIFIKASI.some((k) => k.jobId === id)),
      },
    });
  } catch (err) {
    handleErr(err, res);
  }
});

async function buatSnapshot(req, res, { adjustsSnapshotId = null } = {}) {
  const { from, to } = resolvePeriode(req.body);

  if (adjustsSnapshotId) {
    const asal = await prisma.incentiveSnapshot.findUnique({ where: { id: adjustsSnapshotId }, select: { id: true, status: true } });
    if (!asal) throw new SnapshotError("Snapshot yang ingin dikoreksi tidak ditemukan", 404);
    if (asal.status !== "APPROVED") throw new SnapshotError("Adjustment hanya boleh mereferensikan Snapshot yang SUDAH APPROVED", 409);
  }

  const hasil = await computeIncentiveSummary(prisma, { from, to });
  const totalAlamat = hasil.orang.reduce((s, o) => s + o.totalAlamat, 0);
  const totalRupiah = hasil.orang.reduce((s, o) => s + o.totalInsentif, 0);

  const snapshot = await prisma.$transaction(async (tx) => {
    const header = await tx.incentiveSnapshot.create({
      data: {
        periodFrom: from, periodTo: to, status: "DRAFT", formulaVersion: INCENTIVE_FORMULA_VERSION,
        totalAlamat, totalRupiah, computedById: req.user.id,
        ...(adjustsSnapshotId && { adjustsSnapshotId }),
      },
    });

    // Adjustment (proteksi #7): boleh menyentuh ULANG klaim milik snapshot
    // ASAL yang sedang dikoreksi — "transfer" klaim ke snapshot BARU ini
    // sebelum ditulis ulang, supaya create() di bawah tidak bentrok dengan
    // klaim MILIK SENDIRI (konflik terhadap klaim snapshot LAIN yang tidak
    // direferensikan tetap ditolak seperti biasa, lewat unique constraint).
    // IncentiveSnapshotDetail snapshot asal (histori permanen) SAMA SEKALI
    // TIDAK disentuh di sini — hanya baris klaim aktifnya yang berpindah.
    if (adjustsSnapshotId) {
      const kunciBaru = hasil.orang.flatMap((o) => o.detail.map((d) => ({ userId: o.id, orderId: d.orderId, tanggalWIB: d.date })));
      if (kunciBaru.length) {
        await tx.incentiveSourceClaim.deleteMany({ where: { snapshotId: adjustsSnapshotId, OR: kunciBaru } });
      }
    }

    for (const o of hasil.orang) {
      const line = await tx.incentiveSnapshotLine.create({
        data: {
          snapshotId: header.id, userId: o.id, userName: o.name, hasSim: o.hasSim, ratePerAlamat: o.ratePerAlamat,
          totalAlamat: o.totalAlamat, totalRupiah: o.totalInsentif, asDriver: o.asDriver, asHelper: o.asHelper,
        },
      });
      for (const d of o.detail) {
        await tx.incentiveSnapshotDetail.create({
          data: {
            snapshotId: header.id, lineId: line.id, userId: o.id, orderId: d.orderId, tanggalWIB: d.date,
            asDriver: d.asDriver, asHelper: d.asHelper, jobIds: d.jobIds,
          },
        });
        // Proteksi #1+#2 (penjaga SEBENARNYA — level database, lihat
        // komentar model IncentiveSourceClaim). Kalau baris ini sudah
        // diklaim snapshot AKTIF lain, create() melempar P2002 dan
        // SELURUH transaksi batal (atomic) — ditangkap handleErr() di
        // luar, respons 409 yang jelas, bukan snapshot setengah jadi.
        await tx.incentiveSourceClaim.create({
          data: { userId: o.id, orderId: d.orderId, tanggalWIB: d.date, snapshotId: header.id },
        });
      }
    }

    await recordActivity(tx, {
      entityType: ENTITY_TYPES.INCENTIVE_SNAPSHOT, entityId: header.id, eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_CREATED,
      actorId: req.user.id,
      metadata: { periodFrom: from, periodTo: to, totalAlamat, totalRupiah, adjustsSnapshotId: adjustsSnapshotId || undefined },
    });
    if (adjustsSnapshotId) {
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_SNAPSHOT, entityId: adjustsSnapshotId, eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_ADJUSTED,
        actorId: req.user.id,
        metadata: { adjustmentSnapshotId: header.id, reason: req.body.reason || null },
      });
    }
    return header;
  });

  const lengkap = await muatSnapshotLengkap(snapshot.id);
  res.status(201).json(lengkap);
}

// POST / — buat Snapshot BARU (DRAFT). Idempoten lewat middleware
// Idempotency-Key di atas (sama pola dengan /api/finance/*): retry dengan
// kunci+isi sama memutar ulang respons pertama, TIDAK membuat baris kedua.
incentiveSnapshotRouter.post("/incentive-snapshots", requirePermission(P.INCENTIVE_SNAPSHOT_CREATE), async (req, res) => {
  try { await buatSnapshot(req, res); } catch (err) { handleErr(err, res); }
});

// POST /:id/adjust — Snapshot BARU yang mengoreksi Snapshot :id (WAJIB
// APPROVED, proteksi #7). Body sama dengan POST / (mode/year/month atau
// from/to) — biasanya periode yang SAMA dengan snapshot asal, tapi TIDAK
// dipaksa sama supaya koreksi yang memperbaiki batas periode itu sendiri
// tetap mungkin.
incentiveSnapshotRouter.post("/incentive-snapshots/:id/adjust", requirePermission(P.INCENTIVE_SNAPSHOT_CREATE), async (req, res) => {
  try { await buatSnapshot(req, res, { adjustsSnapshotId: req.params.id }); } catch (err) { handleErr(err, res); }
});

incentiveSnapshotRouter.post("/incentive-snapshots/:id/review", requirePermission(P.INCENTIVE_SNAPSHOT_REVIEW), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"incentive_snapshots"', req.params.id);
      const s = await tx.incentiveSnapshot.findUnique({ where: { id: req.params.id } });
      if (!s) throw new SnapshotError("Snapshot tidak ditemukan", 404);
      if (s.status !== "DRAFT") throw new SnapshotError(`Snapshot berstatus ${s.status} — hanya DRAFT yang bisa direview`, 409);
      const updated = await tx.incentiveSnapshot.update({ where: { id: s.id }, data: { status: "REVIEWED", reviewedAt: new Date(), reviewedById: req.user.id } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_SNAPSHOT, entityId: s.id, eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_REVIEWED,
        actorId: req.user.id, metadata: { periodFrom: s.periodFrom, periodTo: s.periodTo },
      });
      return updated;
    });
    res.json(await muatSnapshotLengkap(hasil.id));
  } catch (err) { handleErr(err, res); }
});

incentiveSnapshotRouter.post("/incentive-snapshots/:id/approve", requirePermission(P.INCENTIVE_SNAPSHOT_APPROVE), async (req, res) => {
  try {
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"incentive_snapshots"', req.params.id);
      const s = await tx.incentiveSnapshot.findUnique({ where: { id: req.params.id } });
      if (!s) throw new SnapshotError("Snapshot tidak ditemukan", 404);
      if (s.status !== "REVIEWED") throw new SnapshotError(`Snapshot berstatus ${s.status} — hanya yang sudah REVIEWED yang bisa disetujui`, 409);
      const updated = await tx.incentiveSnapshot.update({ where: { id: s.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: req.user.id } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_SNAPSHOT, entityId: s.id, eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_APPROVED,
        actorId: req.user.id, metadata: { periodFrom: s.periodFrom, periodTo: s.periodTo, totalRupiah: s.totalRupiah },
      });
      return updated;
    });
    res.json(await muatSnapshotLengkap(hasil.id));
  } catch (err) { handleErr(err, res); }
});

// Reject boleh oleh REVIEW ATAU APPROVE (Finance ATAU Owner) — spec:
// "DRAFT/REVIEWED dapat ditolak dengan alasan", tidak menyebut satu peran
// eksklusif.
incentiveSnapshotRouter.post("/incentive-snapshots/:id/reject", requireAnyPermission(P.INCENTIVE_SNAPSHOT_REVIEW, P.INCENTIVE_SNAPSHOT_APPROVE), async (req, res) => {
  try {
    const reason = req.body?.reason?.trim();
    if (!reason) throw new SnapshotError("Alasan penolakan wajib diisi");
    const hasil = await prisma.$transaction(async (tx) => {
      await lockRowForUpdate(tx, '"incentive_snapshots"', req.params.id);
      const s = await tx.incentiveSnapshot.findUnique({ where: { id: req.params.id } });
      if (!s) throw new SnapshotError("Snapshot tidak ditemukan", 404);
      if (!["DRAFT", "REVIEWED"].includes(s.status)) throw new SnapshotError(`Snapshot berstatus ${s.status} — tidak bisa ditolak lagi`, 409);
      const updated = await tx.incentiveSnapshot.update({
        where: { id: s.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: req.user.id, rejectionReason: reason },
      });
      // Lepas klaim (proteksi #1/#2) — supaya alamat yang sama bisa
      // di-snapshot ulang di periode berikutnya setelah datanya diperbaiki.
      // IncentiveSnapshotDetail (histori permanen) TIDAK disentuh sama sekali.
      await tx.incentiveSourceClaim.deleteMany({ where: { snapshotId: s.id } });
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.INCENTIVE_SNAPSHOT, entityId: s.id, eventType: EVENT_TYPES.INCENTIVE_SNAPSHOT_REJECTED,
        actorId: req.user.id, metadata: { periodFrom: s.periodFrom, periodTo: s.periodTo, reason },
      });
      return updated;
    });
    res.json(await muatSnapshotLengkap(hasil.id));
  } catch (err) { handleErr(err, res); }
});

incentiveSnapshotRouter.get("/incentive-snapshots", requirePermission(P.INCENTIVE_SNAPSHOT_READ), async (req, res) => {
  try {
    const { status, periodFrom, periodTo, take, skip } = req.query;
    const list = await prisma.incentiveSnapshot.findMany({
      where: {
        ...(status && { status }),
        ...(periodFrom && { periodTo: { gte: periodFrom } }),
        ...(periodTo && { periodFrom: { lte: periodTo } }),
      },
      include: {
        computedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        rejectedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ periodFrom: "desc" }, { createdAt: "desc" }],
      take: take ? Number(take) : 50,
      ...(skip && { skip: Number(skip) }),
    });
    res.json({ snapshots: list });
  } catch (err) { handleErr(err, res); }
});

async function muatSnapshotLengkap(id) {
  const s = await prisma.incentiveSnapshot.findUnique({
    where: { id },
    include: {
      computedBy: { select: { id: true, name: true } },
      reviewedBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      rejectedBy: { select: { id: true, name: true } },
      adjustsSnapshot: { select: { id: true, periodFrom: true, periodTo: true, status: true } },
      adjustments: { select: { id: true, status: true, createdAt: true } },
      lines: {
        orderBy: { totalAlamat: "desc" },
        include: {
          details: { orderBy: { tanggalWIB: "desc" } },
          // Riwayat pembayaran (24 September 2026) — TERMASUK yang voided,
          // supaya detail Snapshot juga bisa menunjukkan "pernah dibayar,
          // lalu dibatalkan" secara transparan, bukan cuma angka akhir.
          payouts: { orderBy: { createdAt: "desc" }, include: { recordedBy: { select: { id: true, name: true } }, voidedBy: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!s) return null;
  return {
    ...s,
    lines: s.lines.map((l) => {
      const { dibayar, sisa, status } = saldoLine(l.totalRupiah, l.payouts);
      return {
        ...l,
        // Pembayaran DITURUNKAN dari ledger, BUKAN kolom status — lihat
        // incentivePayoutEngine.js. SENGAJA field terpisah dari totalRupiah
        // (angka DISAHKAN) supaya UI tidak pernah bisa keliru menyamakan
        // "APPROVED" dengan "sudah dibayar" (spec eksplisit).
        dibayar, sisa, statusPembayaran: status,
        details: l.details.map((d) => ({ ...d, kandidatBelumTerverifikasi: tandaiKandidatBelumTerverifikasi(d.jobIds) })),
      };
    }),
  };
}

incentiveSnapshotRouter.get("/incentive-snapshots/:id", requirePermission(P.INCENTIVE_SNAPSHOT_READ), async (req, res) => {
  try {
    const s = await muatSnapshotLengkap(req.params.id);
    if (!s) return res.status(404).json({ error: "Snapshot tidak ditemukan" });

    // "Selisih estimasi live vs snapshot" (spec Admin UI) — recompute LIVE
    // periode yang sama lewat mesin yang SAMA, tampilkan berdampingan.
    // Kalau beda (POD dikoreksi/hasSim berubah sejak snapshot dibuat),
    // frontend menandainya sebagai warning "data sudah berubah".
    const live = await computeIncentiveSummary(prisma, { from: s.periodFrom, to: s.periodTo });
    const liveTotalAlamat = live.orang.reduce((sum, o) => sum + o.totalAlamat, 0);
    const liveTotalRupiah = live.orang.reduce((sum, o) => sum + o.totalInsentif, 0);

    res.json({
      ...s,
      liveComparison: {
        totalAlamat: liveTotalAlamat, totalRupiah: liveTotalRupiah,
        berubah: liveTotalAlamat !== s.totalAlamat || liveTotalRupiah !== s.totalRupiah,
        orang: live.orang.map((o) => ({ id: o.id, name: o.name, hasSim: o.hasSim, totalAlamat: o.totalAlamat, totalInsentif: o.totalInsentif })),
      },
    });
  } catch (err) { handleErr(err, res); }
});
