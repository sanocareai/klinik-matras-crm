// ADOPSI ADMIN → PIC BAHAN → APLIKASI MESA: endpoint Order Produksi tambahan (dipasang di /api/production).
//   GET  /units/:id/adopsi            panel unit: ringkasan 3 sumbu status, status kerja manual + riwayat, rencana bahan, pemakaian aktual, riwayat perubahan
//   POST /units/:id/work-progress     catat status kerja manual (UNIT_ROUTING_WRITE); ditolak bila bukti aplikasi ada
//   GET  /material-catalog            katalog bahan per kelompok Gudang + ketersediaan jujur (UNIT_READ)
//   GET  /units/:id/material-plan     rencana bahan + revisi
//   PUT  /units/:id/material-plan     simpan/revisi rencana (UNIT_ROUTING_WRITE) — TIDAK mengurangi stok
//   GET  /work-orders/export.xlsx     ekspor Excel (.xlsx sungguhan) dengan filter yang sama dengan daftar
// Perubahan status ORDER dari Produksi memakai endpoint Sales yang SAMA (PATCH /api/orders/:id, fungsi domain ubahStatusUnitInTx) — tidak ada jalur status kedua.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { ambilKomponenLama } from "../services/productionComponentReuseService.js";
import { signEvidenceUrl } from "./productionEvidenceMedia.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { listWorkOrders, perkayaBarisUnit } from "../services/productionOrderList.js";
import { AdopsiError, ambilPemakaianAktual, ambilRencanaBahan, catatStatusKerjaManual, katalogBahan, loadAppEvidence, riwayatKerjaUnit, simpanRencanaBahan } from "../services/productionAdoptionService.js";
import { RencanaBahanError } from "../lib/domain/productionMaterialPlan.js";
import { loadRiwayatUnit } from "../services/productionRiwayatService.js";
import { buatWorkbookOrderProduksi, namaBerkasEkspor } from "../services/productionOrderExport.js";
import { MANUAL_STATUSES, WORK_STATUS, penghalangStatusOrder, tindakanBerikutnya } from "../lib/domain/productionWorkStatus.js";
import { displayStatusOfOrder } from "../lib/domain/productionDisplay.js";
import { PenerimaanError, ambilPenerimaanWorkshop, catatPenerimaanWorkshop, daftarMenungguPenerimaan, koreksiPenerimaanWorkshop, pratinjauKoreksi } from "../services/unitWorkshopReceiptService.js";
import { inspectWorkshopDefaultLocation } from "../services/productionSettingsService.js";
import { listReceivingLocations } from "../services/unitCustodyCommandService.js";

export const productionAdopsiRouter = express.Router();
productionAdopsiRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof AdopsiError || err instanceof RencanaBahanError || err instanceof PenerimaanError || (Number.isInteger(err?.statusCode) && err.code)) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.extra ? { detail: err.extra } : {}) });
  }
  console.error("Produksi adopsi error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const bolehUbah = (user) => ({
  statusOrder: hasPermission(user, P.ORDER_WRITE), // jalur Sales yang sama
  statusKerja: hasPermission(user, P.UNIT_ROUTING_WRITE),
  target: hasPermission(user, P.UNIT_ROUTING_WRITE),
  rencanaBahan: hasPermission(user, P.UNIT_ROUTING_WRITE),
  pemakaianAktual: hasPermission(user, P.UNIT_MATERIAL_WRITE),
  catatPenerimaan: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_STAGE_WRITE), // penerimaan fisik di workshop (Gudang/Produksi/Admin) — bukan aktivasi Produksi V2
  koreksiLokasiPenerimaan: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_STAGE_WRITE), // lokasi salah: siapa pun yang boleh mencatat
  koreksiBelumDiterima: hasPermission(user, P.UNIT_ROUTING_WRITE), // "ternyata belum diterima fisik": Admin/Owner/Kepala Produksi saja (mata kedua atas catatan petugas)
});
const bolehCatatPenerimaan = requireAnyPermission(P.INVENTORY_WRITE, P.UNIT_STAGE_WRITE);

productionAdopsiRouter.get("/units/:id/adopsi", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        currentStage: { select: { id: true, code: true, labelId: true, phase: true, requiresQc: true, defaultWorkCenter: { select: { id: true, code: true, name: true } } } },
        service: { select: { id: true, code: true, labelId: true, serviceLine: true } },
        order: { select: { id: true, orderNumber: true, status: true, deliveryConfirmedDate: true, statusLocked: true, statusOverrideAt: true, statusOverrideNote: true, statusOverrideBy: { select: { name: true } }, items: { select: { layananName: true }, orderBy: { sortOrder: "asc" } }, customer: { select: { id: true, name: true } }, units: { select: { id: true, unitCode: true, status: true } } } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan", code: "UNIT_TIDAK_ADA" });
    const [baris] = await perkayaBarisUnit(prisma, [unit]);
    const bukti = (await loadAppEvidence(prisma, [unit.id])).get(unit.id);
    const [riwayatKerja, rencana, aktual, run, penerimaan] = await Promise.all([
      riwayatKerjaUnit(prisma, unit.id, bukti?.firstEvidenceAt ?? null), ambilRencanaBahan(prisma, unit.id), ambilPemakaianAktual(prisma, unit.id),
      prisma.productionRun.findFirst({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
      ambilPenerimaanWorkshop(prisma, unit.id),
    ]);
    const { penerimaan: penerimaanAktif, riwayat: riwayatPenerimaan } = penerimaan;
    const riwayatDasar = (await loadRiwayatUnit(prisma, { unit: { id: unit.id, orderId: unit.orderId }, run })).slice(-60).reverse();
    // Komponen lama dari unit pelanggan (BUKAN stok): bagian terpisah di respons + masuk Riwayat dengan label sendiri
    const komponenLama = await ambilKomponenLama(prisma, unit.id, { tandaiFoto: signEvidenceUrl });
    const riwayatKomponen = komponenLama.riwayat.map((e) => ({ kind: "KOMPONEN_LAMA", sumber: "KOMPONEN_LAMA", at: e.at, actor: e.oleh, label: `Komponen lama dari unit ini (bukan stok) — ${e.kindLabel}: ${e.name} ${e.qty} ${e.uom} · ${e.outcomeLabel}${e.reason ? ` — ${e.reason}` : ""}` }));
    // Pemakaian bahan BARU yang dicatat langsung (ledger resmi) masuk Riwayat dengan label sumber + dampak stok; baris dari Material Issue sudah punya peristiwa dokumennya sendiri.
    const riwayatBahanBaru = aktual.baris.filter((b) => !b.dokumen.jenis.startsWith("Material Issue")).map((b) => ({ kind: "BAHAN_BARU", sumber: "BAHAN_BARU", at: b.tanggal, actor: b.pelaku, label: `Bahan baru dari Gudang (${b.qty < 0 ? "menambah" : "mengurangi"} stok) — ${b.nama} ${Math.abs(b.qty)} ${b.satuan} · ${b.dokumen.jenis} ${b.dokumen.nomor}` }));
    const riwayat = [...riwayatDasar.filter((e) => !String(e.kind).includes("PRODUCTION_KOMPONEN_LAMA_DICATAT")), ...riwayatKomponen, ...riwayatBahanBaru].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 100);
    // perbandingan rencana vs aktual per bahan (hanya bahan yang ada di salah satunya)
    const rencanaMap = new Map((rencana.plan?.lines ?? []).map((l) => [l.materialId, l]));
    const aktualMap = new Map(aktual.total.map((t) => [t.materialId, t]));
    const ids = [...new Set([...rencanaMap.keys(), ...aktualMap.keys()])];
    const perbandingan = ids.map((id) => { const r = rencanaMap.get(id); const a = aktualMap.get(id); return { materialId: id, kode: r?.kode ?? a?.kode, nama: r?.nama ?? a?.nama, satuan: r?.satuan ?? a?.satuan, rencana: r ? r.qty : null, aktual: a ? a.dipakai : 0 }; });
    // Status order Sales SEBENARNYA (bukan turunan status unit) + penghalang bila order tertahan di Pengambilan setelah pickup unit selesai.
    const penghalang = penghalangStatusOrder({
      orderStatus: unit.order.status, statusLocked: unit.order.statusLocked, unitStatus: unit.status,
      unitLainBelumDijemput: unit.order.units.filter((x) => x.id !== unit.id && ["AWAITING_PICKUP", "IN_TRANSIT_IN"].includes(x.status)).length,
      pengunci: { nama: unit.order.statusOverrideBy?.name ?? null, at: unit.order.statusOverrideAt, note: unit.order.statusOverrideNote },
    });
    const tampilOrder = displayStatusOfOrder(unit.order.status);
    const orderSales = {
      ...(tampilOrder ?? { key: "TIDAK_DIKETAHUI", label: String(unit.order.status), detail: null }), mentah: unit.order.status, terkunci: !!unit.order.statusLocked,
      tone: penghalang ? "orange" : ({ DIPROSES: "accent", SIAP_KIRIM: "green", TERKIRIM: "green" }[tampilOrder?.key] ?? "neutral"),
      pengunci: unit.order.statusLocked ? { nama: unit.order.statusOverrideBy?.name ?? null, at: unit.order.statusOverrideAt ?? null, note: unit.order.statusOverrideNote ?? null } : null,
    };
    const tindakan = tindakanBerikutnya({
      unitStatus: unit.status, posisi: baris.adopsi.posisi, kerja: baris.adopsi.kerja, adaTarget: !!baris.adopsi.targetSelesai,
      rencanaBahanAda: baris.adopsi.rencanaBahanAda, aktualAda: baris.adopsi.aktualBahanAda, penghalang,
    });
    res.json({
      unit: {
        id: unit.id, unitCode: unit.unitCode, status: unit.status, merk: unit.merk, ukuran: unit.ukuran, priority: unit.priority, productionDueAt: unit.productionDueAt, updatedAt: unit.updatedAt,
        layanan: (unit.order?.items || []).map((i) => i.layananName).filter(Boolean),
        order: { id: unit.order.id, orderNumber: unit.order.orderNumber, status: unit.order.status, deliveryConfirmedDate: unit.order.deliveryConfirmedDate, statusLocked: unit.order.statusLocked, customer: unit.order.customer, jumlahUnit: unit.order.units.length, unitLain: unit.order.units.filter((u) => u.id !== unit.id).map((u) => ({ id: u.id, unitCode: u.unitCode, status: u.status })) },
      },
      adopsi: { ...baris.adopsi, tindakan, orderSales, penghalang }, productionStatus: baris.productionStatus, presence: baris.presence, receivedBasisLabel: baris.receivedBasisLabel,
      kerjaManual: { riwayat: riwayatKerja, nilaiBoleh: MANUAL_STATUSES.map((k) => ({ key: k, label: WORK_STATUS[k].label })), terakhirId: riwayatKerja.length ? riwayatKerja[riwayatKerja.length - 1].id : null, dikunciAplikasi: !!bukti?.started },
      penerimaan: penerimaanAktif, riwayatPenerimaan, rencanaBahan: rencana, pemakaianAktual: aktual, komponenLama, perbandingan, riwayat,
      izin: bolehUbah(req.user),
    });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.post("/units/:id/work-progress", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await catatStatusKerjaManual(prisma, { unitId: req.params.id, status: req.body?.status, note: req.body?.note, actorId: req.user.id, expectedLatestId: req.body?.expectedLatestId });
    res.status(hasil.dicatat ? 201 : 200).json({ dicatat: hasil.dicatat, entri: hasil.entri ? { id: hasil.entri.id, status: hasil.entri.status, note: hasil.entri.note, createdAt: hasil.entri.createdAt } : null });
  } catch (err) { handleErr(err, res); }
});

// Penerimaan workshop oleh petugas (TANPA aktivasi Produksi V2 / Run / tahap / QC): catatan resmi pelaku + waktu + lokasi; idempoten per unit.
productionAdopsiRouter.post("/units/:id/penerimaan-workshop", bolehCatatPenerimaan, wajibUuid(), async (req, res) => {
  try {
    const hasil = await catatPenerimaanWorkshop(prisma, {
      unitId: req.params.id, actorId: req.user.id, locationId: req.body?.locationId || null, note: req.body?.note, fisikDiterima: req.body?.fisikDiterima === true,
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});

// Pratinjau koreksi penerimaan: penerimaan berlaku + versi (revisi) + dampak yang sudah bergantung padanya + jenis koreksi mana yang boleh. Baca-saja.
productionAdopsiRouter.get("/units/:id/penerimaan-workshop/koreksi", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json({ ...(await pratinjauKoreksi(prisma, req.params.id)), izin: { LOCATION: bolehUbah(req.user).koreksiLokasiPenerimaan, NOT_RECEIVED: bolehUbah(req.user).koreksiBelumDiterima } }); } catch (err) { handleErr(err, res); }
});

// Koreksi penerimaan (append-only; catatan asli tidak diubah). Izin per jenis: lokasi salah = pencatat penerimaan; belum diterima fisik = UNIT_ROUTING_WRITE.
productionAdopsiRouter.post("/units/:id/penerimaan-workshop/koreksi", requireAnyPermission(P.INVENTORY_WRITE, P.UNIT_STAGE_WRITE, P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const jenis = req.body?.jenis;
    const izin = bolehUbah(req.user);
    if (jenis === "NOT_RECEIVED" && !izin.koreksiBelumDiterima) return res.status(403).json({ error: "Menyatakan unit \"belum diterima fisik\" hanya untuk Admin, Owner, atau Kepala Produksi. Minta mereka menyetujui koreksinya.", code: "KOREKSI_IZIN_DITOLAK" });
    if (jenis === "LOCATION" && !izin.koreksiLokasiPenerimaan) return res.status(403).json({ error: "Akun Anda tidak boleh mengoreksi lokasi penerimaan.", code: "KOREKSI_IZIN_DITOLAK" });
    const hasil = await koreksiPenerimaanWorkshop(prisma, {
      unitId: req.params.id, actorId: req.user.id, jenis, locationId: req.body?.locationId || null, alasan: req.body?.alasan, expectedRevisi: req.body?.expectedRevisi,
      idempotencyKey: req.get("Idempotency-Key") || null,
    });
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});

// Antrean petugas Gudang: pickup selesai, belum ada bukti terima. Baca-saja.
productionAdopsiRouter.get("/penerimaan-workshop/menunggu", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json(await daftarMenungguPenerimaan(prisma, { limit: req.query.limit, q: req.query.q })); } catch (err) { handleErr(err, res); }
});

// Pilihan lokasi penerimaan + lokasi workshop bawaan Admin (tanpa menebak default).
productionAdopsiRouter.get("/penerimaan-workshop/pilihan", requirePermission(P.UNIT_READ), async (_req, res) => {
  try {
    const [lokasi, bawaan] = await Promise.all([listReceivingLocations(prisma), inspectWorkshopDefaultLocation(prisma)]);
    res.json({ lokasi, bawaan: bawaan.valid ? { id: bawaan.location.id, code: bawaan.location.code } : null, perluKonfigurasi: !bawaan.valid });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/material-catalog", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json(await katalogBahan(prisma, { q: req.query.q, kelompok: req.query.kelompok || null, limit: req.query.limit })); } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/units/:id/material-plan", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json(await ambilRencanaBahan(prisma, req.params.id)); } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.put("/units/:id/material-plan", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await simpanRencanaBahan(prisma, { unitId: req.params.id, lines: req.body?.lines, expectedRevision: req.body?.expectedRevision ?? 0, reason: req.body?.reason, actorId: req.user.id });
    res.status(hasil.disimpan ? 200 : 200).json({ ...hasil, rencana: await ambilRencanaBahan(prisma, req.params.id) });
  } catch (err) { handleErr(err, res); }
});

productionAdopsiRouter.get("/work-orders/export.xlsx", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const hasil = await listWorkOrders(prisma, req.query, { semua: true });
    const unitIds = hasil.units.map((u) => u.id);
    const buffer = await buatWorkbookOrderProduksi(prisma, { rows: hasil.units, unitIds, filter: hasil.filterDipakai, pengguna: req.user?.name ?? null });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${namaBerkasEkspor()}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(Buffer.from(buffer));
  } catch (err) { handleErr(err, res); }
});
