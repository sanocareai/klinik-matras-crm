// B3 — Rekonsiliasi Cutoff & Late-Posting Guard (rute).
//   POST /bank-statements/:id/snapshot              buat snapshot immutable (sekali per periode; panggilan ulang = snapshot yang sama)
//   GET  /bank-statements/:id/cutoff                snapshot tersimpan + Posting Setelah Cutoff + Reversal + Penyesuaian + saldo sekarang + exception
//   POST /bank-statements/:id/snapshot/verifikasi   verifikasi integritas penuh (hitung ulang hash himpunan jurnal <= high-water mark)
//   POST /bank-statements/:id/snapshot/tidak-berlaku  nyatakan snapshot tidak berlaku (alasan wajib; hanya sekali)
//   GET  /bank-statements/:id/ekspor-audit          ringkasan audit CSV TANPA data sensitif (tanpa nama/keterangan/dokumen)
//   GET  /rekon/perlu-ditinjau                      exception dokumen/jurnal (deteksi saja)
//   POST /rekon/perlu-ditinjau/tinjau               tandai exception sudah ditinjau (catatan wajib) — data tidak diubah
// requireAuth dipasang PER RUTE (router di-mount di /api/finance bersama router lain — lihat catatan di financeKoreksi.js).

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import {
  buatSnapshot, pandanganCutoff, verifikasiIntegritas, daftarException, tinjauException, RekonError,
} from "../services/finance/rekonSnapshot.js";

export const financeRekonCutoffRouter = express.Router();
const baca = [requireAuth, requirePermission(P.FINANCE_READ)];
const admin = [requireAuth, requirePermission(P.FINANCE_ADMIN)];

async function ambilStatement(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new RekonError("Periode rekonsiliasi tidak ditemukan", 404);
  const s = await prisma.finBankStatement.findUnique({ where: { id }, include: { snapshot: true, cashAccount: { select: { id: true, name: true } } } });
  if (!s) throw new RekonError("Periode rekonsiliasi tidak ditemukan", 404);
  return s;
}

financeRekonCutoffRouter.post("/bank-statements/:id/snapshot", ...admin, async (req, res) => {
  try {
    const b = req.body || {};
    const { snapshot, dibuat } = await prisma.$transaction((tx) => buatSnapshot(tx, {
      statementId: req.params.id, hwmAt: b.hwmAt || null, confirmedAt: b.confirmedAt || null,
      confirmedSource: b.confirmedSource, explanation: b.explanation, userId: req.user.id,
    }));
    if (dibuat) {
      await recordActivity(prisma, {
        entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: req.params.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
        metadata: { label: "Snapshot rekonsiliasi dibuat", hwmAt: snapshot.hwmAt, hwmEntryNumber: snapshot.hwmEntryNumber, entryHash: snapshot.entryHash },
      });
    }
    const s = await ambilStatement(req.params.id);
    res.status(dibuat ? 201 : 200).json({ dibuat, ...(await pandanganCutoff(prisma, s.snapshot, { closingBank: s.closingBalance })) });
  } catch (e) { handleFinanceError(e, res); }
});

financeRekonCutoffRouter.get("/bank-statements/:id/cutoff", ...baca, async (req, res) => {
  try {
    const s = await ambilStatement(req.params.id);
    const exc = await daftarException(prisma, { cashAccountId: s.cashAccountId });
    const pandangan = s.snapshot ? await pandanganCutoff(prisma, s.snapshot, { closingBank: s.closingBalance }) : null;
    res.json({
      periode: { id: s.id, rekening: s.cashAccount, periodStart: s.periodStart, periodEnd: s.periodEnd, status: s.status },
      adaSnapshot: !!s.snapshot, ...(pandangan || {}), perluDitinjau: exc,
      catatanWaktu: "Tanggal buku, waktu jurnal dibuat, cutoff mutasi bank, waktu konfirmasi saldo, waktu snapshot, dan high-water mark adalah enam hal berbeda.",
    });
  } catch (e) { handleFinanceError(e, res); }
});

financeRekonCutoffRouter.post("/bank-statements/:id/snapshot/verifikasi", ...baca, async (req, res) => {
  try {
    const s = await ambilStatement(req.params.id);
    if (!s.snapshot) throw new RekonError("Periode ini belum punya snapshot", 409);
    res.json(await verifikasiIntegritas(prisma, s.snapshot));
  } catch (e) { handleFinanceError(e, res); }
});

financeRekonCutoffRouter.post("/bank-statements/:id/snapshot/tidak-berlaku", ...admin, async (req, res) => {
  try {
    const alasan = req.body?.reason?.trim();
    if (!alasan) throw new RekonError("Alasan wajib diisi");
    const s = await ambilStatement(req.params.id);
    if (!s.snapshot) throw new RekonError("Periode ini belum punya snapshot", 409);
    if (s.status === "SELESAI") throw new RekonError("Periode sudah selesai — snapshot-nya tidak bisa dinyatakan tidak berlaku", 409);
    if (s.snapshot.invalidatedAt) throw new RekonError("Snapshot ini sudah dinyatakan tidak berlaku", 409);
    await prisma.finReconSnapshot.update({ where: { id: s.snapshot.id }, data: { invalidatedAt: new Date(), invalidatedById: req.user.id, invalidReason: alasan } });
    await recordActivity(prisma, {
      entityType: ENTITY_TYPES.FIN_BANK_STATEMENT, entityId: s.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
      metadata: { label: "Snapshot rekonsiliasi dinyatakan tidak berlaku", reason: alasan },
    });
    res.json({ ok: true });
  } catch (e) { handleFinanceError(e, res); }
});

const csv = (v) => { const t = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

financeRekonCutoffRouter.get("/bank-statements/:id/ekspor-audit", ...baca, async (req, res) => {
  try {
    const s = await ambilStatement(req.params.id);
    const baris = [["bagian", "kunci", "nilai"]];
    const tambah = (b, k, v) => baris.push([b, k, v]);
    tambah("periode", "rekening", s.cashAccount.name);
    tambah("periode", "tanggal_buku", `${s.periodStart.toISOString().slice(0, 10)} s.d. ${s.periodEnd.toISOString().slice(0, 10)}`);
    tambah("periode", "status", s.status);
    if (s.snapshot) {
      const p = await pandanganCutoff(prisma, s.snapshot, { closingBank: s.closingBalance });
      const sn = p.snapshot;
      for (const [k, v] of Object.entries({
        cutoff_mulai: sn.cutoffStartAt?.toISOString?.() ?? sn.cutoffStartAt, cutoff_akhir: sn.cutoffEndAt?.toISOString?.() ?? sn.cutoffEndAt,
        konfirmasi_saldo: sn.confirmedAt?.toISOString?.() ?? sn.confirmedAt, snapshot_dibuat: new Date(sn.snapshotAt).toISOString(),
        high_water_mark: new Date(sn.hwmAt).toISOString(), jurnal_hwm: sn.hwmEntryNumber, jumlah_jurnal: sn.entryCount, hash_jurnal: sn.entryHash,
        saldo_awal_bank: sn.saldoAwalBank, saldo_akhir_bank: sn.saldoAkhirBank, saldo_buku_snapshot: sn.saldoBuku, selisih_snapshot: sn.selisih,
      })) tambah("snapshot", k, v);
      for (const [k, v] of Object.entries(p.ringkasanSetelahSnapshot)) { tambah("setelah_snapshot", `${k}_jumlah`, v.jumlah); tambah("setelah_snapshot", `${k}_total`, v.total); }
      tambah("sekarang", "saldo_buku", p.saldoBukuSekarang);
      tambah("sekarang", "selisih", p.selisihSekarang);
      tambah("sekarang", "identitas_konsisten", p.identitas.konsisten ? "ya" : "tidak");
      tambah("sekarang", "snapshot_berlaku", p.valid ? "ya" : "tidak");
    } else tambah("snapshot", "ada", "tidak");
    const exc = await daftarException(prisma, { cashAccountId: s.cashAccountId });
    const perKode = {};
    for (const i of exc.items) { const k = `${i.kode}_${i.ditinjau ? "ditinjau" : "terbuka"}`; perKode[k] = (perKode[k] || 0) + 1; }
    for (const [k, v] of Object.entries(perKode)) tambah("perlu_ditinjau", k, v);
    tambah("perlu_ditinjau", "terbuka_total", exc.terbuka);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-rekon-${s.periodEnd.toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${baris.map((r) => r.map(csv).join(",")).join("\n")}\n`);
  } catch (e) { handleFinanceError(e, res); }
});

financeRekonCutoffRouter.get("/rekon/perlu-ditinjau", ...baca, async (req, res) => {
  try { res.json(await daftarException(prisma, { cashAccountId: req.query.cashAccountId || null })); } catch (e) { handleFinanceError(e, res); }
});

financeRekonCutoffRouter.post("/rekon/perlu-ditinjau/tinjau", ...admin, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await tinjauException(prisma, { kode: b.kode, refId: b.refId, catatan: b.catatan, userId: req.user.id });
    res.json({ ok: true, ditinjau: { pada: r.reviewedAt, catatan: r.note } });
  } catch (e) { handleFinanceError(e, res); }
});
