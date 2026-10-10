// RETUR SUPPLIER & DEBIT NOTE — dua pintu atas data yang SAMA (services/finance/returSupplier.js), status identik:
//
//  GUDANG  /api/inventory/retur-supplier   (inventory:read / inventory:write) — kondisi & pergerakan fisik; TANPA nilai rupiah.
//    GET  /                         daftar retur            GET  /:id                detail
//    GET  /kandidat/:poId           baris penerimaan yang bisa diretur (kapasitas + alasan blokir)
//    POST /pratinjau                pratinjau server (tanpa menulis)
//    POST /                         buat draf retur         POST /bukti              unggah foto kondisi/penyerahan
//    POST /:id/keluar               konfirmasi barang KELUAR gudang (menulis stok + jurnal, satu transaksi)
//    POST /:id/batal                batalkan retur (draf, atau barang kembali ke stok bila belum ada debit note disetujui)
//  FINANCE /api/finance/retur-supplier     (finance:read / post / approve / admin) — nilai, debit note, saldo kredit.
//    GET /, /:id, /kandidat/:poId, POST /pratinjau, POST / (draf), POST /:id/batal (hanya draf), POST /bukti
//    GET /debit-note, GET /debit-note/:id/pratinjau, POST /debit-note/:id/setujui, POST /debit-note/:id/batal (finance:admin), POST /:id/debit-note (buat ulang)
//    GET /kredit, GET /kredit/:id/pratinjau?billId=&jumlah=, POST /kredit/:id/terapkan (pilih faktur + konfirmasi), POST /kredit-pemakaian/:id/batal (finance:admin)
// Semua perintah tulis: Idempotency-Key WAJIB, alasan/izin/pratinjau server, audit; aktor/peran/workspace dari sesi. TIDAK ada PIN. TIDAK ada refund kas otomatis.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { idempotency, wajibIdempotencyKey } from "../middleware/idempotency.js";
import { requirePermission, PERMISSIONS as P, rolesOf } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { handleFinanceError } from "./finance.js";
import { terimaBukti } from "./barangAkanDatang.js";
import {
  aktorDariSesi, ambilRetur, batalkanDebitNote, batalkanPemakaianKredit, batalkanRetur, buatDebitNoteUlang, buatRetur, daftarRetur, kandidatRetur, keluarkanBarang,
  pratinjauDebitNote, pratinjauPemakaianKredit, pratinjauRetur, ringkasKredit, setujuiDebitNote, terapkanSaldoKredit, WORKSPACE, ReturError,
} from "../services/finance/returSupplier.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v) => POLA_UUID.test(String(v ?? ""));

function galat(err, res) {
  if (err instanceof ReturError) return res.status(err.statusCode).json({ error: err.message, ...(err.code && { code: err.code }), ...(err.detail && { detail: err.detail }) });
  if (err?.name === "LedgerError" || typeof err?.statusCode === "number") {
    if (err.name === "LedgerError" || err.statusCode) return res.status(err.statusCode ?? 409).json({ error: err.message, ...(err.code && typeof err.code === "string" && { code: err.code }) });
  }
  return handleFinanceError(err, res);
}
const tx = (fn) => prisma.$transaction(fn, { timeout: 30_000, maxWait: 10_000 });

function pasang(router, { workspace, finance }) {
  const baca = finance ? P.FINANCE_READ : P.INVENTORY_READ;
  const tulis = finance ? P.FINANCE_POST : P.INVENTORY_WRITE;
  const aktor = (req) => aktorDariSesi(req.user, workspace, rolesOf(req.user));

  router.get("/", requirePermission(baca), async (req, res) => {
    try { res.json({ retur: await daftarRetur(prisma, { status: req.query.status || null, supplierId: uuid(req.query.supplierId) ? req.query.supplierId : null, purchaseOrderId: uuid(req.query.purchaseOrderId) ? req.query.purchaseOrderId : null, q: req.query.q || null, finance }) }); } catch (e) { galat(e, res); }
  });
  router.get("/kandidat/:poId", requirePermission(baca), async (req, res) => {
    try {
      if (!uuid(req.params.poId)) return res.status(404).json({ error: "PO tidak ditemukan" });
      res.json({ baris: await kandidatRetur(prisma, req.params.poId, { finance }) });
    } catch (e) { galat(e, res); }
  });
  router.post("/pratinjau", requirePermission(baca), async (req, res) => {
    try { res.json(await pratinjauRetur(prisma, req.body ?? {}, { finance })); } catch (e) { galat(e, res); }
  });
  router.post("/bukti", requirePermission(tulis), terimaBukti);
  router.post("/", requirePermission(tulis), wajibIdempotencyKey, async (req, res) => {
    try {
      const hasil = await tx((t) => buatRetur(t, { masukan: req.body, aktor: aktor(req) }));
      res.status(201).json({ ...hasil, retur: await ambilRetur(prisma, hasil.returnId, { finance }) });
    } catch (e) { galat(e, res); }
  });
  router.get("/:id", requirePermission(baca), async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Retur tidak ditemukan" });
      const r = await ambilRetur(prisma, req.params.id, { finance });
      if (!r) return res.status(404).json({ error: "Retur tidak ditemukan" });
      res.json(r);
    } catch (e) { galat(e, res); }
  });
  router.post("/:id/batal", requirePermission(tulis), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Retur tidak ditemukan" });
      if (finance) {
        const r = await prisma.supplierReturn.findUnique({ where: { id: req.params.id }, select: { status: true } });
        if (r && r.status !== "DRAFT") return res.status(403).json({ error: "Barang sudah keluar — pembatalan mengembalikan barang ke stok dan dikerjakan Gudang. Finance hanya bisa membatalkan draf.", code: "BATAL_OLEH_GUDANG" });
      }
      const hasil = await tx((t) => batalkanRetur(t, { returnId: req.params.id, alasan: req.body?.reason, aktor: aktor(req) }));
      res.json({ ...hasil, retur: await ambilRetur(prisma, hasil.returnId, { finance }) });
    } catch (e) { galat(e, res); }
  });

  if (!finance) {
    router.post("/:id/keluar", requirePermission(P.INVENTORY_WRITE), wajibIdempotencyKey, async (req, res) => {
      try {
        if (!uuid(req.params.id)) return res.status(404).json({ error: "Retur tidak ditemukan" });
        const hasil = await tx((t) => keluarkanBarang(t, { returnId: req.params.id, masukan: req.body, aktor: aktor(req) }));
        res.json({ ...hasil, retur: await ambilRetur(prisma, hasil.returnId, { finance: false }) });
      } catch (e) { galat(e, res); }
    });
    return;
  }

  // ── Finance saja: debit note & saldo kredit
  router.get("/debit-note/daftar", requirePermission(P.FINANCE_READ), async (req, res) => {
    try {
      const rows = await prisma.finSupplierDebitNote.findMany({ where: { ...(req.query.status && { status: String(req.query.status) }) }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true } });
      const hasil = [];
      for (const r of rows) hasil.push(await pratinjauDebitNote(prisma, r.id));
      res.json({ debitNote: hasil });
    } catch (e) { galat(e, res); }
  });
  router.get("/debit-note/:id/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Debit note tidak ditemukan" });
      res.json(await pratinjauDebitNote(prisma, req.params.id));
    } catch (e) { galat(e, res); }
  });
  router.post("/debit-note/:id/setujui", requirePermission(P.FINANCE_APPROVE), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Debit note tidak ditemukan" });
      const hasil = await tx((t) => setujuiDebitNote(t, { debitNoteId: req.params.id, catatan: req.body?.note, sisaDiharapkan: req.body?.kurangiSisaDiharapkan, aktor: aktor(req) }));
      res.json({ ...hasil, debitNote: await pratinjauDebitNote(prisma, hasil.debitNoteId) });
    } catch (e) { galat(e, res); }
  });
  router.post("/debit-note/:id/batal", requirePermission(P.FINANCE_ADMIN), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Debit note tidak ditemukan" });
      const hasil = await tx((t) => batalkanDebitNote(t, { debitNoteId: req.params.id, alasan: req.body?.reason, aktor: aktor(req) }));
      res.json({ ...hasil, debitNote: await pratinjauDebitNote(prisma, hasil.debitNoteId) });
    } catch (e) { galat(e, res); }
  });
  router.post("/:id/debit-note", requirePermission(P.FINANCE_POST), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Retur tidak ditemukan" });
      const hasil = await tx((t) => buatDebitNoteUlang(t, { returnId: req.params.id, aktor: aktor(req) }));
      res.status(201).json({ ...hasil, debitNote: await pratinjauDebitNote(prisma, hasil.debitNoteId) });
    } catch (e) { galat(e, res); }
  });
  router.get("/kredit/daftar", requirePermission(P.FINANCE_READ), async (req, res) => {
    try { res.json({ kredit: await ringkasKredit(prisma, { supplierId: uuid(req.query.supplierId) ? req.query.supplierId : null }) }); } catch (e) { galat(e, res); }
  });
  router.get("/kredit/:id/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Saldo kredit tidak ditemukan" });
      res.json(await pratinjauPemakaianKredit(prisma, { creditId: req.params.id, billId: uuid(req.query.billId) ? req.query.billId : null, jumlah: req.query.jumlah ?? null }));
    } catch (e) { galat(e, res); }
  });
  router.post("/kredit/:id/terapkan", requirePermission(P.FINANCE_APPROVE), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id) || !uuid(req.body?.billId)) return res.status(404).json({ error: "Saldo kredit atau faktur tidak ditemukan" });
      const hasil = await tx((t) => terapkanSaldoKredit(t, { creditId: req.params.id, billId: req.body.billId, jumlah: req.body?.jumlah, konfirmasi: req.body?.konfirmasi, sisaFakturDilihat: req.body?.sisaFakturDilihat, catatan: req.body?.note, aktor: aktor(req) }));
      res.status(201).json(hasil);
    } catch (e) { galat(e, res); }
  });
  router.post("/kredit-pemakaian/:id/batal", requirePermission(P.FINANCE_ADMIN), wajibIdempotencyKey, async (req, res) => {
    try {
      if (!uuid(req.params.id)) return res.status(404).json({ error: "Pemakaian tidak ditemukan" });
      res.json(await tx((t) => batalkanPemakaianKredit(t, { applicationId: req.params.id, alasan: req.body?.reason, aktor: aktor(req) })));
    } catch (e) { galat(e, res); }
  });
}

export const returSupplierGudangRouter = express.Router();
returSupplierGudangRouter.use(requireAuth);
returSupplierGudangRouter.use(idempotency);

export const returSupplierFinanceRouter = express.Router();
returSupplierFinanceRouter.use(requireAuth);
returSupplierFinanceRouter.use(idempotency);

// URUTAN: rute literal Finance (debit-note/*, kredit/*) didaftarkan SEBELUM "/:id" — pasang() mendaftarkan "/:id" lebih dulu bila tidak dijaga, jadi finance dipasang manual:
pasang(returSupplierGudangRouter, { workspace: WORKSPACE.GUDANG, finance: false });
pasang(returSupplierFinanceRouter, { workspace: WORKSPACE.FINANCE, finance: true });
