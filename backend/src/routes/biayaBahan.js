// JEJAK BIAYA BAHAN PER UNIT — read-model baca-saja (services/finance/biayaBahan.js). Dua pintu, satu sumber data:
//   • GET /api/units/:id/jejak-bahan            — Unit 360 (Produksi/Gudang/Finance: unit:material:write | inventory:read | finance:read). Nominal HANYA muncul bila pengguna punya finance:read; selain itu kuantitas & status saja.
//   • GET /api/finance/biaya-bahan/unit[/:id]   — Finance (finance:read), daftar unit + detail.
// Tidak ada rute tulis: stok keluar hanya lewat Material Issue/Gudang, dan pembekuan nilai terjadi di dalam postStockMovement.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { bacaJejakUnit, daftarUnitBiaya } from "../services/finance/biayaBahan.js";
import { bacaJejakPO, bacaJejakPenerimaan } from "../services/finance/biayaBahanSumber.js";
import { koreksiValuasiPergerakan, riwayatKoreksiValuasi } from "../services/finance/koreksiValuasi.js";
import { KoreksiError } from "../services/warehouseCorrection.js";
import { daftarBahanTanpaHarga, pratinjauPenetapan, ajukanPenetapan, setujuiPenetapan, tolakPenetapan, batalkanPenetapan, daftarPenetapan, bacaPenetapan, tanpaInternal } from "../services/finance/penetapanNilai.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function galat(err, res) {
  console.error("[biaya-bahan]", err);
  res.status(500).json({ error: "Gagal membaca jejak biaya bahan" });
}

export const jejakBahanUnitRouter = express.Router();
jejakBahanUnitRouter.use(requireAuth);
// Hanya peran yang memang menangani bahan (Produksi: unit:material:write, Gudang: inventory:read) atau Finance — Sales (unit:read) tidak melihat jejak bahan/PO/supplier.
jejakBahanUnitRouter.get("/:id/jejak-bahan", requireAnyPermission(P.UNIT_MATERIAL_WRITE, P.INVENTORY_READ, P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Unit tidak ditemukan" });
    const hasil = await bacaJejakUnit(prisma, req.params.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) });
    if (!hasil) return res.status(404).json({ error: "Unit tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});

export const biayaBahanFinanceRouter = express.Router();
biayaBahanFinanceRouter.use(requireAuth);
biayaBahanFinanceRouter.get("/unit", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    res.json({ units: await daftarUnitBiaya(prisma, { q: String(req.query.q ?? "").trim().slice(0, 60) }) });
  } catch (e) { galat(e, res); }
});
biayaBahanFinanceRouter.get("/unit/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Unit tidak ditemukan" });
    const hasil = await bacaJejakUnit(prisma, req.params.id, { izinHarga: true });
    if (!hasil) return res.status(404).json({ error: "Unit tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});

// KOREKSI HARGA pergerakan (terpisah dari koreksi jumlah). Valuasi asli tidak diubah; koreksi = baris baru (sebelum–sesudah, alasan, pelaku, waktu). Tidak menulis jurnal/stok.
// POST /api/finance/biaya-bahan/pergerakan/:id/koreksi-harga { hargaBaru, alasan } + Idempotency-Key — izin finance:post.
biayaBahanFinanceRouter.post("/pergerakan/:id/koreksi-harga", requirePermission(P.FINANCE_POST), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Pergerakan tidak ditemukan" });
    const hasil = await koreksiValuasiPergerakan(prisma, { movementId: req.params.id, hargaBaru: req.body?.hargaBaru, alasan: req.body?.alasan, kunci: req.get("Idempotency-Key"), aktor: req.user });
    res.status(hasil.ulang ? 200 : 201).json(hasil);
  } catch (e) { if (e instanceof KoreksiError) return res.status(e.statusCode).json({ error: e.message, code: e.code }); galat(e, res); }
});
biayaBahanFinanceRouter.get("/pergerakan/:id/koreksi-harga", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Pergerakan tidak ditemukan" });
    res.json({ riwayat: await riwayatKoreksiValuasi(prisma, req.params.id) });
  } catch (e) { galat(e, res); }
});

// PENETAPAN NILAI RESMI BAHAN (Stok → Bahan tanpa harga). Harga TIDAK diketik: server menerapkan nilai dari Persediaan Awal + GR per tanggal pemakaian. Dua orang; hash pratinjau; tanpa stok/catatan/jurnal.
//   GET  /harga-bukti/bahan-tanpa-harga · POST /harga-bukti/pratinjau { materialId, groups? } (finance:read) · POST /harga-bukti (finance:post, Idempotency-Key, hashPratinjau)
//   GET  /harga-bukti[?bahanId&status] · GET /harga-bukti/:id · POST /harga-bukti/:id/setujui|tolak (finance:approve) · /batalkan (finance:post, pengaju)
const errHB = (e, res) => { if (e instanceof KoreksiError) return res.status(e.statusCode).json({ error: e.message, code: e.code }); return galat(e, res); };
const bahanOk = (req, res) => { if (!POLA_UUID.test(String(req.body?.materialId ?? ""))) { res.status(400).json({ error: "bahan tidak valid", code: "BAHAN_TIDAK_VALID" }); return false; } return true; };
biayaBahanFinanceRouter.get("/harga-bukti/bahan-tanpa-harga", requirePermission(P.FINANCE_READ), async (req, res) => { try { res.json({ bahan: await daftarBahanTanpaHarga(prisma, { q: String(req.query.q ?? "").trim().slice(0, 60) }) }); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.post("/harga-bukti/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!bahanOk(req, res)) return; res.json(tanpaInternal(await pratinjauPenetapan(prisma, req.body ?? {}))); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.post("/harga-bukti", requirePermission(P.FINANCE_POST), async (req, res) => { try { if (!bahanOk(req, res)) return; const h = await ajukanPenetapan(prisma, req.body ?? {}, { aktor: req.user, kunci: req.get("Idempotency-Key") }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.get("/harga-bukti", requirePermission(P.FINANCE_READ), async (req, res) => { try { res.json({ penetapan: await daftarPenetapan(prisma, { materialId: POLA_UUID.test(String(req.query.bahanId ?? "")) ? String(req.query.bahanId) : null, status: req.query.status ? String(req.query.status) : null }) }); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.get("/harga-bukti/:id", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Penetapan tidak ditemukan" }); const h = await bacaPenetapan(prisma, req.params.id); if (!h) return res.status(404).json({ error: "Penetapan tidak ditemukan" }); res.json(h); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.post("/harga-bukti/:id/setujui", requirePermission(P.FINANCE_APPROVE), async (req, res) => { try { if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Penetapan tidak ditemukan" }); res.json(await setujuiPenetapan(prisma, { id: req.params.id, hashPratinjau: req.body?.hashPratinjau, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.post("/harga-bukti/:id/tolak", requirePermission(P.FINANCE_APPROVE), async (req, res) => { try { if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Penetapan tidak ditemukan" }); res.json(await tolakPenetapan(prisma, { id: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { errHB(e, res); } });
biayaBahanFinanceRouter.post("/harga-bukti/:id/batalkan", requirePermission(P.FINANCE_POST), async (req, res) => { try { if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Penetapan tidak ditemukan" }); res.json(await batalkanPenetapan(prisma, { id: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { errHB(e, res); } });

// Panel "Jejak Biaya Bahan" pada PO (Finance): nilai diterima, dipakai Produksi, retur, waste, selisih harga faktur, sampai ke unit.
biayaBahanFinanceRouter.get("/po/:id", requirePermission(P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "PO tidak ditemukan" });
    const hasil = await bacaJejakPO(prisma, req.params.id, { izinHarga: true });
    if (!hasil) return res.status(404).json({ error: "PO tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});

// Progres penerimaan di Gudang: Diterima → Diperiksa → Simpan ke Stok → Dipakai Produksi / Tersisa. Harga hanya untuk yang punya finance:read.
export const jejakPenerimaanRouter = express.Router();
jejakPenerimaanRouter.use(requireAuth);
jejakPenerimaanRouter.get("/:id/jejak-pemakaian", requireAnyPermission(P.INVENTORY_READ, P.FINANCE_READ), async (req, res) => {
  try {
    if (!POLA_UUID.test(req.params.id)) return res.status(404).json({ error: "Penerimaan tidak ditemukan" });
    const hasil = await bacaJejakPenerimaan(prisma, req.params.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) });
    if (!hasil) return res.status(404).json({ error: "Penerimaan tidak ditemukan" });
    res.json(hasil);
  } catch (e) { galat(e, res); }
});
