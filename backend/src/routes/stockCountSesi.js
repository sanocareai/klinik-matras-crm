// STOCK OPNAME — ALUR SESI MODEL 2 (Okt 2026): membuat sesi per cakupan (penuh / per kelompok / cycle count), pratinjau cakupan, simpan hasil hitung bertahap dengan revisi per baris, progres,
// pengeluaran bahan dari cakupan, bahan di luar cakupan, riwayat angka. Dipasang SEBELUM stockCountRouter di path yang sama; endpoint lama (sesi model 1) tidak diubah perilakunya.
// Aturan tiga waktu (pengamatan / disimpan / posting ledger) dan pembanding: services/opnameSesi.js. Menyimpan hitungan TIDAK menyentuh ledger; satu-satunya jalan ke stok tetap POST /:id/complete di stockCount.js.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { wajibUuid } from "../lib/uuidParam.js";
import { pesanServerAman } from "../lib/galatServerAman.js";
import { lockRowForUpdate } from "../services/inventoryLedger.js";
import { AKSI_TANDA_DIRESET } from "../services/pergerakanSesiHitung.js";
import { kelompokDariItemGroup, URUTAN_KELOMPOK, KELOMPOK, KELOMPOK_BELUM, LABEL_BELUM } from "../constants/kelompokBahan.js";
import { stokLokasi } from "../services/stokLokasi.js";
import {
  GalatSesi, MODE, MAKS_BAHAN_CYCLE_COUNT, SUMBER_WAKTU, AKSI_WAKTU_HITUNG, AKSI_CAKUPAN_DIABAIKAN, AKSI_BAHAN_DIKELUARKAN, AKSI_BAHAN_DIKEMBALIKAN, AKSI_BAHAN_DITAMBAHKAN,
  bangunCakupan, bahanDiLuarCakupan, muatBahan, ringkasProgres,
} from "../services/opnameSesi.js";

const AKSI_ISI_HITUNGAN = "HASIL_HITUNG_DIISI"; // sama dengan stockCount.js: identitas penghitung diturunkan dari peristiwa ini

export const stockCountSesiRouter = express.Router();
stockCountSesiRouter.use(requireAuth);

function galat(err, res) {
  if (typeof err.statusCode === "number") {
    const kode = typeof err.code === "string" && /^[A-Z][A-Z0-9_]{2,40}$/.test(err.code) ? { code: err.code } : {};
    return res.status(err.statusCode).json({ error: err.message, ...kode, ...(err.rinci ? { rinci: err.rinci } : {}) });
  }
  if (err.code === "P2002") return res.status(409).json({ error: "Nomor count sudah dipakai, coba lagi", code: "NOMOR_BENTROK" });
  console.error("Stock count sesi error:", err);
  return res.status(500).json({ error: pesanServerAman(err) });
}

const include = {
  lines: { include: { material: { select: { id: true, code: true, name: true, unit: true, itemGroup: true, active: true, category: true } } } },
  assignedTo: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } },
};
const toNum = (v) => (v === undefined ? undefined : v === "" || v === null ? null : Number(v));
const jakarta = () => new Date();

function kodeSesi(today, urutan) {
  const d = new Date(today); const dd = String(d.getUTCDate()).padStart(2, "0"); const mm = String(d.getUTCMonth() + 1).padStart(2, "0"); const yy = String(d.getUTCFullYear()).slice(-2);
  return `CC-${dd}${mm}${yy}-${String(urutan).padStart(2, "0")}`;
}

async function namaUser(db, ids) {
  const u = ids.length ? await db.user.findMany({ where: { id: { in: [...new Set(ids.filter(Boolean))] } }, select: { id: true, name: true } }) : [];
  return new Map(u.map((x) => [x.id, x.name]));
}

/** Baris kompak untuk halaman kerja. `tampilSaldo` = false pada blind count yang belum diserahkan (server TIDAK mengirim saldo/pembanding). */
export function barisKerja(l, nama) {
  const k = kelompokDariItemGroup(l.material.itemGroup);
  return {
    id: l.id, materialId: l.materialId, kode: l.material.code, nama: l.material.name, satuan: l.material.unit, kelompokKode: k.kode, kelompokLabel: k.kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[k.kode],
    counted: l.countedQty == null ? null : Number(l.countedQty), savedAt: l.savedAt, countedBy: l.countedById ? { id: l.countedById, nama: nama.get(l.countedById) ?? null } : null,
    // TIGA WAKTU terpisah: observedAt (pengamatan fisik; null = tidak diketahui), savedAt (angka disimpan); waktu posting ledger ada di transaksi.
    observedAt: l.observedAt, observedSource: l.observedSource, observedRecordedAt: l.observedRecordedAt, observedBy: l.observedById ? { id: l.observedById, nama: nama.get(l.observedById) ?? null } : null,
    tanpaWaktu: !l.excludedAt && l.countedQty != null && !l.observedAt, sedangDihitung: !l.excludedAt && l.countedQty == null && !!l.observedAt,
    revision: l.revision, ditandaRagu: l.needsCheck, dikoreksi: l.revision >= 2, perluPeriksa: !l.excludedAt && (l.needsCheck || l.revision >= 2),
    excluded: !!l.excludedAt, excludedReason: l.excludedReason ?? null, origin: l.origin, nonaktif: l.material.active === false, reason: l.reason ?? null,
  };
}

async function muatSesiV2(db, id, { kunci = false } = {}) {
  if (kunci) await lockRowForUpdate(db, "stock_counts", id);
  const count = await db.stockCount.findUnique({ where: { id }, include });
  if (!count) throw new GalatSesi("Stock count tidak ditemukan", 404);
  return count;
}
const wajibV2 = (count) => { if (count.modelVersion !== 2) throw new GalatSesi("Sesi ini memakai aturan lama (model 1); fitur ini hanya untuk sesi yang dibuat lewat alur baru.", 409, "SESI_LAMA"); };

// ── Pratinjau cakupan (baca-saja) ──────────────────────────────────────────────────────────────────────────────────────────────────
stockCountSesiRouter.post("/scope-preview", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const bahan = await muatBahan(prisma); const sl = await stokLokasi(prisma);
    const { ringkasan } = bangunCakupan(bahan, req.body, new Map(sl.rows.map((r) => [r.materialId, { keadaan: r.keadaan, saldo: r.saldo }])));
    const aktifPenuh = ringkasan.mode === MODE.FULL ? await prisma.stockCount.findFirst({ where: { modelVersion: 2, scopeMode: "FULL", status: { in: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW"] } }, select: { id: true, countNumber: true, status: true } }) : null;
    res.json({ ringkasan, sesiPenuhAktif: aktifPenuh, batasCycleCount: MAKS_BAHAN_CYCLE_COUNT });
  } catch (err) { galat(err, res); }
});

// ── Daftar bahan untuk Cycle Count (cari + checkbox) ───────────────────────────────────────────────────────────────────────────────
stockCountSesiRouter.get("/bahan", requirePermission(P.INVENTORY_READ), async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim(); const kel = String(req.query.kelompok ?? ""); const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50)); const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const semua = (await muatBahan(prisma)).filter((m) => m.active)
      .map((m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit, kategori: m.category, kelompok: kelompokDariItemGroup(m.itemGroup) }))
      .filter((m) => (!q || `${m.kode} ${m.nama}`.toLowerCase().includes(q.toLowerCase())) && (!kel || m.kelompok.kode === kel));
    res.json({ total: semua.length, items: semua.slice(offset, offset + limit).map((m) => ({ ...m, kelompok: { kode: m.kelompok.kode, label: m.kelompok.label } })), kelompok: URUTAN_KELOMPOK.map((k) => ({ kode: k, label: k === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[k] })) });
  } catch (err) { galat(err, res); }
});

// ── Membuat sesi model 2 (hanya bila body.mode ada; selain itu diteruskan ke endpoint lama) ─────────────────────────────────────
stockCountSesiRouter.post("/", async (req, res, next) => {
  if (req.body?.mode === undefined) return next();
  try {
    if (!hasPermission(req.user, P.INVENTORY_WRITE)) throw new GalatSesi("Akun ini tidak berhak membuat sesi Stock Count", 403);
    const { scheduledDate, blindCount, notes, assignedToId, langsungMulai } = req.body;
    const bahan = await muatBahan(prisma); const sl = await stokLokasi(prisma);
    const { scope, materialIds, ringkasan } = bangunCakupan(bahan, req.body, new Map(sl.rows.map((r) => [r.materialId, { keadaan: r.keadaan, saldo: r.saldo }])));
    if (materialIds.length === 0) throw new GalatSesi("Cakupan ini tidak memuat satu bahan pun.", 400, "CAKUPAN_KOSONG");
    const countType = scope.mode === MODE.FULL ? "FULL_STOCK_OPNAME" : "CYCLE_COUNT";
    const countMethod = scope.mode === MODE.FULL ? "FULL_WAREHOUSE" : scope.mode === MODE.GROUP ? "BY_CATEGORY" : "BY_ITEM";
    const sekarang = new Date();
    const hasil = await prisma.$transaction(async (tx) => {
      if (scope.mode === MODE.FULL) {
        const aktif = await tx.stockCount.findFirst({ where: { modelVersion: 2, scopeMode: "FULL", status: { in: ["SCHEDULED", "IN_PROGRESS", "WAITING_REVIEW"] } }, select: { countNumber: true } });
        if (aktif) throw new GalatSesi(`Sudah ada sesi Opname penuh yang berjalan (${aktif.countNumber}). Selesaikan atau batalkan dulu agar tidak ada dua sesi penuh bersamaan.`, 409, "SESI_PENUH_AKTIF");
      }
      const awalHari = new Date(Date.UTC(sekarang.getUTCFullYear(), sekarang.getUTCMonth(), sekarang.getUTCDate()));
      const urutan = (await tx.stockCount.count({ where: { createdAt: { gte: awalHari } } })) + 1;
      const info = { mode: scope.mode, groups: scope.groups, excludeJenis: scope.excludeJenis, excludeMaterialIds: scope.excludeMaterialIds, excludeReason: scope.excludeReason || null, ikutkanTakDilacak: scope.ikutkanTakDilacak, ikutkanAlasan: scope.ikutkanAlasan || null, aturanWaktu: "PENGAMATAN_V1", dibuatPada: sekarang.toISOString(), ringkasan };
      const dibuat = await tx.stockCount.create({
        data: {
          countNumber: kodeSesi(sekarang, urutan), countType, countMethod, modelVersion: 2, scopeMode: scope.mode, scopeInfo: info,
          scheduledDate: scheduledDate ? new Date(`${scheduledDate}T00:00:00.000Z`) : null, blindCount: blindCount !== undefined ? !!blindCount : true, notes: notes || null, assignedToId: assignedToId || null, createdById: req.user.id,
          ...(langsungMulai ? { status: "IN_PROGRESS", startedAt: sekarang } : {}),
          lines: { create: materialIds.map((materialId) => ({ materialId })) },
        },
        select: { id: true, countNumber: true, status: true, countType: true, scopeMode: true },
      });
      await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: dibuat.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: "SESI_DIBUAT", countNumber: dibuat.countNumber, mode: scope.mode, jumlahBahan: materialIds.length, langsungMulai: !!langsungMulai } });
      return dibuat;
    });
    res.status(201).json({ ...hasil, jumlahBahan: materialIds.length, ringkasan });
  } catch (err) { galat(err, res); }
});

// ── Halaman kerja: progres + baris kompak ──────────────────────────────────────────────────────────────────────────────────────────
stockCountSesiRouter.get("/:id/kerja", requirePermission(P.INVENTORY_READ), wajibUuid(), async (req, res) => {
  try {
    const count = await muatSesiV2(prisma, req.params.id); wajibV2(count);
    const nama = await namaUser(prisma, count.lines.flatMap((l) => [l.countedById, l.observedById]));
    const baris = count.lines.map((l) => barisKerja(l, nama)).sort((a, b) => a.kode.localeCompare(b.kode)); // urut per kode; kelompok tersedia sebagai penyaring
    const bahan = await muatBahan(prisma);
    const diabaikan = new Set((await prisma.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED }, select: { metadata: true } })).filter((e) => e.metadata?.aksi === AKSI_CAKUPAN_DIABAIKAN).map((e) => e.metadata.materialId));
    const luar = bahanDiLuarCakupan(bahan, count, diabaikan);
    const tulis = hasPermission(req.user, P.INVENTORY_WRITE);
    res.json({
      id: count.id, countNumber: count.countNumber, status: count.status, countType: count.countType, scopeMode: count.scopeMode, scopeInfo: count.scopeInfo, blindCount: count.blindCount, startedAt: count.startedAt, scheduledDate: count.scheduledDate,
      assignedTo: count.assignedTo, createdBy: count.createdBy,
      progres: ringkasProgres(baris), baris, diLuarCakupan: luar.map((m) => ({ materialId: m.id, kode: m.code, nama: m.name, satuan: m.unit })),
      bisaMenghitung: tulis && count.status === "IN_PROGRESS", izin: { tulis }, dimuatPada: new Date().toISOString(),
    });
  } catch (err) { galat(err, res); }
});

/// ── Waktu pengamatan: aturan bersama ───────────────────────────────────────────────────────────────────────────────────────────────
// observedAt dinyatakan petugas harus: tanggal valid, tidak di masa depan (toleransi 1 menit jam perangkat), dan tidak sebelum sesi dimulai (barang yang dihitung sebelum sesi ada bukan bagian sesi ini).
function periksaWaktuPengamatan(nilai, count, sekarang) {
  const d = new Date(nilai);
  if (nilai === null || nilai === undefined || nilai === "" || Number.isNaN(d.getTime())) throw new GalatSesi("Waktu hitung tidak valid.", 400, "WAKTU_TIDAK_VALID");
  if (d.getTime() > sekarang.getTime() + 60_000) throw new GalatSesi("Waktu hitung tidak boleh di masa depan.", 400, "WAKTU_DI_MASA_DEPAN");
  if (count.startedAt && d.getTime() < new Date(count.startedAt).getTime()) throw new GalatSesi("Waktu hitung tidak boleh sebelum sesi dimulai.", 400, "WAKTU_SEBELUM_SESI");
  return d.getTime() > sekarang.getTime() ? sekarang : d;
}
const isoAtauNull = (d) => (d ? new Date(d).toISOString() : null);

/** Mencatat perubahan waktu pengamatan + mereset tanda pergerakan bahan itu (tanda lama dibuat atas pengamatan yang berbeda) — sekaligus membatalkan pemeriksaan yang sudah ada. */
async function catatPerubahanWaktu(tx, { count, l, lama, baru, sumber, alasan, aktorId }) {
  await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktorId, metadata: { aksi: AKSI_WAKTU_HITUNG, countNumber: count.countNumber, lineId: l.id, materialId: l.materialId, lama: isoAtauNull(lama), baru: isoAtauNull(baru), sumber, ...(alasan ? { alasan } : {}) } });
  await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktorId, metadata: { aksi: AKSI_TANDA_DIRESET, countNumber: count.countNumber, materialId: l.materialId, alasan: "waktu hitung berubah — tanda pergerakan bahan ini harus diulang" } });
}

// ── Mulai hitung bahan: cap waktu pengamatan oleh SERVER di bawah kunci bahan ────────────────────────────────────────────────────────
// body: { lineIds: [...] } (maks. 200). Petugas menekan ini TEPAT SEBELUM menghitung barang. Waktu dicap SESUDAH kunci bahan didapat, jadi setiap pergerakan yang sedang diposting sudah commit (diposting
// SEBELUM pengamatan) dan yang menyusul bercap waktu SESUDAH pengamatan — urutan posting tidak ambigu. Idempoten: menekan dua kali tidak menggeser waktu (SUDAH_DIMULAI). Tidak menulis ledger.
stockCountSesiRouter.post("/:id/lines/mulai", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const lineIds = [...new Set(Array.isArray(req.body?.lineIds) ? req.body.lineIds : [])];
    if (!lineIds.length) throw new GalatSesi("Pilih bahan yang akan mulai dihitung.", 400, "LINE_IDS_KOSONG");
    if (lineIds.length > 200) throw new GalatSesi("Maksimal 200 bahan sekali mulai.", 400, "ITEMS_TERLALU_BANYAK");
    const hasil = await prisma.$transaction(async (tx) => {
      const count = await muatSesiV2(tx, req.params.id, { kunci: true }); wajibV2(count);
      if (count.status !== "IN_PROGRESS") throw new GalatSesi(count.status === "SCHEDULED" ? "Sesi belum dimulai. Tekan Mulai sesi dulu." : "Sesi tidak lagi menerima hitungan.", 409, "SESI_TIDAK_MENERIMA_HITUNGAN");
      const peta = new Map(count.lines.map((l) => [l.id, l]));
      const sah = lineIds.map((id) => peta.get(id)).filter((l) => l && !l.excludedAt && l.countedQty == null);
      for (const mid of [...new Set(sah.map((l) => l.materialId))].sort()) await lockRowForUpdate(tx, "materials", mid);
      const sekarang = new Date(); // SESUDAH semua kunci bahan didapat
      const nama = await namaUser(tx, sah.map((l) => l.observedById));
      const keluar = [];
      for (const id of lineIds) {
        const l = peta.get(id);
        if (!l) { keluar.push({ lineId: id, status: "DITOLAK", code: "BARIS_TIDAK_ADA", pesan: "Baris bahan tidak ada di sesi ini" }); continue; }
        if (l.excludedAt) { keluar.push({ lineId: id, status: "DITOLAK", code: "BAHAN_DIKELUARKAN", pesan: "Bahan ini sudah dikeluarkan dari sesi" }); continue; }
        if (l.countedQty != null) { keluar.push({ lineId: id, status: "DITOLAK", code: "SUDAH_ADA_ANGKA", pesan: "Bahan ini sudah punya angka. Untuk menghitung ulang, ubah angkanya (wajib alasan) dan nyatakan waktu hitung barunya." }); continue; }
        if (l.observedAt) { keluar.push({ lineId: id, status: "SUDAH_DIMULAI", observedAt: l.observedAt, observedSource: l.observedSource, oleh: l.observedById ? { id: l.observedById, nama: nama.get(l.observedById) ?? null } : null, revision: l.revision }); continue; }
        const u = await tx.stockCountLine.update({ where: { id: l.id }, data: { observedAt: sekarang, observedSource: SUMBER_WAKTU.MULAI, observedById: req.user.id, observedRecordedAt: sekarang }, select: { id: true, observedAt: true, revision: true } });
        await catatPerubahanWaktu(tx, { count, l, lama: null, baru: sekarang, sumber: SUMBER_WAKTU.MULAI, aktorId: req.user.id });
        keluar.push({ lineId: id, status: "DIMULAI", observedAt: u.observedAt, observedSource: SUMBER_WAKTU.MULAI, oleh: { id: req.user.id, nama: req.user.name ?? null }, revision: u.revision });
      }
      return { hasil: keluar };
    });
    res.json(hasil);
  } catch (err) { galat(err, res); }
});

// ── Simpan hasil hitung (bertahap, per baris dengan revisi) ────────────────────────────────────────────────────────────────────────
// body: { items: [{ lineId, countedQty: number|null, revision, alasan?, perluPeriksa?, observedAt?, waktuTetap? }] }. Kolom kosong TIDAK dikirim; 0 hanya bila petugas memasukkan 0 secara eksplisit. null = mengosongkan hasil.
// WAKTU PENGAMATAN: angka pertama memakai waktu "Mulai hitung" yang sudah dicap; atau petugas menyatakan `observedAt` (DINYATAKAN; bila menggantikan waktu yang sudah ada wajib `alasan` → DIKOREKSI).
// Mengubah angka yang sudah tersimpan = pengamatan baru: kirim `observedAt` baru, atau `waktuTetap: true` (mis. salah ketik, waktu hitung tidak berubah). Tanpa keduanya waktu menjadi TIDAK DIKETAHUI (tidak dikarang dari waktu simpan).
stockCountSesiRouter.put("/:id/hasil", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) throw new GalatSesi("Tidak ada hasil hitung untuk disimpan.", 400, "ITEMS_KOSONG");
    if (items.length > 200) throw new GalatSesi("Maksimal 200 baris per simpan.", 400, "ITEMS_TERLALU_BANYAK");
    const hasil = await prisma.$transaction(async (tx) => {
      const count = await muatSesiV2(tx, req.params.id, { kunci: true }); wajibV2(count);
      if (count.status !== "IN_PROGRESS") throw new GalatSesi(count.status === "SCHEDULED" ? "Sesi belum dimulai. Tekan Mulai sesi dulu." : "Sesi tidak lagi menerima hasil hitung. Bila perlu mengubah angka sesudah diserahkan, gunakan Hitung ulang.", 409, "SESI_TIDAK_MENERIMA_HITUNGAN");
      const peta = new Map(count.lines.map((l) => [l.id, l])); const ids = new Set(); const keluar = [];
      const nama = await namaUser(tx, count.lines.flatMap((l) => [l.countedById, l.observedById]));
      for (const it of items) {
        const l = peta.get(it.lineId);
        if (!l) { keluar.push({ lineId: it.lineId, status: "DITOLAK", code: "BARIS_TIDAK_ADA", pesan: "Baris bahan tidak ada di sesi ini" }); continue; }
        if (ids.has(l.id)) { keluar.push({ lineId: l.id, status: "DITOLAK", code: "BARIS_GANDA", pesan: "Baris yang sama dikirim dua kali" }); continue; }
        ids.add(l.id);
        if (l.excludedAt) { keluar.push({ lineId: l.id, status: "DITOLAK", code: "BAHAN_DIKELUARKAN", pesan: "Bahan ini sudah dikeluarkan dari sesi" }); continue; }
        if (!Number.isInteger(it.revision)) { keluar.push({ lineId: l.id, status: "DITOLAK", code: "REVISI_WAJIB", pesan: "Revisi baris wajib dikirim" }); continue; }
        if (it.revision !== l.revision) {
          keluar.push({ lineId: l.id, status: "KONFLIK", code: "REVISI_BASI", pesan: "Angka bahan ini sudah diubah orang lain. Periksa angka terbaru sebelum menimpa.", saatIni: { counted: l.countedQty == null ? null : Number(l.countedQty), savedAt: l.savedAt, observedAt: l.observedAt, oleh: l.countedById ? { id: l.countedById, nama: nama.get(l.countedById) ?? null } : null, revision: l.revision } });
          continue;
        }
        const baru = toNum(it.countedQty);
        if (baru !== null && (!Number.isFinite(baru) || baru < 0)) { keluar.push({ lineId: l.id, status: "DITOLAK", code: "ANGKA_TIDAK_VALID", pesan: "Jumlah harus angka 0 atau lebih (kosongkan bila belum dihitung)" }); continue; }
        const lama = l.countedQty == null ? null : Number(l.countedQty);
        const flag = typeof it.perluPeriksa === "boolean" ? it.perluPeriksa : l.needsCheck;
        const alasan = typeof it.alasan === "string" ? it.alasan.trim() : "";
        const nilaiBerubah = baru !== lama;
        const sekarang = new Date();
        // Tentukan perubahan waktu pengamatan: undefined = tetap; { at: Date|null, sumber } = ganti.
        let waktu;
        try {
          const dinyatakan = it.observedAt !== undefined && it.observedAt !== null && it.observedAt !== "";
          if (baru === null) { if (nilaiBerubah && l.observedAt) waktu = { at: null, sumber: null }; }
          else if (dinyatakan) {
            const d = periksaWaktuPengamatan(it.observedAt, count, sekarang);
            if (!l.observedAt) waktu = { at: d, sumber: SUMBER_WAKTU.DINYATAKAN };
            else if (d.getTime() !== new Date(l.observedAt).getTime()) {
              if (alasan.length < 3) throw new GalatSesi("Mengganti waktu hitung yang sudah tercatat wajib disertai alasan (min. 3 karakter).", 400, "ALASAN_WAKTU_WAJIB");
              waktu = { at: d, sumber: SUMBER_WAKTU.DIKOREKSI };
            }
          } else if (nilaiBerubah && lama !== null && l.observedAt && it.waktuTetap !== true) waktu = { at: null, sumber: null }; // angka yang sudah ada diganti tanpa pengamatan baru → waktu TIDAK DIKETAHUI
        } catch (e) { if (e instanceof GalatSesi) { keluar.push({ lineId: l.id, status: "DITOLAK", code: e.code, pesan: e.message }); continue; } throw e; }
        if (!nilaiBerubah && flag === l.needsCheck && !waktu) { keluar.push({ lineId: l.id, status: "TIDAK_BERUBAH", revision: l.revision }); continue; }
        if (lama !== null && nilaiBerubah && alasan.length < 3) { keluar.push({ lineId: l.id, status: "DITOLAK", code: "ALASAN_KOREKSI_WAJIB", pesan: "Mengubah angka yang sudah tersimpan wajib disertai alasan (min. 3 karakter)" }); continue; }
        const dataWaktu = waktu ? (waktu.at ? { observedAt: waktu.at, observedSource: waktu.sumber, observedById: req.user.id, observedRecordedAt: sekarang } : { observedAt: null, observedSource: null, observedById: null, observedRecordedAt: null }) : {};
        const u = await tx.stockCountLine.update({
          where: { id: l.id },
          data: { ...(nilaiBerubah ? { countedQty: baru, savedAt: baru === null ? null : sekarang, countedById: baru === null ? null : req.user.id } : {}), ...dataWaktu, needsCheck: flag, revision: { increment: 1 } },
          select: { id: true, countedQty: true, savedAt: true, countedById: true, revision: true, needsCheck: true, observedAt: true, observedSource: true },
        });
        await recordActivity(tx, {
          entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id,
          metadata: { aksi: AKSI_ISI_HITUNGAN, countNumber: count.countNumber, lineId: l.id, materialId: l.materialId, countedQtyLama: lama, countedQtyBaru: baru, ...(alasan ? { alasan } : {}), perluPeriksa: flag, revisi: u.revision },
        });
        if (waktu) await catatPerubahanWaktu(tx, { count, l, lama: l.observedAt, baru: waktu.at, sumber: waktu.at ? waktu.sumber : "TIDAK_DIKETAHUI", alasan, aktorId: req.user.id });
        else if (nilaiBerubah) {
          await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: AKSI_TANDA_DIRESET, countNumber: count.countNumber, materialId: l.materialId, alasan: "hasil hitung diubah — tanda pergerakan material ini harus diulang" } });
        }
        keluar.push({ lineId: l.id, status: "DISIMPAN", revision: u.revision, counted: u.countedQty == null ? null : Number(u.countedQty), savedAt: u.savedAt, observedAt: u.observedAt, observedSource: u.observedSource, tanpaWaktu: u.countedQty != null && !u.observedAt, oleh: { id: req.user.id, nama: req.user.name ?? null }, perluPeriksa: u.needsCheck || u.revision >= 2 });
      }
      const segar = await tx.stockCountLine.findMany({ where: { stockCountId: count.id }, select: { countedQty: true, observedAt: true, excludedAt: true, needsCheck: true, revision: true, material: { select: { itemGroup: true } } } });
      const progres = ringkasProgres(segar.map((l) => ({ kelompokKode: kelompokDariItemGroup(l.material.itemGroup).kode, counted: l.countedQty == null ? null : 1, tanpaWaktu: l.countedQty != null && !l.observedAt, excluded: !!l.excludedAt, perluPeriksa: l.needsCheck || l.revision >= 2 })));
      return { hasil: keluar, progres };
    });
    res.json(hasil);
  } catch (err) { galat(err, res); }
});

// ── Koreksi waktu hitung satu bahan (wajib alasan, tercatat; boleh juga oleh pemeriksa saat Waiting Review) ──────────────────────────
// body: { observedAt, alasan, revision? }. Mengubah pembanding bahan itu → tanda pergerakan bahan itu direset dan pemeriksaan yang sudah ada batal.
stockCountSesiRouter.post("/:id/lines/:lineId/waktu", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "lineId"), async (req, res) => {
  try {
    const alasan = typeof req.body?.alasan === "string" ? req.body.alasan.trim() : "";
    if (alasan.length < 3) throw new GalatSesi("Alasan koreksi waktu hitung wajib diisi (min. 3 karakter).", 400, "ALASAN_WAKTU_WAJIB");
    const out = await prisma.$transaction(async (tx) => {
      const count = await muatSesiV2(tx, req.params.id, { kunci: true }); wajibV2(count);
      if (!["IN_PROGRESS", "WAITING_REVIEW"].includes(count.status)) throw new GalatSesi("Waktu hitung hanya bisa dikoreksi sebelum sesi selesai.", 409, "SESI_TIDAK_BISA_DIUBAH");
      const l = count.lines.find((x) => x.id === req.params.lineId); if (!l) throw new GalatSesi("Baris bahan tidak ditemukan", 404);
      if (l.excludedAt) throw new GalatSesi("Bahan ini sudah dikeluarkan dari sesi", 409, "BAHAN_DIKELUARKAN");
      if (Number.isInteger(req.body?.revision) && req.body.revision !== l.revision) throw new GalatSesi("Baris ini sudah diubah orang lain. Muat ulang sebelum mengoreksi waktu.", 409, "REVISI_BASI");
      const sekarang = new Date(); const d = periksaWaktuPengamatan(req.body?.observedAt, count, sekarang);
      if (l.observedAt && d.getTime() === new Date(l.observedAt).getTime()) return { ulang: true, observedAt: l.observedAt, revision: l.revision };
      const sumber = l.observedAt ? SUMBER_WAKTU.DIKOREKSI : SUMBER_WAKTU.DINYATAKAN;
      const u = await tx.stockCountLine.update({ where: { id: l.id }, data: { observedAt: d, observedSource: sumber, observedById: req.user.id, observedRecordedAt: sekarang, revision: { increment: 1 } }, select: { observedAt: true, observedSource: true, revision: true } });
      await catatPerubahanWaktu(tx, { count, l, lama: l.observedAt, baru: d, sumber, alasan, aktorId: req.user.id });
      return { ulang: false, observedAt: u.observedAt, observedSource: u.observedSource, revision: u.revision };
    });
    res.json(out);
  } catch (err) { galat(err, res); }
});

// ── Riwayat satu bahan: angka (lama → baru) dan waktu hitung (lama → baru), pelaku, waktu, alasan ───────────────────────────────────
stockCountSesiRouter.get("/:id/lines/:lineId/riwayat", requirePermission(P.INVENTORY_READ), wajibUuid("id", "lineId"), async (req, res) => {
  try {
    const count = await muatSesiV2(prisma, req.params.id); wajibV2(count);
    const events = await prisma.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED }, orderBy: { createdAt: "asc" }, select: { actorId: true, metadata: true, createdAt: true } });
    const baris = events.filter((e) => (e.metadata?.aksi === AKSI_ISI_HITUNGAN || e.metadata?.aksi === AKSI_WAKTU_HITUNG) && e.metadata?.lineId === req.params.lineId);
    const nama = await namaUser(prisma, baris.map((e) => e.actorId));
    res.json({ riwayat: baris.map((e) => e.metadata.aksi === AKSI_WAKTU_HITUNG
      ? { jenis: "WAKTU", pada: e.createdAt, oleh: nama.get(e.actorId) ?? null, lama: e.metadata.lama ?? null, baru: e.metadata.baru ?? null, sumber: e.metadata.sumber ?? null, alasan: e.metadata.alasan ?? null }
      : { jenis: "ANGKA", pada: e.createdAt, oleh: nama.get(e.actorId) ?? null, lama: e.metadata.countedQtyLama ?? null, baru: e.metadata.countedQtyBaru ?? null, alasan: e.metadata.alasan ?? null }) });
  } catch (err) { galat(err, res); }
});

// ── Mengeluarkan / mengembalikan bahan dari cakupan sesi (alasan wajib) ────────────────────────────────────────────────────────────
async function ubahKeluar(req, res, keluarkan) {
  try {
    const alasan = typeof req.body?.alasan === "string" ? req.body.alasan.trim() : "";
    if (keluarkan && alasan.length < 3) throw new GalatSesi("Alasan mengeluarkan bahan dari sesi wajib diisi (min. 3 karakter).", 400, "ALASAN_WAJIB");
    const out = await prisma.$transaction(async (tx) => {
      const count = await muatSesiV2(tx, req.params.id, { kunci: true }); wajibV2(count);
      if (!["SCHEDULED", "IN_PROGRESS"].includes(count.status)) throw new GalatSesi("Cakupan hanya bisa diubah sebelum hitungan diserahkan.", 409, "SESI_TIDAK_BISA_DIUBAH");
      const l = count.lines.find((x) => x.id === req.params.lineId); if (!l) throw new GalatSesi("Baris bahan tidak ditemukan", 404);
      if (keluarkan && l.excludedAt) return { ulang: true };
      if (!keluarkan && !l.excludedAt) return { ulang: true };
      await tx.stockCountLine.update({ where: { id: l.id }, data: keluarkan ? { excludedAt: new Date(), excludedReason: alasan, excludedById: req.user.id, revision: { increment: 1 } } : { excludedAt: null, excludedReason: null, excludedById: null, revision: { increment: 1 } } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: keluarkan ? AKSI_BAHAN_DIKELUARKAN : AKSI_BAHAN_DIKEMBALIKAN, countNumber: count.countNumber, lineId: l.id, materialId: l.materialId, ...(alasan ? { alasan } : {}) } });
      return { ulang: false };
    });
    res.json(out);
  } catch (err) { galat(err, res); }
}
stockCountSesiRouter.post("/:id/lines/:lineId/keluarkan", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "lineId"), (req, res) => ubahKeluar(req, res, true));
stockCountSesiRouter.post("/:id/lines/:lineId/kembalikan", requirePermission(P.INVENTORY_WRITE), wajibUuid("id", "lineId"), (req, res) => ubahKeluar(req, res, false));

// ── Bahan di luar cakupan: tambahkan ke sesi atau abaikan (keputusan eksplisit + alasan) ───────────────────────────────────────────
stockCountSesiRouter.post("/:id/cakupan", requirePermission(P.INVENTORY_WRITE), wajibUuid(), async (req, res) => {
  try {
    const { materialId, tindakan } = req.body ?? {}; const alasan = typeof req.body?.alasan === "string" ? req.body.alasan.trim() : "";
    if (!["TAMBAHKAN", "ABAIKAN"].includes(tindakan)) throw new GalatSesi("Tindakan harus TAMBAHKAN atau ABAIKAN.", 400, "TINDAKAN_TIDAK_VALID");
    if (typeof materialId !== "string") throw new GalatSesi("Bahan wajib dipilih.", 400, "BAHAN_WAJIB");
    if (tindakan === "ABAIKAN" && alasan.length < 3) throw new GalatSesi("Alasan mengabaikan wajib diisi (min. 3 karakter).", 400, "ALASAN_WAJIB");
    const out = await prisma.$transaction(async (tx) => {
      const count = await muatSesiV2(tx, req.params.id, { kunci: true }); wajibV2(count);
      if (!["SCHEDULED", "IN_PROGRESS"].includes(count.status)) throw new GalatSesi("Cakupan hanya bisa diubah sebelum hitungan diserahkan.", 409, "SESI_TIDAK_BISA_DIUBAH");
      const luar = bahanDiLuarCakupan(await muatBahan(tx), count, new Set((await tx.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED }, select: { metadata: true } })).filter((e) => e.metadata?.aksi === AKSI_CAKUPAN_DIABAIKAN).map((e) => e.metadata.materialId)));
      const m = luar.find((x) => x.id === materialId);
      if (!m) throw new GalatSesi("Bahan ini tidak (lagi) tercatat sebagai di luar cakupan sesi.", 409, "BUKAN_DI_LUAR_CAKUPAN");
      if (tindakan === "TAMBAHKAN") await tx.stockCountLine.create({ data: { stockCountId: count.id, materialId: m.id, origin: "TAMBAHAN" } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: req.user.id, metadata: { aksi: tindakan === "TAMBAHKAN" ? AKSI_BAHAN_DITAMBAHKAN : AKSI_CAKUPAN_DIABAIKAN, countNumber: count.countNumber, materialId: m.id, kode: m.code, ...(alasan ? { alasan } : {}) } });
      return { materialId: m.id, tindakan };
    });
    res.status(201).json(out);
  } catch (err) { galat(err, res); }
});
