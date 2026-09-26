// B3.6 — Tutup Stok Periodik & Mulai Perpetual (rute). requireAuth dipasang PER RUTE (router di-mount di /api/finance).
//   GET  /persediaan-awal                        kebijakan + daftar snapshot
//   GET  /persediaan-awal/pengecualian           laporan pengecualian menjelang cutover (baca saja)
//   POST /persediaan-awal                        buat draf snapshot untuk tanggal cutover di pengaturan
//   GET  /persediaan-awal/:id                    detail + validasi (blocker/peringatan)
//   PUT  /persediaan-awal/:id/baris              isi/ganti baris (mode ganti|tambah) — hanya DRAFT
//   DELETE /persediaan-awal/:id/baris/:lineId    hapus satu baris — hanya DRAFT
//   POST /persediaan-awal/:id/periksa            pemeriksaan Finance (finance:approve) atau Gudang (inventory:write)
//   POST /persediaan-awal/:id/buka-kembali       DIPERIKSA → DRAFT (sebelum diposting)
//   POST /persediaan-awal/:id/batal              draf dibuang (tetap tersimpan sebagai DIBATALKAN)
//   GET  /persediaan-awal/:id/pratinjau          pratinjau jurnal — TIDAK menulis apa pun
//   POST /persediaan-awal/:id/posting            OWNER + PIN step-up + alasan — satu jurnal PERSEDIAAN_AWAL
//   POST /persediaan-awal/:id/balik              OWNER + PIN step-up + alasan — pembalikan resmi

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P, hasPermission, rolesOf } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { pastikanStepUp } from "../services/finance/koreksiGate.js";
import { ambilKebijakanPersediaan, CATATAN_PERIODIK } from "../services/finance/inventoryMethod.js";
import {
  PersediaanError, SUMBER_HARGA, STATUS_LABEL, AMBANG, buatDraf, isiBaris, hapusBaris, periksa, bukaKembali, batalkanDraf,
  pratinjauJurnal, postingPembuka, balikPembuka, detailSnapshot, laporanPengecualian, pembukaAktif, hariSebelum,
} from "../services/finance/persediaanAwal.js";

export const financePersediaanAwalRouter = express.Router();
const baca = [requireAuth, requireAnyPermission(P.FINANCE_READ, P.INVENTORY_READ)];
const tulis = [requireAuth, requireAnyPermission(P.FINANCE_POST, P.INVENTORY_WRITE)];

function kirimGalat(e, res) {
  if (e instanceof PersediaanError) {
    return res.status(e.statusCode).json({ error: e.message, ...(e.code ? { code: e.code } : {}), ...(e.detail ? { detail: e.detail } : {}) });
  }
  // Pelanggaran trigger immutable (P0001) dari DB: tampilkan sebagai konflik, bukan 500.
  if (/immutable|tidak boleh|tidak diizinkan|sudah final/.test(String(e?.message || "")) && /P0001|Raw query failed|PrismaClient/.test(String(e?.code || e?.name || e?.message))) {
    return res.status(409).json({ error: "Snapshot persediaan sudah terkunci dan tidak bisa diubah.", code: "SNAPSHOT_TERKUNCI" });
  }
  if (e?.code === "P2002") return res.status(409).json({ error: "Persediaan awal untuk tanggal cutover ini sudah diposting.", code: "SUDAH_ADA_PEMBUKA" });
  return handleFinanceError(e, res);
}

/** Posting & pembalikan persediaan awal = keputusan Owner (role OWNER), plus PIN step-up. */
async function pastikanOwner(req) {
  if (!rolesOf(req.user).includes("OWNER")) {
    throw new PersediaanError("Posting dan pembalikan persediaan awal hanya bisa dilakukan Owner.", 403, "BUKAN_OWNER");
  }
  await pastikanStepUp(prisma, req);
}

financePersediaanAwalRouter.get("/persediaan-awal", ...baca, async (req, res) => {
  try {
    const k = await ambilKebijakanPersediaan(prisma);
    const [daftar, aktif] = await Promise.all([
      prisma.finInventoryOpening.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      pembukaAktif(prisma, k.cutover),
    ]);
    res.json({
      kebijakan: {
        ...k, sesudahCutover: "PERPETUAL", catatanPeriodik: CATATAN_PERIODIK,
        tanggalHitung: k.cutover ? hariSebelum(k.cutover) : null, terkunci: !!aktif, pembukaAktif: aktif,
      },
      sumberHarga: SUMBER_HARGA, ambang: AMBANG,
      snapshot: daftar.map((o) => ({ ...o, statusLabel: STATUS_LABEL[o.status], cutover: o.cutoverDate.toISOString().slice(0, 10) })),
      bisa: {
        tulis: hasPermission(req.user, P.FINANCE_POST) || hasPermission(req.user, P.INVENTORY_WRITE),
        periksaFinance: hasPermission(req.user, P.FINANCE_APPROVE),
        periksaGudang: hasPermission(req.user, P.INVENTORY_WRITE),
        posting: rolesOf(req.user).includes("OWNER"),
      },
    });
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.get("/persediaan-awal/pengecualian", ...baca, async (req, res) => {
  try { res.json(await laporanPengecualian(prisma)); } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal", ...tulis, async (req, res) => {
  try {
    const o = await prisma.$transaction(async (tx) => {
      const baru = await buatDraf(tx, { userId: req.user.id, notes: req.body?.catatan });
      await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_INVENTORY_OPENING, entityId: baru.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "BUAT_DRAF", number: baru.number } });
      return baru;
    });
    res.status(201).json(o);
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.get("/persediaan-awal/:id", ...baca, async (req, res) => {
  try { res.json(await detailSnapshot(prisma, req.params.id)); } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.put("/persediaan-awal/:id/baris", ...tulis, async (req, res) => {
  try {
    const hasil = await prisma.$transaction((tx) => isiBaris(tx, { openingId: req.params.id, rows: req.body?.baris, mode: req.body?.mode === "tambah" ? "tambah" : "ganti", userId: req.user.id }), { timeout: 60_000 });
    res.json({ ...hasil, ...(await detailSnapshot(prisma, req.params.id)) });
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.delete("/persediaan-awal/:id/baris/:lineId", ...tulis, async (req, res) => {
  try {
    await prisma.$transaction((tx) => hapusBaris(tx, { openingId: req.params.id, lineId: req.params.lineId }));
    res.json(await detailSnapshot(prisma, req.params.id));
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal/:id/periksa", requireAuth, async (req, res) => {
  try {
    const peran = String(req.body?.peran || "").toUpperCase();
    const perlu = peran === "FINANCE" ? P.FINANCE_APPROVE : P.INVENTORY_WRITE;
    if (!hasPermission(req.user, perlu)) {
      return res.status(403).json({ error: peran === "FINANCE" ? "Pemeriksaan Finance butuh hak persetujuan Finance." : "Pemeriksaan Gudang butuh hak tulis Gudang.", code: "TIDAK_BERHAK" });
    }
    await prisma.$transaction(async (tx) => {
      const o = await periksa(tx, { openingId: req.params.id, peran, userId: req.user.id });
      await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_INVENTORY_OPENING, entityId: o.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: `PERIKSA_${peran}`, status: o.status, contentHash: o.contentHash } });
    });
    res.json(await detailSnapshot(prisma, req.params.id));
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal/:id/buka-kembali", requireAuth, requirePermission(P.FINANCE_APPROVE), async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const o = await bukaKembali(tx, { openingId: req.params.id });
      await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_INVENTORY_OPENING, entityId: o.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "BUKA_KEMBALI", alasan: req.body?.alasan || null } });
    });
    res.json(await detailSnapshot(prisma, req.params.id));
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal/:id/batal", ...tulis, async (req, res) => {
  try {
    await prisma.$transaction((tx) => batalkanDraf(tx, { openingId: req.params.id }));
    res.json(await detailSnapshot(prisma, req.params.id));
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.get("/persediaan-awal/:id/pratinjau", ...baca, async (req, res) => {
  try { res.json(await pratinjauJurnal(prisma, req.params.id)); } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal/:id/posting", requireAuth, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    await pastikanOwner(req);
    const alasan = String(req.body?.alasan || "").trim();
    const hasil = await prisma.$transaction(async (tx) => {
      const r = await postingPembuka(tx, { openingId: req.params.id, userId: req.user.id, reason: alasan });
      if (r.dibuat) {
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.FIN_INVENTORY_OPENING, entityId: r.opening.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
          metadata: { aksi: "POSTING", alasan, jurnal: r.entry?.entryNumber || null, nilai: String(r.opening.totalValue), penyesuaian: String(r.opening.adjustment) },
        });
      }
      return r;
    }, { timeout: 60_000 });
    res.json({ dibuat: hasil.dibuat, ...(await detailSnapshot(prisma, req.params.id)) });
  } catch (e) { kirimGalat(e, res); }
});

financePersediaanAwalRouter.post("/persediaan-awal/:id/balik", requireAuth, requirePermission(P.FINANCE_ADMIN), async (req, res) => {
  try {
    await pastikanOwner(req);
    const alasan = String(req.body?.alasan || "").trim();
    const hasil = await prisma.$transaction(async (tx) => {
      const r = await balikPembuka(tx, { openingId: req.params.id, userId: req.user.id, reason: alasan });
      if (r.dibuat) {
        await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_INVENTORY_OPENING, entityId: r.opening.id, eventType: EVENT_TYPES.JOURNAL_REVERSED, actorId: req.user.id, metadata: { aksi: "BALIK", alasan } });
      }
      return r;
    });
    res.json({ dibuat: hasil.dibuat, ...(await detailSnapshot(prisma, req.params.id)) });
  } catch (e) { kirimGalat(e, res); }
});
