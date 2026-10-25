// HARGA BERLAKU BAHAN (HPP OPERASIONAL) — diedit dari layar Stok. Bukan nilai buku & bukan HPP final Finance (lihat services/finance/hargaBerlaku.js).
//   IZIN EKSPLISIT: lihat = finance:read · ubah/koreksi/ajukan penerapan/batalkan = finance:harga_berlaku:edit · setujui/tolak penerapan = finance:harga_berlaku:approve (FINANCE + OWNER; BUKAN semua ADMIN — keputusan Owner)
//   GET  /bahan/:id (finance:read: ringkasan + bolehUbah) · GET /bahan/:id/riwayat · POST /pratinjau (finance:read) · POST / (finance:post, Idempotency-Key, hashPratinjau)
//   Penerapan ke pemakaian LAMA (tindakan khusus, dua orang): POST /penerapan/pratinjau (finance:read) · POST /penerapan (finance:post) · GET /penerapan · GET /penerapan/:id ·
//   POST /penerapan/:id/setujui|tolak (finance:approve) · /batalkan (finance:post, pengaju) · GET /unit/:unitId (HPP operasional per unit)
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P, hasPermission } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { KoreksiError } from "../services/warehouseCorrection.js";
import { ringkasanBahan, riwayatHarga, pratinjauUbahHarga, simpanHarga, tanpaInternal, pratinjauPenerapan, tanpaInternalPenerapan, ajukanPenerapan, setujuiPenerapan, tolakPenerapan, batalkanPenerapan, daftarPenerapan, bacaPenerapan, hppOperasionalUnit } from "../services/finance/hargaBerlaku.js";

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (e, res) => { if (e instanceof KoreksiError) return res.status(e.statusCode).json({ error: e.message, code: e.code }); console.error("[harga-berlaku]", e); return res.status(500).json({ error: "Gagal memproses harga berlaku" }); };
const bahanOk = (id, res) => { if (!POLA_UUID.test(String(id ?? ""))) { res.status(400).json({ error: "bahan tidak valid", code: "BAHAN_TIDAK_VALID" }); return false; } return true; };
const idOk = (id, res) => { if (!POLA_UUID.test(String(id ?? ""))) { res.status(404).json({ error: "Tidak ditemukan" }); return false; } return true; };

export const hargaBerlakuRouter = express.Router();
hargaBerlakuRouter.use(requireAuth);
hargaBerlakuRouter.get("/bahan/:id", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!idOk(req.params.id, res)) return; res.json({ ...(await ringkasanBahan(prisma, req.params.id)), bolehUbah: hasPermission(req.user, P.FINANCE_HARGA_BERLAKU_EDIT), bolehSetujui: hasPermission(req.user, P.FINANCE_HARGA_BERLAKU_APPROVE) }); } catch (e) { err(e, res); } });
hargaBerlakuRouter.get("/bahan/:id/riwayat", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!idOk(req.params.id, res)) return; res.json({ riwayat: await riwayatHarga(prisma, req.params.id) }); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!bahanOk(req.body?.materialId, res)) return; res.json(tanpaInternal(await pratinjauUbahHarga(prisma, req.body ?? {}))); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/", requirePermission(P.FINANCE_HARGA_BERLAKU_EDIT), async (req, res) => { try { if (!bahanOk(req.body?.materialId, res)) return; const h = await simpanHarga(prisma, req.body ?? {}, { aktor: req.user, kunci: req.get("Idempotency-Key") }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { err(e, res); } });

hargaBerlakuRouter.post("/penerapan/pratinjau", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!bahanOk(req.body?.materialId, res)) return; res.json(tanpaInternalPenerapan(await pratinjauPenerapan(prisma, req.body ?? {}))); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/penerapan", requirePermission(P.FINANCE_HARGA_BERLAKU_EDIT), async (req, res) => { try { if (!bahanOk(req.body?.materialId, res)) return; const h = await ajukanPenerapan(prisma, req.body ?? {}, { aktor: req.user, kunci: req.get("Idempotency-Key") }); res.status(h.ulang ? 200 : 201).json(h); } catch (e) { err(e, res); } });
hargaBerlakuRouter.get("/penerapan", requirePermission(P.FINANCE_READ), async (req, res) => { try { res.json({ penerapan: (await daftarPenerapan(prisma, { materialId: POLA_UUID.test(String(req.query.bahanId ?? "")) ? String(req.query.bahanId) : null, status: req.query.status ? String(req.query.status) : null })).map((x) => ({ ...x, milikSaya: x.diajukanOleh === req.user.id })) }); } catch (e) { err(e, res); } });
hargaBerlakuRouter.get("/penerapan/:id", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!idOk(req.params.id, res)) return; const h = await bacaPenerapan(prisma, req.params.id); if (!h) return res.status(404).json({ error: "Penerapan tidak ditemukan" }); res.json(h); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/penerapan/:id/setujui", requirePermission(P.FINANCE_HARGA_BERLAKU_APPROVE), async (req, res) => { try { if (!idOk(req.params.id, res)) return; res.json(await setujuiPenerapan(prisma, { id: req.params.id, hashPratinjau: req.body?.hashPratinjau, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/penerapan/:id/tolak", requirePermission(P.FINANCE_HARGA_BERLAKU_APPROVE), async (req, res) => { try { if (!idOk(req.params.id, res)) return; res.json(await tolakPenerapan(prisma, { id: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { err(e, res); } });
hargaBerlakuRouter.post("/penerapan/:id/batalkan", requirePermission(P.FINANCE_HARGA_BERLAKU_EDIT), async (req, res) => { try { if (!idOk(req.params.id, res)) return; res.json(await batalkanPenerapan(prisma, { id: req.params.id, aktor: req.user, catatan: req.body?.catatan })); } catch (e) { err(e, res); } });

hargaBerlakuRouter.get("/unit/:unitId", requirePermission(P.FINANCE_READ), async (req, res) => { try { if (!idOk(req.params.unitId, res)) return; res.json(await hppOperasionalUnit(prisma, req.params.unitId)); } catch (e) { err(e, res); } });
