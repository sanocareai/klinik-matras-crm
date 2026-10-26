// ADOPSI ADMIN → PIC BAHAN → APLIKASI MESA (Okt 2026). Layanan baca/tulis untuk Order Produksi:
//   • bukti aplikasi per unit (loadAppEvidence) — dasar kontrak "satu status kerja efektif";
//   • catatan status kerja manual (append-only, ditolak bila bukti aplikasi ada);
//   • RENCANA bahan per unit (revisi + riwayat; TIDAK mengurangi stok, tidak menulis reservasi/jurnal);
//   • katalog bahan per kelompok Gudang + ketersediaan yang jujur (saldo tidak diketahui = null, bukan nol);
//   • pemakaian AKTUAL dengan dokumen sumber dan pelaku (dibaca dari ledger stok resmi).
// Tidak membuat tahap, QC, foto, penerimaan Gudang, atau pergerakan stok.
import { MANUAL_STATUSES, WORK_STATUS, riwayatKerjaManual } from "../lib/domain/productionWorkStatus.js";
import { uraiCatatanPembetulan } from "./pembetulanBahanUnit.js";
import { teksDasarHarga } from "./finance/hargaBerlaku.js";
import { RencanaBahanError, normalisasiBarisRencana, selisihRencana, sameLines } from "../lib/domain/productionMaterialPlan.js";
import { kelompokDariItemGroup, KELOMPOK_BELUM, LABEL_BELUM, KELOMPOK, URUTAN_KELOMPOK } from "../constants/kelompokBahan.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { stokLokasi } from "./stokLokasi.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export class AdopsiError extends Error {
  constructor(message, code = "ADOPSI_DITOLAK", statusCode = 409, extra = null) { super(message); this.name = "AdopsiError"; this.code = code; this.statusCode = statusCode; if (extra) this.extra = extra; }
}

const uniq = (ids) => [...new Set((ids || []).filter(Boolean))];

// ───────────────────────────── bukti aplikasi ─────────────────────────────
/** Map unitId → { started, firstEvidenceAt }. Bukti = log tahap V1 non-SKIP, atau operasi V2 yang benar-benar dimulai (non-lewati), atau bukti tahap V2 non-lewati. */
export async function loadAppEvidence(db, unitIds) {
  const ids = uniq(unitIds);
  const out = new Map(ids.map((id) => [id, { started: false, firstEvidenceAt: null }]));
  if (!ids.length) return out;
  const rows = await db.$queryRaw`
    SELECT x.unit_id::text AS "unitId", MIN(x.t) AS "firstAt" FROM (
      SELECT l.unit_id, l.created_at AS t FROM unit_stage_logs l WHERE l.unit_id = ANY(${ids}::uuid[]) AND l.action::text <> 'SKIP'
      UNION ALL
      SELECT r.unit_id, o.started_at AS t FROM production_operation_runs_v2 o JOIN production_runs_v2 r ON r.id = o.run_id
        WHERE r.unit_id = ANY(${ids}::uuid[]) AND o.started_at IS NOT NULL AND o.status::text <> 'SKIPPED'
      UNION ALL
      SELECT r.unit_id, e.created_at AS t FROM production_step_evidence_v2 e JOIN production_runs_v2 r ON r.id = e.run_id
        WHERE r.unit_id = ANY(${ids}::uuid[]) AND LEFT(e.step_code, 4) <> 'DOC_' AND COALESCE(e.payload->>'outcome', '') <> 'SKIPPED'
    ) x GROUP BY x.unit_id`;
  for (const r of rows) out.set(r.unitId, { started: true, firstEvidenceAt: r.firstAt });
  return out;
}

async function namaPelaku(db, actorIds) {
  const ids = uniq(actorIds);
  if (!ids.length) return new Map();
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

// ───────────────────────────── catatan status kerja manual ─────────────────────────────
/** Map unitId → entri manual TERAKHIR (dengan actor.name). */
export async function loadLatestManual(db, unitIds) {
  const ids = uniq(unitIds);
  const out = new Map();
  if (!ids.length) return out;
  const rows = await db.productionUnitWorkProgress.findMany({ where: { unitId: { in: ids } }, orderBy: [{ unitId: "asc" }, { createdAt: "desc" }, { id: "desc" }], distinct: ["unitId"] });
  const nama = await namaPelaku(db, rows.map((r) => r.actorId));
  for (const r of rows) out.set(r.unitId, { ...r, actor: r.actorId ? { id: r.actorId, name: nama.get(r.actorId) ?? null } : null });
  return out;
}

export async function riwayatKerjaUnit(db, unitId, firstEvidenceAt = null) {
  const rows = await db.productionUnitWorkProgress.findMany({ where: { unitId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const nama = await namaPelaku(db, rows.map((r) => r.actorId));
  return riwayatKerjaManual(rows.map((r) => ({ ...r, actor: r.actorId ? { name: nama.get(r.actorId) ?? null } : null })), { firstEvidenceAt });
}

/** Catat status kerja manual. Atomik + idempoten (status yang sama dengan catatan terakhir = tidak menulis apa pun). */
export async function catatStatusKerjaManual(prisma, { unitId, status, note = null, actorId, expectedLatestId } = {}) {
  if (!MANUAL_STATUSES.includes(status)) throw new AdopsiError(`Status kerja harus salah satu dari: ${MANUAL_STATUSES.join(", ")}`, "STATUS_KERJA_TIDAK_VALID", 400);
  const catatan = typeof note === "string" ? note.trim() : "";
  if (catatan.length > 500) throw new AdopsiError("Catatan maksimal 500 karakter", "CATATAN_TERLALU_PANJANG", 400);
  if (status === "TERTUNDA" && catatan.length < 3) throw new AdopsiError("Status Tertunda wajib disertai catatan (minimal 3 karakter)", "CATATAN_WAJIB", 400);
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
    if (!unit) throw new AdopsiError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
    if (["CANCELLED", "DELIVERED"].includes(unit.status)) throw new AdopsiError(`Unit ${unit.unitCode} sudah ${unit.status === "CANCELLED" ? "dibatalkan" : "terkirim"}; status kerja tidak dicatat lagi`, "UNIT_TIDAK_AKTIF");
    const bukti = (await loadAppEvidence(tx, [unitId])).get(unitId);
    if (bukti?.started) throw new AdopsiError(`Unit ${unit.unitCode} sudah dikerjakan lewat aplikasi Produksi; status kerja mengikuti aplikasi dan tidak bisa dicatat manual`, "KERJA_DIPEGANG_APLIKASI");
    const terakhir = await tx.productionUnitWorkProgress.findFirst({ where: { unitId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (expectedLatestId !== undefined && (expectedLatestId ?? null) !== (terakhir?.id ?? null)) {
      const nama = terakhir?.actorId ? (await namaPelaku(tx, [terakhir.actorId])).get(terakhir.actorId) : null;
      throw new AdopsiError("Status kerja sudah diubah orang lain. Muat ulang untuk melihat catatan terbaru, lalu ulangi jika masih perlu.", "RIWAYAT_BERUBAH", 409, { terakhir: terakhir ? { id: terakhir.id, status: terakhir.status, oleh: nama, at: terakhir.createdAt } : null });
    }
    if (terakhir && terakhir.status === status && (terakhir.note ?? "") === catatan) return { dicatat: false, entri: terakhir, unitCode: unit.unitCode };
    if (!terakhir && status === "BELUM_DIJADWALKAN") return { dicatat: false, entri: null, unitCode: unit.unitCode }; // tidak ada yang perlu dikosongkan
    const entri = await tx.productionUnitWorkProgress.create({ data: { unitId, status, note: catatan || null, actorId: actorId ?? null } });
    const aktor = actorId ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null;
    await recordActivity(tx, {
      entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_STATUS_KERJA_MANUAL, actorId: actorId ?? null,
      metadata: { unitCode: unit.unitCode, orderId: unit.orderId, from: terakhir?.status ?? null, to: status, note: catatan || null, deciderName: aktor?.name ?? null },
    });
    return { dicatat: true, entri, unitCode: unit.unitCode };
  });
}

// ───────────────────────────── katalog bahan per kelompok ─────────────────────────────
export function urutanKelompok() { return URUTAN_KELOMPOK.map((kode) => ({ kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode] })); }

async function bahanProduksiAktif(db) {
  const rows = await db.material.findMany({ where: { active: true, OR: [{ kind: null }, { kind: { not: "PERLENGKAPAN_STOK" } }] }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/** Katalog bahan untuk rencana. `q` mencari di SELURUH katalog (kode/nama), bukan hanya satu kelompok; `kelompok` menyaring bila tidak ada pencarian atau bila diminta eksplisit. */
export async function katalogBahan(db, { q = "", kelompok = null, limit = 80 } = {}) {
  const [{ rows }, boleh] = await Promise.all([stokLokasi(db), bahanProduksiAktif(db)]);
  const aktif = rows.filter((r) => r.aktif && boleh.has(r.materialId));
  const cari = String(q || "").trim().toLowerCase();
  const cocokQ = (r) => !cari || r.kode?.toLowerCase().includes(cari) || r.nama?.toLowerCase().includes(cari);
  const dasarQ = aktif.filter(cocokQ);
  const hitung = new Map(URUTAN_KELOMPOK.map((k) => [k, 0]));
  for (const r of dasarQ) hitung.set(r.kelompok?.kode ?? KELOMPOK_BELUM, (hitung.get(r.kelompok?.kode ?? KELOMPOK_BELUM) ?? 0) + 1);
  const dipilih = kelompok ? dasarQ.filter((r) => (r.kelompok?.kode ?? KELOMPOK_BELUM) === kelompok) : dasarQ;
  dipilih.sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id"));
  const lim = Math.min(Math.max(parseInt(limit, 10) || 80, 1), 300);
  return {
    total: dipilih.length,
    kelompok: urutanKelompok().map((k) => ({ ...k, jumlah: hitung.get(k.kode) ?? 0 })),
    rows: dipilih.slice(0, lim).map(barisKatalog),
    catatan: "Ketersediaan dihitung dari ledger pergerakan stok. 'Belum diketahui' berarti bahan belum punya catatan stok — bukan nol.",
  };
}
function barisKatalog(r) {
  return {
    materialId: r.materialId, kode: r.kode, nama: r.nama, satuan: r.satuan, kelompok: { kode: r.kelompok?.kode ?? KELOMPOK_BELUM, label: r.kelompok?.label ?? LABEL_BELUM },
    tersedia: r.tersedia, saldo: r.saldo, saldoDiketahui: r.saldo !== null, keadaan: r.keadaan, keadaanLabel: r.keadaanLabel,
  };
}

// ───────────────────────────── rencana bahan ─────────────────────────────
async function petaBahan(db, ids) {
  const list = uniq(ids);
  if (!list.length) return new Map();
  const rows = await db.material.findMany({ where: { id: { in: list } }, select: { id: true, code: true, name: true, unit: true, active: true, itemGroup: true } });
  return new Map(rows.map((m) => [m.id, { id: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active, kelompok: kelompokDariItemGroup(m.itemGroup) }]));
}

export async function ambilRencanaBahan(db, unitId) {
  const plan = await db.productionUnitMaterialPlan.findUnique({ where: { unitId }, include: { revisions: { orderBy: { revision: "asc" } } } });
  if (!plan) return { plan: null, revisi: [] };
  const semua = [...plan.revisions.flatMap((r) => r.lines.map((l) => l.materialId)), ...plan.lines.map((l) => l.materialId)];
  const bahan = await petaBahan(db, semua);
  const nama = await namaPelaku(db, [plan.createdById, plan.updatedById, ...plan.revisions.map((r) => r.actorId)]);
  const katalog = new Map((await stokLokasi(db)).rows.map((r) => [r.materialId, r]));
  const baris = plan.lines.map((l) => {
    const b = bahan.get(l.materialId); const k = katalog.get(l.materialId);
    return { materialId: l.materialId, qty: Number(l.qty), kode: b?.kode ?? null, nama: b?.nama ?? "(bahan tidak ditemukan)", satuan: b?.satuan ?? null, kelompok: { kode: b?.kelompok?.kode ?? KELOMPOK_BELUM, label: b?.kelompok?.label ?? LABEL_BELUM }, tersedia: k?.tersedia ?? null, saldoDiketahui: (k?.saldo ?? null) !== null, aktif: b?.aktif ?? false };
  });
  const revisi = plan.revisions.map((r, i) => ({
    revision: r.revision, at: r.createdAt, oleh: r.actorId ? nama.get(r.actorId) ?? null : null, alasan: r.reason ?? null,
    perubahan: selisihRencana(i === 0 ? [] : plan.revisions[i - 1].lines, r.lines, bahan),
  }));
  return { plan: { id: plan.id, revision: plan.revision, lines: baris, updatedAt: plan.updatedAt, updatedBy: plan.updatedById ? nama.get(plan.updatedById) ?? null : null, createdAt: plan.createdAt }, revisi };
}

/** Simpan/revisi rencana bahan. Konflik revisi = 409 RIWAYAT_BERUBAH tanpa menulis. Tidak menyentuh stok/reservasi/jurnal. */
export async function simpanRencanaBahan(prisma, { unitId, lines, expectedRevision = 0, reason = null, actorId } = {}) {
  const alasan = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "units", unitId);
    const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
    if (!unit) throw new AdopsiError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404);
    if (["CANCELLED", "DELIVERED"].includes(unit.status)) throw new AdopsiError(`Unit ${unit.unitCode} sudah ${unit.status === "CANCELLED" ? "dibatalkan" : "terkirim"}; rencana bahan tidak diubah lagi`, "UNIT_TIDAK_AKTIF");
    const bahan = await petaBahan(tx, (lines || []).map((l) => l?.materialId));
    const baru = normalisasiBarisRencana(lines, bahan);
    const ada = await tx.productionUnitMaterialPlan.findUnique({ where: { unitId } });
    const rev = Number(expectedRevision ?? 0);
    if (!ada) {
      if (rev !== 0) throw new AdopsiError("Rencana bahan belum pernah dibuat untuk unit ini (revisi yang Anda lihat sudah tidak ada). Muat ulang.", "RIWAYAT_BERUBAH", 409, { revisiSekarang: 0 });
      if (baru.length === 0) throw new RencanaBahanError("Pilih minimal satu bahan untuk rencana", "RENCANA_BAHAN_KOSONG");
      const plan = await tx.productionUnitMaterialPlan.create({ data: { unitId, revision: 1, lines: baru, createdById: actorId ?? null, updatedById: actorId ?? null } });
      await tx.productionUnitMaterialPlanRevision.create({ data: { planId: plan.id, revision: 1, lines: baru, reason: alasan || null, actorId: actorId ?? null } });
      await catatAktivitasRencana(tx, { unit, actorId, revision: 1, perubahan: selisihRencana([], baru, bahan), alasan });
      return { disimpan: true, revision: 1 };
    }
    if (ada.revision !== rev) {
      const siapa = ada.updatedById ? (await namaPelaku(tx, [ada.updatedById])).get(ada.updatedById) : null;
      throw new AdopsiError(`Rencana bahan sudah direvisi${siapa ? ` oleh ${siapa}` : ""} (revisi ${ada.revision}). Muat revisi terbaru, lalu terapkan perubahan Anda lagi.`, "RIWAYAT_BERUBAH", 409, { revisiSekarang: ada.revision, oleh: siapa, at: ada.updatedAt });
    }
    if (sameLines(ada.lines, baru)) return { disimpan: false, revision: ada.revision };
    const next = ada.revision + 1;
    await tx.productionUnitMaterialPlan.update({ where: { id: ada.id }, data: { revision: next, lines: baru, updatedById: actorId ?? null, updatedAt: new Date() } });
    await tx.productionUnitMaterialPlanRevision.create({ data: { planId: ada.id, revision: next, lines: baru, reason: alasan || null, actorId: actorId ?? null } });
    const semua = await petaBahan(tx, [...ada.lines.map((l) => l.materialId), ...baru.map((l) => l.materialId)]);
    await catatAktivitasRencana(tx, { unit, actorId, revision: next, perubahan: selisihRencana(ada.lines, baru, semua), alasan });
    return { disimpan: true, revision: next };
  });
}
async function catatAktivitasRencana(tx, { unit, actorId, revision, perubahan, alasan }) {
  const aktor = actorId ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null;
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.UNIT, entityId: unit.id, eventType: EVENT_TYPES.PRODUCTION_RENCANA_BAHAN_DISIMPAN, actorId: actorId ?? null,
    metadata: { unitCode: unit.unitCode, orderId: unit.orderId, revision, jumlahPerubahan: perubahan.length, perubahan: perubahan.slice(0, 30), alasan: alasan || null, deciderName: aktor?.name ?? null },
  });
}

// ───────────────────────────── pemakaian aktual ─────────────────────────────
/** Pemakaian/penyerahan bahan yang SUDAH tercatat di ledger resmi untuk unit ini, dengan dokumen sumber + pelaku. Baca-saja. */
export async function ambilPemakaianAktual(db, unitId, { izinHarga = false } = {}) {
  const mv = await db.stockMovement.findMany({
    where: { unitId, type: { in: ["ISSUE", "RETURN", "WASTE"] } },
    select: {
      id: true, type: true, qty: true, note: true, reason: true, createdAt: true, materialIssueId: true,
      material: { select: { id: true, code: true, name: true, unit: true, itemGroup: true } }, createdBy: { select: { id: true, name: true } },
      materialIssue: { select: { id: true, issueNumber: true } },
      biayaOperasional: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });
  const baris = mv.map((m) => {
    const dokumen = m.materialIssue ? { jenis: "Material Issue Gudang", nomor: m.materialIssue.issueNumber } : m.type === "WASTE" ? { jenis: "Catatan sisa/rusak", nomor: `MV-${m.id.slice(0, 8).toUpperCase()}` } : { jenis: "Catat langsung (Produksi)", nomor: `MV-${m.id.slice(0, 8).toUpperCase()}` };
    return {
      id: m.id, tanggal: m.createdAt, tipe: m.type, qty: -Number(m.qty), // positif = bahan dipakai; negatif = dikembalikan
      kode: m.material.code, nama: m.material.name, satuan: m.material.unit, materialId: m.material.id, kelompok: kelompokDariItemGroup(m.material.itemGroup),
      dokumen, pelaku: m.createdBy?.name ?? null, catatan: m.note ?? m.reason ?? null,
      // Pembetulan unit terkirim: tanggal pemakaian yang DILAPORKAN (dari catatan baku) tampil terpisah dari waktu pencatatan (= tanggal). Null untuk pencatatan biasa.
      dilaporkan: uraiCatatanPembetulan(m.note)?.dilaporkan ?? null,
      // Dasar harga HPP operasional hasil pembekuan (sama dengan pratinjau, jejak biaya, dan Excel): hanya untuk pembetulan, supaya tanggal dilaporkan + harga yang dipakai terlihat di Riwayat.
      hppOperasional: (() => {
        const dil = uraiCatatanPembetulan(m.note)?.dilaporkan; if (!dil) return null; const o = m.biayaOperasional?.[0] ?? null;
        if (!o) return { status: "BELUM_DIBEKUKAN", harga: null, nilai: null, tanggalDasar: dil, dasarTeks: "Harga operasional belum dibekukan" };
        return { status: o.status === "DINILAI" ? "DINILAI" : o.status === "GAGAL_PEMBEKUAN" ? "GAGAL_PEMBEKUAN" : "TANPA_HARGA", harga: izinHarga && o.unitCost != null ? Number(o.unitCost) : null, nilai: izinHarga && o.value != null ? Number(o.value) : null, hargaTersembunyi: !izinHarga && o.unitCost != null, tanggalDasar: dil, dasarTeks: teksDasarHarga(o.basisHarga, dil) };
      })(),
    };
  });
  const total = new Map();
  for (const b of baris) { const o = total.get(b.materialId) ?? { materialId: b.materialId, kode: b.kode, nama: b.nama, satuan: b.satuan, kelompok: b.kelompok, dipakai: 0 }; o.dipakai += b.qty; total.set(b.materialId, o); }
  return { baris, total: [...total.values()].map((t) => ({ ...t, dipakai: Math.round(t.dipakai * 10000) / 10000 })) };
}

export { WORK_STATUS };
