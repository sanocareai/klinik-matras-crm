// ADOPSI ADMIN → PIC BAHAN → APLIKASI MESA: endpoint Order Produksi tambahan (dipasang di /api/production).
//   GET  /units/:id/adopsi            panel unit: ringkasan 3 sumbu status, status kerja manual + riwayat, rencana bahan, pemakaian aktual, riwayat perubahan
//   POST /units/:id/work-progress     catat status kerja manual (UNIT_ROUTING_WRITE); ditolak bila bukti aplikasi ada
//   GET  /material-catalog            katalog bahan per kelompok Gudang + ketersediaan jujur (UNIT_READ)
//   GET  /units/:id/material-plan     rencana bahan + revisi
//   PUT  /units/:id/material-plan     simpan/revisi rencana (UNIT_ROUTING_WRITE) — TIDAK mengurangi stok
//   GET  /work-orders/export.xlsx     ekspor Excel (.xlsx sungguhan) dengan filter yang sama dengan daftar
//   GET  /material-duplicates         periksa nama/kode kembar sebelum mengusulkan bahan (UNIT_MATERIAL_WRITE | INVENTORY_READ)
//   POST /material-proposals          usulkan bahan katalog baru (UNIT_MATERIAL_WRITE) — HANYA baris usulan, bukan stok
//   GET  /material-proposals          antrean usulan untuk Gudang (UNIT_MATERIAL_WRITE | INVENTORY_READ)
//   POST /material-proposals/:id/decision   Gudang menyetujui / menggabung / menolak (INVENTORY_WRITE)
//   POST /units/:id/provisional-usages      catat pemakaian sementara (bahan belum di katalog; BUKAN Material Issue) (UNIT_MATERIAL_WRITE)
//   GET  /provisional-usages                antrean rekonsiliasi Gudang
//   POST /provisional-usages/:id/correct    koreksi beralasan (lama dibatalkan + baru menunjuk ke lama)  |  POST .../cancel  batalkan salah input   |  GET .../candidates  pergerakan resmi yang bisa ditautkan
//   POST /provisional-usages/:id/reconcile  Gudang: tautkan ke pengeluaran resmi / bukan stok Gudang (INVENTORY_WRITE) — tidak menulis stok
// Perubahan status ORDER dari Produksi memakai endpoint Sales yang SAMA (PATCH /api/orders/:id, fungsi domain ubahStatusUnitInTx) — tidak ada jalur status kedua.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { ambilKomponenLama } from "../services/productionComponentReuseService.js";
import { signEvidenceUrl } from "./productionEvidenceMedia.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { hitungKelengkapanDaftar, listWorkOrders, perkayaBarisUnit } from "../services/productionOrderList.js";
import { ambilPernyataanUnit, cabutPernyataanTanpaBahan, nyatakanTanpaBahanBaru } from "../services/unitMaterialDeclarationService.js";
import { AdopsiError, ambilPemakaianAktual, ambilRencanaBahan, catatStatusKerjaManual, katalogBahan, loadAppEvidence, riwayatKerjaUnit, simpanRencanaBahan } from "../services/productionAdoptionService.js";
import { RencanaBahanError } from "../lib/domain/productionMaterialPlan.js";
import { BahanUsulanError } from "../lib/domain/bahanUsulan.js";
import { ajukanBahanBaru, cekKembarBahan, daftarUsulan, putuskanUsulan } from "../services/materialProposalService.js";
import { ambilPemakaianSementaraUnit, batalkanPemakaianSementara, catatPemakaianSementara, daftarPemakaianSementara, kandidatPergerakan, koreksiPemakaianSementara, rekonsiliasiPemakaianSementara } from "../services/unitProvisionalUsageService.js";
import { loadRiwayatUnit } from "../services/productionRiwayatService.js";
import { ambilCatatanHistoris, riwayatCatatanUnit } from "../services/catatanPemakaianHistoris.js";
import { riwayatKoreksiPemakaian, daftarKoreksiPemakaian } from "../services/koreksiPemakaian.js";
import { koreksiSaldoUnit, riwayatKoreksiSaldo } from "../services/asalKoreksiSaldo.js";
import { bacaJejakUnit } from "../services/finance/biayaBahan.js";
import { buatWorkbookOrderProduksi, namaBerkasEkspor } from "../services/productionOrderExport.js";
import { MANUAL_STATUSES, WORK_STATUS, penghalangStatusOrder, tindakanBerikutnya } from "../lib/domain/productionWorkStatus.js";
import { displayStatusOfOrder } from "../lib/domain/productionDisplay.js";
import { PenerimaanError, ambilPenerimaanWorkshop, catatPenerimaanWorkshop, daftarMenungguPenerimaan, koreksiPenerimaanWorkshop, pratinjauKoreksi } from "../services/unitWorkshopReceiptService.js";
import { inspectWorkshopDefaultLocation } from "../services/productionSettingsService.js";
import { listReceivingLocations } from "../services/unitCustodyCommandService.js";

export const productionAdopsiRouter = express.Router();
productionAdopsiRouter.use(requireAuth);

function handleErr(err, res) {
  if (err instanceof AdopsiError || err instanceof RencanaBahanError || err instanceof BahanUsulanError || err instanceof PenerimaanError || (Number.isInteger(err?.statusCode) && err.code)) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code, ...(err.extra ? { detail: err.extra } : {}) });
  }
  console.error("Produksi adopsi error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const bolehUbah = (user) => ({
  catatanHistoris: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_MATERIAL_WRITE), // koreksi catatan historis / ajukan koreksi pemakaian (penyetuju terpisah: inventory:adjustment_approve)
  koreksiSetuju: hasPermission(user, P.INVENTORY_ADJUSTMENT_APPROVE), // setujui/tolak koreksi pemakaian (pemohon tidak boleh menyetujui sendiri — dijaga server)
  statusOrder: hasPermission(user, P.ORDER_WRITE), // jalur Sales yang sama
  statusKerja: hasPermission(user, P.UNIT_ROUTING_WRITE),
  target: hasPermission(user, P.UNIT_ROUTING_WRITE),
  rencanaBahan: hasPermission(user, P.UNIT_ROUTING_WRITE),
  pemakaianAktual: hasPermission(user, P.UNIT_MATERIAL_WRITE),
  pernyataanTanpaBahan: hasPermission(user, P.UNIT_ROUTING_WRITE), // menyatakan unit tanpa bahan baru (eksplisit, dapat diaudit)
  usulBahan: hasPermission(user, P.UNIT_MATERIAL_WRITE), // tombol "Bahan belum ada?" — hanya mengajukan usulan (bukan stok)
  catatPemakaianSementara: hasPermission(user, P.UNIT_MATERIAL_WRITE),
  putuskanUsulan: hasPermission(user, P.INVENTORY_WRITE), // Gudang: setujui/gabung/tolak usulan + rekonsiliasi pemakaian sementara
  catatPenerimaan: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_STAGE_WRITE), // penerimaan fisik di workshop (Gudang/Produksi/Admin) — bukan aktivasi Produksi V2
  koreksiLokasiPenerimaan: hasPermission(user, P.INVENTORY_WRITE) || hasPermission(user, P.UNIT_STAGE_WRITE), // lokasi salah: siapa pun yang boleh mencatat
  koreksiBelumDiterima: hasPermission(user, P.UNIT_ROUTING_WRITE), // "ternyata belum diterima fisik": Admin/Owner/Kepala Produksi saja (mata kedua atas catatan petugas)
});
const bolehCatatPenerimaan = requireAnyPermission(P.INVENTORY_WRITE, P.UNIT_STAGE_WRITE);
const bolehLihatUsulan = requireAnyPermission(P.UNIT_MATERIAL_WRITE, P.INVENTORY_READ, P.INVENTORY_WRITE);

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
    const [riwayatKerja, rencana, aktual, run, penerimaan, sementara] = await Promise.all([
      riwayatKerjaUnit(prisma, unit.id, bukti?.firstEvidenceAt ?? null), ambilRencanaBahan(prisma, unit.id), ambilPemakaianAktual(prisma, unit.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) || hasPermission(req.user, P.UNIT_MATERIAL_WRITE) }),
      prisma.productionRun.findFirst({ where: { unitId: unit.id }, orderBy: { createdAt: "desc" }, select: { id: true } }),
      ambilPenerimaanWorkshop(prisma, unit.id), ambilPemakaianSementaraUnit(prisma, unit.id),
    ]);
    // Catatan pemakaian historis (Excel Admin Sales): tampil walau belum/tidak menjadi pengeluaran stok; TIDAK dijumlahkan ke "Pemakaian aktual" dan tidak mengubah status kerja.
    const [catatanHistoris, riwayatCatatan, riwayatKoreksi, koreksiMenunggu, koreksiSaldo, jejakBiaya] = await Promise.all([
      ambilCatatanHistoris(prisma, unit.id), riwayatCatatanUnit(prisma, unit.id), riwayatKoreksiPemakaian(prisma, unit.id), daftarKoreksiPemakaian(prisma, { status: "PENDING_APPROVAL", unitId: unit.id }), koreksiSaldoUnit(prisma, unit.id),
      bacaJejakUnit(prisma, unit.id, { izinHarga: hasPermission(req.user, P.FINANCE_READ) }),
    ]);
    const riwayatHistoris = [...riwayatCatatan, ...riwayatKoreksi, ...riwayatKoreksiSaldo(koreksiSaldo)];
    // gap dikelompokkan per jenis (bukan satu baris per pergerakan) supaya terbaca
    const gapRingkas = jejakBiaya ? [...new Map(jejakBiaya.belumFinal.filter((g) => g.jenis !== "FAKTUR_BELUM_ADA").map((g) => [g.jenis, { jenis: g.jenis, jumlah: 0, pesan: g.pesan }])).values()].map((g) => ({ ...g, jumlah: jejakBiaya.belumFinal.filter((x) => x.jenis === g.jenis).length })) : [];
    const hppBahan = jejakBiaya && {
      status: jejakBiaya.statusBiaya, parsial: jejakBiaya.ringkasan.parsial, final: !jejakBiaya.ringkasan.parsial && jejakBiaya.statusBiaya === "FINAL_MENURUT_HARGA_PO",
      nilaiTerhitung: jejakBiaya.ringkasan.biayaPersediaan?.nilai ?? null, lihatNilai: hasPermission(req.user, P.FINANCE_READ),
      gap: gapRingkas,
      catatan: jejakBiaya.ringkasan.parsial ? "Nilai di atas hanya bagian yang sudah pasti. Bukan HPP final — lihat gap." : null,
    };
    const { penerimaan: penerimaanAktif, riwayat: riwayatPenerimaan } = penerimaan;
    const riwayatDasar = (await loadRiwayatUnit(prisma, { unit: { id: unit.id, orderId: unit.orderId }, run })).slice(-60).reverse();
    // Komponen lama dari unit pelanggan (BUKAN stok): bagian terpisah di respons + masuk Riwayat dengan label sendiri
    const komponenLama = await ambilKomponenLama(prisma, unit.id, { tandaiFoto: signEvidenceUrl });
    const riwayatKomponen = komponenLama.riwayat.map((e) => ({ kind: "KOMPONEN_LAMA", sumber: "KOMPONEN_LAMA", at: e.at, actor: e.oleh, label: `Komponen lama dari unit ini (bukan stok) — ${e.kindLabel}: ${e.name} ${e.qty} ${e.uom} · ${e.outcomeLabel}${e.reason ? ` — ${e.reason}` : ""}` }));
    // Pemakaian bahan BARU yang dicatat langsung (ledger resmi) masuk Riwayat dengan label sumber + dampak stok; baris dari Material Issue sudah punya peristiwa dokumennya sendiri.
    const riwayatBahanBaru = aktual.baris.filter((b) => !b.dokumen.jenis.startsWith("Material Issue")).map((b) => ({ kind: "BAHAN_BARU", sumber: "BAHAN_BARU", at: b.tanggal, actor: b.pelaku, label: `Bahan baru dari Gudang (${b.qty < 0 ? "menambah" : "mengurangi"} stok) — ${b.nama} ${Math.abs(b.qty)} ${b.satuan} · ${b.dokumen.jenis} ${b.dokumen.nomor}` }));
    // Peristiwa status kerja OTOMATIS: pemakaian aktual PERTAMA yang berhasil tercatat (bahan baru ISSUE atau komponen lama 'dipakai kembali'). Diturunkan dari fakta (tidak ada baris status terpisah) → tidak pernah ganda,
    // dan koreksi/pembatalan tidak menghapusnya karena baris asal tetap ada.
    const pakaiBaru = aktual.baris.filter((b) => b.tipe === "ISSUE").map((b) => ({ at: b.tanggal, oleh: b.pelaku, apa: `bahan baru ${b.nama} ${b.qty} ${b.satuan}` }));
    const pakaiLama = komponenLama.riwayat.filter((e) => e.outcome === "REUSED" && ["CREATED", "CORRECTED"].includes(e.kind)).map((e) => ({ at: e.at, oleh: e.oleh, apa: `komponen lama ${e.name} ${e.qty} ${e.uom}` }));
    // Pemakaian SEMENTARA (bahan belum di katalog): dihitung sebagai bukti pekerjaan, tetapi dengan label sumber sendiri dan selalu ditandai perlu rekonsiliasi Gudang (bukan Material Issue; tanpa saldo/biaya/jurnal).
    const pakaiSementara = sementara.items.filter((i) => i.status !== "DIBATALKAN").map((i) => ({ at: i.usedAt, oleh: i.oleh, apa: `pemakaian sementara ${i.name} ${i.qty} ${i.uom} (perlu rekonsiliasi Gudang)` }));
    const riwayatSementara = sementara.items.flatMap((i) => [
      { kind: "PEMAKAIAN_SEMENTARA", sumber: "PEMAKAIAN_SEMENTARA", at: i.recordedAt, actor: i.oleh, label: `Pemakaian sementara (perlu rekonsiliasi Gudang, bukan Material Issue; saldo tidak berubah) — ${i.name} ${i.qty} ${i.uom}${i.originNote ? ` · asal: ${i.originNote}` : ""}${i.tertautKatalog ? ` · bahan katalog ${i.bahanKatalog?.kode ?? ""} (stok belum diketahui)` : ""}${i.hasilKoreksi ? " · hasil koreksi" : ""}` },
      ...(i.status === "DIREKONSILIASI" ? [{ kind: "PEMAKAIAN_SEMENTARA", sumber: "PEMAKAIAN_SEMENTARA", at: i.diselesaikanAt, actor: i.diselesaikanOleh, label: `Pemakaian sementara ${i.name} ${i.resolusi === "TAUTKAN_ISSUE" ? "ditautkan ke pengeluaran stok resmi (tidak membuat pergerakan baru)" : `dinyatakan bukan stok Gudang${i.catatanPenyelesaian ? ` — ${i.catatanPenyelesaian}` : ""}`}` }] : []),
      ...(i.status === "DIBATALKAN" ? [{ kind: "PEMAKAIAN_SEMENTARA", sumber: "PEMAKAIAN_SEMENTARA", at: i.dibatalkanAt, actor: i.dibatalkanOleh, label: i.dikoreksi ? `Pemakaian sementara ${i.name} dikoreksi (diganti catatan baru) — ${String(i.alasanBatal).replace(/^Dikoreksi:\s*/, "")}` : `Pemakaian sementara ${i.name} dibatalkan (salah input) — ${i.alasanBatal}` }] : []),
    ]);
    const pertama = [...pakaiBaru, ...pakaiLama, ...pakaiSementara].sort((a, b) => new Date(a.at) - new Date(b.at))[0] ?? null;
    const riwayatStatusOtomatis = pertama && unit.status !== "CANCELLED" ? [{ kind: "STATUS_KERJA_OTOMATIS", sumber: "PEMAKAIAN_BAHAN", at: pertama.at, actor: pertama.oleh, label: `Status kerja administratif → Sudah dikerjakan (otomatis dari pemakaian aktual pertama: ${pertama.apa})` }] : [];
    const riwayat = [...riwayatDasar.filter((e) => !String(e.kind).includes("PRODUCTION_KOMPONEN_LAMA_DICATAT")), ...riwayatKomponen, ...riwayatBahanBaru, ...riwayatSementara, ...riwayatHistoris, ...riwayatStatusOtomatis].sort((x, y) => new Date(y.at) - new Date(x.at)).slice(0, 100);
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
      penerimaan: penerimaanAktif, riwayatPenerimaan, rencanaBahan: rencana, pemakaianAktual: aktual, pemakaianSementara: sementara, catatanHistoris, koreksiSaldo, koreksiMenunggu: koreksiMenunggu.map((k) => ({ ...k, milikSaya: k.pemohon?.id === req.user.id })), hppBahan, komponenLama, perbandingan, riwayat,
      izin: bolehUbah(req.user), pernyataanTanpaBahan: await ambilPernyataanUnit(prisma, unit.id),
    });
  } catch (err) { handleErr(err, res); }
});

// Hitungan penyaring kelengkapan (Bahan belum dicatat · Bahan perlu dicek · HPP belum lengkap · Data order kurang) untuk filter yang sedang aktif. Seluruh unit yang cocok, bukan halaman yang dimuat. BACA-SAJA.
productionAdopsiRouter.get("/work-orders/kelengkapan-hitung", requirePermission(P.UNIT_READ), async (req, res) => {
  try { res.json(await hitungKelengkapanDaftar(prisma, req.query)); } catch (err) { handleErr(err, res); }
});

// Pernyataan "tanpa bahan baru" per unit (eksplisit, dapat diaudit; bukan tebakan). Izin = UNIT_ROUTING_WRITE (Admin/Owner/Kepala Produksi): menyatakan ABSENNYA bahan adalah keputusan Admin.
productionAdopsiRouter.get("/units/:id/pernyataan-tanpa-bahan", requirePermission(P.UNIT_READ), wajibUuid(), async (req, res) => {
  try { res.json(await ambilPernyataanUnit(prisma, req.params.id)); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/units/:id/pernyataan-tanpa-bahan", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await nyatakanTanpaBahanBaru(prisma, { unitId: req.params.id, alasan: req.body?.alasan, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || null });
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/units/:id/pernyataan-tanpa-bahan/cabut", requirePermission(P.UNIT_ROUTING_WRITE), wajibUuid(), async (req, res) => {
  try { res.json(await cabutPernyataanTanpaBahan(prisma, { unitId: req.params.id, alasan: req.body?.alasan, actorId: req.user.id })); } catch (err) { handleErr(err, res); }
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

// ───────────────────────── Usulan bahan katalog & pemakaian sementara (UX Bahan) ─────────────────────────
productionAdopsiRouter.get("/material-duplicates", bolehLihatUsulan, async (req, res) => {
  try { res.json(await cekKembarBahan(prisma, { name: req.query.name, code: req.query.code || null })); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/material-proposals", requirePermission(P.UNIT_MATERIAL_WRITE), async (req, res) => {
  try {
    const hasil = await ajukanBahanBaru(prisma, { input: req.body, actorId: req.user.id, konfirmasiBedaDariKandidat: req.body?.konfirmasiBeda === true });
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.get("/material-proposals", bolehLihatUsulan, async (req, res) => {
  try { res.json({ ...(await daftarUsulan(prisma, { status: req.query.status || null, q: req.query.q, limit: req.query.limit })), izin: { putuskan: hasPermission(req.user, P.INVENTORY_WRITE) } }); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/material-proposals/:id/decision", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try { const hasil = await putuskanUsulan(prisma, { proposalId: req.params.id, input: req.body, actorId: req.user.id }); res.status(hasil.replayed ? 200 : 201).json(hasil); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/units/:id/provisional-usages", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try {
    const hasil = await catatPemakaianSementara(prisma, { unitId: req.params.id, input: req.body, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || null });
    res.status(hasil.replayed ? 200 : 201).json(hasil);
  } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.get("/provisional-usages", bolehLihatUsulan, async (req, res) => {
  try { res.json({ ...(await daftarPemakaianSementara(prisma, { status: req.query.status === "SEMUA" ? null : (req.query.status || "PERLU_REKONSILIASI"), q: req.query.q, limit: req.query.limit })), izin: { rekonsiliasi: hasPermission(req.user, P.INVENTORY_WRITE) } }); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/provisional-usages/:id/cancel", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try { const hasil = await batalkanPemakaianSementara(prisma, { usageId: req.params.id, alasan: req.body?.alasan, actorId: req.user.id, bolehSemua: hasPermission(req.user, P.INVENTORY_WRITE) }); res.status(hasil.replayed ? 200 : 201).json(hasil); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/provisional-usages/:id/correct", requirePermission(P.UNIT_MATERIAL_WRITE), wajibUuid(), async (req, res) => {
  try { const hasil = await koreksiPemakaianSementara(prisma, { usageId: req.params.id, input: req.body, alasan: req.body?.alasan, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || null }); res.status(hasil.replayed ? 200 : 201).json(hasil); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.get("/provisional-usages/:id/candidates", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try { res.json(await kandidatPergerakan(prisma, req.params.id)); } catch (err) { handleErr(err, res); }
});
productionAdopsiRouter.post("/provisional-usages/:id/reconcile", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try { const hasil = await rekonsiliasiPemakaianSementara(prisma, { usageId: req.params.id, input: req.body, actorId: req.user.id }); res.status(hasil.replayed ? 200 : 201).json(hasil); } catch (err) { handleErr(err, res); }
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
