// PEMAKAIAN SEMENTARA (Okt 2026, UX Bahan): bahan yang SUDAH dipakai pada unit tetapi belum ada di katalog / belum punya sumber stok resmi.
//   • BUKAN Material Issue dan BUKAN pergerakan stok: tidak mengurangi saldo, tidak membuat biaya bahan, tidak ada jurnal. Hanya fakta + penanda "Perlu rekonsiliasi Gudang".
//   • Tidak ada jalur stok paralel: Gudang menyelesaikannya lewat jalur resmi yang SUDAH ada (Material Issue / pemakaian unit) lalu MENAUTKAN pergerakannya (satu pergerakan hanya untuk satu catatan),
//     atau menyatakan bukan stok Gudang (alasan wajib). Kolom asal tidak pernah berubah (trigger DB); catatan tidak dihapus — salah input = DIBATALKAN dengan alasan.
//   • Bahan yang SUDAH ada di katalog ditolak di sini (pakai pemakaian resmi) supaya jalur ini tidak menjadi jalan pintas stok — SATU pengecualian sempit: bahan katalog yang stoknya BENAR-BENAR BELUM DIKETAHUI
//     (tidak punya satu pun pergerakan stok → pemakaian resmi pasti ditolak ledger "tersedia 0"). Itu dicatat lewat materialId (tertaut ke ID katalog, bukan nama): jumlah, satuan (= satuan katalog), asal barang, alasan, unit, pelaku, waktu.
//     Bahan yang saldonya DIKETAHUI (termasuk tidak cukup/minus) tetap ditolak (BAHAN_STOK_DIKETAHUI): keputusan terpisah. Tetap bukan Material Issue/pergerakan/saldo/biaya/jurnal.
import { lockRowForUpdate } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { AWAL_CATATAN_KATALOG, BahanUsulanError, CATATAN_SEMENTARA, RESOLUSI, STATUS_SEMENTARA, adaKembarSama, cariKembar, kunciValid, normalisasiPemakaianSementara, normalisasiRekonsiliasi, qtySama, selisihQty, susunCatatanKatalog, kunciNama } from "../lib/domain/bahanUsulan.js";

/** Baris tertaut ke bahan KATALOG yang stoknya belum diketahui: materialId terisi SAAT DICATAT (jalur biasa tidak pernah mengisinya; hanya rekonsiliasi TAUTKAN_ISSUE, yang selalu punya stockMovementId). */
const tertautKatalogRow = (r) => !!r.materialId && !r.proposalId && (!r.stockMovementId || String(r.note ?? "").startsWith(AWAL_CATATAN_KATALOG));

const INACTIVE = ["CANCELLED", "DELIVERED"];

async function namaPelaku(db, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}
const refPergerakan = (m) => (m ? (m.materialIssue?.issueNumber ? `Material Issue ${m.materialIssue.issueNumber}` : `MV-${m.id.slice(0, 8).toUpperCase()}`) : null);

const tampil = (r, nama, extra = {}) => ({
  id: r.id, unitId: r.unitId, name: r.name, qty: Number(r.qty), uom: r.uom, originNote: r.originNote, note: r.note, usedAt: r.usedAt, recordedAt: r.recordedAt, oleh: nama.get(r.recordedById) ?? null,
  status: r.status, statusLabel: STATUS_SEMENTARA[r.status] ?? r.status, perluRekonsiliasi: r.status === "PERLU_REKONSILIASI",
  proposalId: r.proposalId, resolusi: r.resolution, resolusiLabel: r.resolution ? RESOLUSI[r.resolution] : null, materialId: r.materialId, stockMovementId: r.stockMovementId,
  diselesaikanOleh: r.resolvedById ? nama.get(r.resolvedById) ?? null : null, diselesaikanAt: r.resolvedAt, catatanPenyelesaian: r.resolutionNote,
  dibatalkanOleh: r.cancelledById ? nama.get(r.cancelledById) ?? null : null, dibatalkanAt: r.cancelledAt, alasanBatal: r.cancelReason,
  correctedFromId: r.correctedFromId ?? null, hasilKoreksi: !!r.correctedFromId, dikoreksi: r.status === "DIBATALKAN" && String(r.cancelReason ?? "").startsWith("Dikoreksi:"),
  // Tertaut ke bahan KATALOG dengan stok belum diketahui (materialId diisi saat DICATAT, bukan hanya saat rekonsiliasi): bahan = ID katalog, bukan nama. Diisi hanya bila baris dimuat bersama relasi material.
  tertautKatalog: tertautKatalogRow(r),
  bahanKatalog: r.material && tertautKatalogRow(r) ? { id: r.material.id, kode: r.material.code, nama: r.material.name, satuan: r.material.unit } : null,
  dampakStok: "Tidak ada saldo/biaya/jurnal sampai Gudang menyelesaikan sumber stok lewat jalur resmi.", ...extra,
});

async function unitAktif(tx, unitId) {
  await lockRowForUpdate(tx, "units", unitId);
  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
  if (!unit) throw new BahanUsulanError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
  if (INACTIVE.includes(unit.status)) throw new BahanUsulanError(`Unit ${unit.unitCode} sudah ${unit.status === "CANCELLED" ? "dibatalkan" : "terkirim"}; pemakaian sementara tidak dicatat lagi.`, "UNIT_TIDAK_AKTIF", 409);
  return unit;
}

/** Catat fakta pemakaian sementara. Idempoten per (unit, kunci): klik ganda/retry tidak menggandakan. */
export async function catatPemakaianSementara(prisma, { unitId, input, actorId, idempotencyKey }) {
  const kunci = kunciValid(idempotencyKey); const data = normalisasiPemakaianSementara(input);
  return prisma.$transaction(async (tx) => {
    const unit = await unitAktif(tx, unitId);
    // Bentuk (b): bahan katalog, stok belum diketahui. Nama, satuan, dan catatan baku diturunkan dari KATALOG (bukan dari klien) supaya tertaut ke ID yang benar.
    let bahan = null;
    if (data.materialId) {
      bahan = await tx.material.findUnique({ where: { id: data.materialId }, select: { id: true, code: true, name: true, unit: true, active: true, kind: true } });
      if (!bahan) throw new BahanUsulanError("Bahan katalog tidak ditemukan.", "BAHAN_TIDAK_ADA", 404);
      data.name = bahan.name; data.nameKey = kunciNama(bahan.name);
      data.note = susunCatatanKatalog({ kode: bahan.code, alasan: data.alasan, catatan: data.note ?? "" });
    }
    const ada = await tx.unitProvisionalUsage.findFirst({ where: { unitId, idempotencyKey: kunci }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } });
    if (ada) {
      const sama = ada.name === data.name && Number(ada.qty) === data.qty && ada.uom === data.uom && (ada.originNote ?? null) === data.originNote && (ada.note ?? null) === data.note && (ada.proposalId ?? null) === data.proposalId && (ada.materialId ?? null) === data.materialId;
      if (!sama) throw new BahanUsulanError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda.", "IDEMPOTENCY_KEY_REUSED", 409);
      return { replayed: true, item: tampil(ada, await namaPelaku(tx, [ada.recordedById])), catatan: CATATAN_SEMENTARA };
    }
    if (data.materialId) {
      if (!bahan.active || bahan.kind === "PERLENGKAPAN_STOK") throw new BahanUsulanError("Bahan ini tidak aktif atau bukan bahan produksi; tidak bisa dicatat sementara.", "BAHAN_TIDAK_AKTIF", 409);
      if (bahan.unit !== data.uom) throw new BahanUsulanError(`Satuan harus sama dengan satuan katalog (${bahan.unit}).`, "SEMENTARA_SATUAN_INVALID", 400);
      // Kunci baris bahan (sama dengan pengunci ledger) lalu hitung pergerakan: stok "belum diketahui" = TIDAK ADA satu pun pergerakan. Bila ada (saldo diketahui, termasuk kurang/minus) → jalur resmi, bukan di sini.
      await lockRowForUpdate(tx, "materials", bahan.id);
      const jumlahPergerakan = await tx.stockMovement.count({ where: { materialId: bahan.id } });
      if (jumlahPergerakan > 0) throw new BahanUsulanError(`Stok bahan ${bahan.code} sudah tercatat di Gudang (saldo diketahui). Catat lewat pemakaian aktual resmi; bila saldo kurang, minta Gudang menambah stok atau melakukan opname.`, "BAHAN_STOK_DIKETAHUI", 409, { materialId: bahan.id, kode: bahan.code });
    } else if (data.proposalId) {
      const p = await tx.materialProposal.findUnique({ where: { id: data.proposalId } });
      if (!p) throw new BahanUsulanError("Usulan bahan tidak ditemukan", "USULAN_TIDAK_ADA", 404);
      if (p.status === "DITOLAK") throw new BahanUsulanError("Usulan bahan ini ditolak Gudang. Catat pemakaian bahan lain atau hubungi Gudang.", "USULAN_DITOLAK", 409);
      if (["DISETUJUI", "DIGABUNG"].includes(p.status)) throw new BahanUsulanError("Bahan ini sudah ada di katalog. Catat lewat pemakaian aktual resmi (Gudang yang mengurangi saldo).", "BAHAN_ADA_DI_KATALOG", 409, { materialId: p.materialId });
      if (p.unit !== data.uom) throw new BahanUsulanError(`Satuan harus sama dengan usulan (${p.unit}).`, "SEMENTARA_SATUAN_INVALID", 400);
    } else {
      const katalog = (await tx.material.findMany({ where: { active: true }, select: { id: true, code: true, name: true, unit: true, active: true } })).map((m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active }));
      const kembar = cariKembar({ nama: data.name, bahan: katalog }).filter((k) => k.tingkat === "SAMA");
      if (adaKembarSama(kembar)) throw new BahanUsulanError("Bahan dengan nama ini sudah ada di katalog. Catat lewat pemakaian aktual resmi supaya saldo ikut tercatat.", "BAHAN_ADA_DI_KATALOG", 409, { kandidat: kembar });
    }
    const baris = await tx.unitProvisionalUsage.create({ data: { unitId, proposalId: data.proposalId, materialId: data.materialId, name: data.name, nameKey: data.nameKey, qty: data.qty, uom: data.uom, originNote: data.originNote, note: data.note, usedAt: data.usedAt, recordedById: actorId, idempotencyKey: kunci }, include: { material: { select: { id: true, code: true, name: true, unit: true } } } });
    const nama = await namaPelaku(tx, [actorId]);
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_PEMAKAIAN_SEMENTARA_DICATAT, actorId, metadata: { unitCode: unit.unitCode, orderId: unit.orderId, usageId: baris.id, name: data.name, qty: data.qty, uom: data.uom, originNote: data.originNote, ...(bahan ? { materialId: bahan.id, kodeBahan: bahan.code, stokBelumDiketahui: true, alasan: data.alasan } : {}), deciderName: nama.get(actorId) ?? null } });
    return { replayed: false, item: tampil(baris, nama), catatan: CATATAN_SEMENTARA };
  });
}

/** Batalkan catatan yang salah input (belum diselesaikan). Baris tetap ada (status DIBATALKAN + alasan). Pencatat atau pemegang hak Gudang (diputuskan route). */
/** Koreksi (alasan wajib): catatan LAMA dibatalkan ('Dikoreksi: …') dan catatan BARU dibuat menunjuk ke yang lama — satu transaksi, baris lama tetap ada. Hanya yang masih 'Perlu rekonsiliasi'. Idempoten per (unit, kunci). */
export async function koreksiPemakaianSementara(prisma, { usageId, input, alasan, actorId, idempotencyKey }) {
  const kunci = kunciValid(idempotencyKey); const teks = typeof alasan === "string" ? alasan.trim().slice(0, 500) : "";
  if (teks.length < 3) throw new BahanUsulanError("Alasan koreksi wajib diisi (minimal 3 karakter).", "KOREKSI_ALASAN_WAJIB", 400);
  return prisma.$transaction(async (tx) => {
    const awal = await tx.unitProvisionalUsage.findUnique({ where: { id: usageId }, select: { unitId: true } });
    if (!awal) throw new BahanUsulanError("Catatan pemakaian sementara tidak ditemukan", "SEMENTARA_TIDAK_ADA", 404);
    const unit = await unitAktif(tx, awal.unitId);
    await lockRowForUpdate(tx, "unit_provisional_usages", usageId);
    const r = await tx.unitProvisionalUsage.findUnique({ where: { id: usageId } });
    const ada = await tx.unitProvisionalUsage.findFirst({ where: { unitId: r.unitId, idempotencyKey: kunci } });
    if (ada) {
      if (ada.correctedFromId !== usageId) throw new BahanUsulanError("Idempotency-Key ini sudah dipakai untuk isian yang berbeda.", "IDEMPOTENCY_KEY_REUSED", 409);
      return { replayed: true, item: tampil(ada, await namaPelaku(tx, [ada.recordedById])), catatan: CATATAN_SEMENTARA };
    }
    if (r.status !== "PERLU_REKONSILIASI") throw new BahanUsulanError(`Catatan ini sudah ${STATUS_SEMENTARA[r.status]?.toLowerCase() ?? r.status}; tidak bisa dikoreksi. Batalkan lalu catat baru bila perlu.`, "SEMENTARA_SUDAH_FINAL", 409);
    // Catatan tertaut katalog: bahan + satuan terkunci (tidak boleh berpindah bahan/nama lewat koreksi); asal WAJIB tetap ada; catatan baku "Stok bahan belum diketahui…" dipertahankan.
    const katalogTertaut = tertautKatalogRow(r);
    const d = normalisasiPemakaianSementara({ name: r.name, uom: r.uom, ...(input || {}), ...(r.proposalId ? { name: r.name, uom: r.uom, proposalId: r.proposalId } : {}), ...(katalogTertaut ? { name: r.name, uom: r.uom, materialId: null, proposalId: null, originNote: (input?.originNote ?? r.originNote) } : {}), materialId: null, alasanPencatatan: undefined, usedAt: input?.usedAt || undefined });
    if (katalogTertaut) {
      if (String(d.originNote ?? "").length < 2) throw new BahanUsulanError("Asal barang wajib diisi (dari mana bahan ini diperoleh).", "SEMENTARA_ASAL_WAJIB", 400);
      if (String(input?.uom ?? r.uom).toUpperCase() !== r.uom) throw new BahanUsulanError(`Satuan harus sama dengan satuan katalog (${r.uom}).`, "SEMENTARA_SATUAN_INVALID", 400);
      const tambah = String(d.note ?? "").trim(); d.note = tambah.startsWith(AWAL_CATATAN_KATALOG) ? tambah.slice(0, 500) : (`${String(r.note).split(" Catatan: ")[0]}${tambah ? ` Catatan: ${tambah}` : ""}`).slice(0, 500);
    }
    if (!input?.usedAt) d.usedAt = new Date(r.usedAt); // koreksi tidak menggeser waktu pakai bila tidak diubah
    if (r.proposalId && (String(input?.uom ?? r.uom).toUpperCase() !== r.uom)) throw new BahanUsulanError(`Satuan harus sama dengan usulan (${r.uom}).`, "SEMENTARA_SATUAN_INVALID", 400);
    if (d.name === r.name && d.qty === Number(r.qty) && d.uom === r.uom && (d.originNote ?? null) === (r.originNote ?? null) && (d.note ?? null) === (r.note ?? null) && d.usedAt.getTime() === new Date(r.usedAt).getTime()) throw new BahanUsulanError("Tidak ada perubahan dari catatan yang ada.", "KOREKSI_TIDAK_BERUBAH", 422);
    if (!r.proposalId && !katalogTertaut && d.nameKey !== r.nameKey) {
      const katalog = (await tx.material.findMany({ where: { active: true }, select: { id: true, code: true, name: true, unit: true, active: true } })).map((m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active }));
      const kembar = cariKembar({ nama: d.name, bahan: katalog }).filter((k) => k.tingkat === "SAMA");
      if (adaKembarSama(kembar)) throw new BahanUsulanError("Bahan dengan nama ini sudah ada di katalog. Catat lewat pemakaian aktual resmi supaya saldo ikut tercatat.", "BAHAN_ADA_DI_KATALOG", 409, { kandidat: kembar });
    }
    const baru = await tx.unitProvisionalUsage.create({ include: { material: { select: { id: true, code: true, name: true, unit: true } } }, data: { unitId: r.unitId, proposalId: r.proposalId, materialId: katalogTertaut ? r.materialId : null, name: d.name, nameKey: d.nameKey, qty: d.qty, uom: d.uom, originNote: d.originNote, note: d.note, usedAt: d.usedAt, recordedById: actorId, idempotencyKey: kunci, correctedFromId: r.id } });
    await tx.unitProvisionalUsage.update({ where: { id: r.id }, data: { status: "DIBATALKAN", cancelledById: actorId, cancelledAt: new Date(), cancelReason: `Dikoreksi: ${teks}` } });
    const nama = await namaPelaku(tx, [r.recordedById, actorId]);
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: r.unitId, eventType: EVENT_TYPES.PRODUCTION_PEMAKAIAN_SEMENTARA_DISELESAIKAN, actorId, metadata: { unitCode: unit.unitCode, usageId: r.id, name: r.name, status: "DIBATALKAN", alasan: `Dikoreksi: ${teks}`, penggantiId: baru.id, deciderName: nama.get(actorId) ?? null } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: r.unitId, eventType: EVENT_TYPES.PRODUCTION_PEMAKAIAN_SEMENTARA_DICATAT, actorId, metadata: { unitCode: unit.unitCode, orderId: unit.orderId, usageId: baru.id, name: d.name, qty: d.qty, uom: d.uom, originNote: d.originNote, koreksiDari: r.id, alasanKoreksi: teks, deciderName: nama.get(actorId) ?? null } });
    return { replayed: false, item: tampil(baru, nama), lama: tampil({ ...r, status: "DIBATALKAN", cancelReason: `Dikoreksi: ${teks}`, cancelledById: actorId, cancelledAt: new Date() }, nama), catatan: CATATAN_SEMENTARA };
  });
}

export async function batalkanPemakaianSementara(prisma, { usageId, alasan, actorId, bolehSemua = false }) {
  const teks = typeof alasan === "string" ? alasan.trim().slice(0, 500) : "";
  if (teks.length < 3) throw new BahanUsulanError("Alasan pembatalan wajib diisi (minimal 3 karakter).", "BATAL_ALASAN_WAJIB", 400);
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "unit_provisional_usages", usageId);
    const r = await tx.unitProvisionalUsage.findUnique({ where: { id: usageId }, include: { unit: { select: { unitCode: true } } } });
    if (!r) throw new BahanUsulanError("Catatan pemakaian sementara tidak ditemukan", "SEMENTARA_TIDAK_ADA", 404);
    if (r.status === "DIBATALKAN" && r.cancelledById === actorId && r.cancelReason === teks) return { replayed: true, item: tampil(r, await namaPelaku(tx, [r.recordedById, r.cancelledById])) };
    const bisaBatal = r.status === "PERLU_REKONSILIASI" || (r.status === "DIREKONSILIASI" && r.resolution === "TANPA_STOK" && bolehSemua); // yang ditautkan ke pergerakan resmi dikoreksi lewat jalur stok resmi, bukan dibatalkan di sini
    if (!bisaBatal) throw new BahanUsulanError(r.status === "DIREKONSILIASI" ? (r.resolution === "TAUTKAN_ISSUE" ? "Catatan ini sudah ditautkan ke pengeluaran stok resmi. Koreksi lewat jalur stok resmi (Return Produksi), bukan di sini." : "Hanya Gudang yang boleh membatalkan catatan yang sudah dinyatakan bukan stok Gudang.") : `Catatan ini sudah ${STATUS_SEMENTARA[r.status]?.toLowerCase() ?? r.status}; tidak bisa dibatalkan.`, "SEMENTARA_SUDAH_FINAL", r.status === "DIREKONSILIASI" && r.resolution === "TANPA_STOK" ? 403 : 409);
    const baru = await tx.unitProvisionalUsage.update({ where: { id: usageId }, data: { status: "DIBATALKAN", cancelledById: actorId, cancelledAt: new Date(), cancelReason: teks } });
    const nama = await namaPelaku(tx, [r.recordedById, actorId]);
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: r.unitId, eventType: EVENT_TYPES.PRODUCTION_PEMAKAIAN_SEMENTARA_DISELESAIKAN, actorId, metadata: { unitCode: r.unit.unitCode, usageId: r.id, name: r.name, status: "DIBATALKAN", alasan: teks, deciderName: nama.get(actorId) ?? null } });
    return { replayed: false, item: tampil(baru, nama) };
  });
}

/** Baca-saja: pergerakan RESMI yang boleh ditautkan — ISSUE pada unit yang sama, belum bertaut ke catatan lain. Bahan usulan yang sudah disetujui/digabung mempersempit ke bahan itu. */
export async function kandidatPergerakan(db, usageId) {
  const r = await db.unitProvisionalUsage.findUnique({ where: { id: usageId }, include: { proposal: { select: { status: true, materialId: true } }, material: { select: { id: true, code: true, name: true, unit: true } } } });
  if (!r) throw new BahanUsulanError("Catatan pemakaian sementara tidak ditemukan", "SEMENTARA_TIDAK_ADA", 404);
  const tertautKatalog = tertautKatalogRow(r);
  const bahanTujuan = (tertautKatalog ? r.materialId : null) ?? r.proposal?.materialId ?? null;
  const rows = await db.stockMovement.findMany({
    where: { unitId: r.unitId, type: "ISSUE", provisionalUsage: { is: null }, ...(bahanTujuan ? { materialId: bahanTujuan } : {}) },
    select: { id: true, qty: true, note: true, createdAt: true, material: { select: { id: true, code: true, name: true, unit: true } }, createdBy: { select: { name: true } }, materialIssue: { select: { issueNumber: true } } },
    orderBy: { createdAt: "desc" }, take: 60,
  });
  return {
    usage: { id: r.id, name: r.name, qty: Number(r.qty), uom: r.uom, status: r.status },
    bahanTujuanId: bahanTujuan,
    bahanKatalog: tertautKatalog && r.material ? { id: r.material.id, kode: r.material.code, nama: r.material.name, satuan: r.material.unit } : null,
    petunjuk: tertautKatalog
      ? `Bahan katalog ${r.material?.code ?? ""} stoknya belum tercatat saat dicatat. Langkah resmi Gudang: (1) catat stok awal/opname bahan ini, (2) catat pengeluaran resmi ke unit (Material Issue / pemakaian unit), (3) pilih pergerakan itu di sini. Pergerakan hanya bisa ditautkan ke SATU catatan (mencegah hitung ganda); bila bahan ternyata bukan stok Gudang, pilih 'Bukan stok Gudang' dengan alasan.`
      : bahanTujuan
      ? "Bahan sudah ada di katalog. Catat pengeluaran resmi (Material Issue / pemakaian unit) bila belum, lalu pilih pergerakan itu di sini."
      : "Bahan ini belum ada di katalog. Minta usulan disetujui Gudang, terima stoknya lewat penerimaan resmi, catat pengeluaran resmi ke unit, lalu tautkan di sini. Bila bahan memang bukan stok Gudang, pilih 'Bukan stok Gudang' dengan alasan.",
    kandidat: rows.map((m) => ({ stockMovementId: m.id, ref: refPergerakan(m), materialId: m.material.id, kode: m.material.code, nama: m.material.name, satuan: m.material.unit, qty: -Number(m.qty), at: m.createdAt, oleh: m.createdBy?.name ?? null, catatan: m.note ?? null, qtySama: qtySama(-Number(m.qty), r.qty), satuanSama: m.material.unit === r.uom })),
  };
}

/** Rekonsiliasi (hak Gudang): TAUTKAN_ISSUE ke pergerakan resmi yang sudah ada, atau TANPA_STOK (bukan stok Gudang). TIDAK menulis stock_movements/jurnal/biaya. */
export async function rekonsiliasiPemakaianSementara(prisma, { usageId, input, actorId }) {
  const d = normalisasiRekonsiliasi(input);
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "unit_provisional_usages", usageId);
    const r = await tx.unitProvisionalUsage.findUnique({ where: { id: usageId }, include: { unit: { select: { unitCode: true } }, proposal: { select: { status: true, materialId: true } } } });
    if (!r) throw new BahanUsulanError("Catatan pemakaian sementara tidak ditemukan", "SEMENTARA_TIDAK_ADA", 404);
    if (r.status !== "PERLU_REKONSILIASI") {
      const sama = r.status === "DIREKONSILIASI" && r.resolution === d.resolusi && r.resolvedById === actorId && (r.resolutionNote ?? null) === (d.catatan ?? null) && (d.resolusi !== "TAUTKAN_ISSUE" || r.stockMovementId === d.stockMovementId);
      if (sama) return { replayed: true, item: tampil(r, await namaPelaku(tx, [r.recordedById, r.resolvedById])) };
      throw new BahanUsulanError(`Catatan ini sudah ${STATUS_SEMENTARA[r.status]?.toLowerCase() ?? r.status}. Muat ulang.`, "SEMENTARA_SUDAH_FINAL", 409, { status: r.status });
    }
    let data = { status: "DIREKONSILIASI", resolution: d.resolusi, resolvedById: actorId, resolvedAt: new Date(), resolutionNote: d.catatan ?? null };
    let movementRef = null; let selisih = null;
    if (d.resolusi === "TAUTKAN_ISSUE") {
      await lockRowForUpdate(tx, "stock_movements", d.stockMovementId);
      const m = await tx.stockMovement.findUnique({ where: { id: d.stockMovementId }, select: { id: true, type: true, qty: true, unitId: true, materialId: true, material: { select: { id: true, code: true, name: true, unit: true } }, materialIssue: { select: { issueNumber: true } }, provisionalUsage: { select: { id: true } } } });
      if (!m) throw new BahanUsulanError("Pergerakan stok tidak ditemukan", "PERGERAKAN_TIDAK_ADA", 404);
      if (m.type !== "ISSUE") throw new BahanUsulanError("Hanya pengeluaran stok (ISSUE) yang bisa ditautkan.", "PERGERAKAN_BUKAN_ISSUE", 409);
      if (m.unitId !== r.unitId) throw new BahanUsulanError("Pergerakan ini milik unit lain; hanya pergerakan pada unit yang sama yang bisa ditautkan.", "PERGERAKAN_UNIT_BEDA", 409);
      if (m.provisionalUsage) throw new BahanUsulanError("Pergerakan ini sudah ditautkan ke catatan pemakaian sementara lain (mencegah hitungan ganda).", "PERGERAKAN_SUDAH_DITAUTKAN", 409);
      const tertautKatalog = tertautKatalogRow(r);
      const tujuan = (tertautKatalog ? r.materialId : null) ?? r.proposal?.materialId ?? null;
      if (tujuan && m.materialId !== tujuan) throw new BahanUsulanError("Pergerakan ini untuk bahan yang berbeda dari usulan/catatan ini.", "PERGERAKAN_BAHAN_BEDA", 409);
      if (m.material.unit !== r.uom) throw new BahanUsulanError(`Satuan pergerakan (${m.material.unit}) berbeda dari catatan (${r.uom}); tidak bisa ditautkan.`, "PERGERAKAN_SATUAN_BEDA", 409);
      const qtyMv = -Number(m.qty); selisih = selisihQty(qtyMv, r.qty);
      if (!qtySama(qtyMv, r.qty) && (d.catatan ?? "").length < 10) throw new BahanUsulanError(`Jumlah pergerakan (${qtyMv}) berbeda dari catatan (${Number(r.qty)}). Jelaskan selisihnya di catatan (minimal 10 karakter).`, "REKONSILIASI_SELISIH_WAJIB_CATATAN", 400, { selisih });
      data = { ...data, materialId: m.materialId, stockMovementId: m.id }; movementRef = refPergerakan(m);
    }
    const baru = await tx.unitProvisionalUsage.update({ where: { id: usageId }, data });
    const nama = await namaPelaku(tx, [r.recordedById, actorId]);
    await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: r.unitId, eventType: EVENT_TYPES.PRODUCTION_PEMAKAIAN_SEMENTARA_DISELESAIKAN, actorId, metadata: { unitCode: r.unit.unitCode, usageId: r.id, name: r.name, status: "DIREKONSILIASI", resolusi: d.resolusi, movementRef, selisih, catatan: d.catatan ?? null, deciderName: nama.get(actorId) ?? null } });
    return { replayed: false, item: tampil(baru, nama) };
  });
}

/** Baca-saja: catatan pemakaian sementara satu unit + total TERPISAH dari pemakaian resmi (tidak dijumlahkan). */
export async function ambilPemakaianSementaraUnit(db, unitId) {
  const rows = await db.unitProvisionalUsage.findMany({ where: { unitId }, include: { material: { select: { id: true, code: true, name: true, unit: true } } }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
  const nama = await namaPelaku(db, rows.flatMap((r) => [r.recordedById, r.resolvedById, r.cancelledById]));
  const items = rows.map((r) => tampil(r, nama));
  const perlu = items.filter((i) => i.status === "PERLU_REKONSILIASI");
  return {
    items, catatan: CATATAN_SEMENTARA,
    total: { perluRekonsiliasi: perlu.length, direkonsiliasi: items.filter((i) => i.status === "DIREKONSILIASI").length, dibatalkan: items.filter((i) => i.status === "DIBATALKAN").length },
    dampakStok: "Tidak ada saldo, biaya bahan, atau jurnal dari catatan ini. Hanya menjadi bukti pekerjaan 'Sudah dikerjakan' (bersumber 'Pemakaian sementara') dan penanda untuk Gudang.",
  };
}

/** Antrean Gudang (baca-saja): catatan lintas unit, yang perlu rekonsiliasi didahulukan. */
export async function daftarPemakaianSementara(db, { status = "PERLU_REKONSILIASI", q = "", limit = 100 } = {}) {
  const cari = String(q || "").trim(); const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
  const where = { ...(status && STATUS_SEMENTARA[status] ? { status } : {}), ...(cari ? { OR: [{ name: { contains: cari, mode: "insensitive" } }, { unit: { unitCode: { contains: cari, mode: "insensitive" } } }] } : {}) };
  const [rows, hitung] = await Promise.all([
    db.unitProvisionalUsage.findMany({ where, include: { unit: { select: { id: true, unitCode: true, order: { select: { orderNumber: true } } } }, proposal: { select: { id: true, status: true, materialId: true } }, material: { select: { id: true, code: true, name: true, unit: true } } }, orderBy: [{ recordedAt: "asc" }], take: lim }),
    db.unitProvisionalUsage.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const nama = await namaPelaku(db, rows.flatMap((r) => [r.recordedById, r.resolvedById, r.cancelledById]));
  const jumlah = Object.fromEntries(Object.keys(STATUS_SEMENTARA).map((s) => [s, 0])); for (const h of hitung) jumlah[h.status] = h._count._all;
  return {
    rows: rows.map((r) => tampil(r, nama, { unitCode: r.unit.unitCode, orderNumber: r.unit.order?.orderNumber ?? null, usulan: r.proposal ? { id: r.proposal.id, status: r.proposal.status, materialId: r.proposal.materialId } : null })),
    jumlah, catatan: CATATAN_SEMENTARA,
  };
}
