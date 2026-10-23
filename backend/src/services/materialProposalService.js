// USULAN BAHAN KATALOG (Okt 2026, UX Bahan → tombol "Bahan belum ada?"). Produksi mengusulkan; Gudang memutuskan.
//   • Mengajukan usulan HANYA menulis baris material_proposals. TIDAK membuat Material, saldo, penerimaan, pergerakan stok, biaya, atau jurnal.
//   • Keputusan Gudang: SETUJUI (Material dibuat di katalog, tanpa saldo awal) · GABUNG (usulan = bahan yang sudah ada) · TOLAK (alasan wajib).
//   • Periksa duplikasi nama/kode SEBELUM menulis; usulan terbuka satu per nama (indeks unik parsial) → klik ganda = baris yang sama.
//   • Membuat Material di sini memakai bentuk data yang SAMA dengan POST /api/inventory/materials (kode huruf besar, satuan enum, kategori enum) — bukan jalur stok.
import { MaterialCategory, MaterialUnit } from "@prisma/client";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { KELOMPOK, kelompokDariItemGroup } from "../constants/kelompokBahan.js";
import { BahanUsulanError, CATATAN_USULAN, STATUS_USULAN, adaKembarSama, cariKembar, normalisasiKeputusan, normalisasiUsulan, saranKode, subJenisKelompok } from "../lib/domain/bahanUsulan.js";

const KATEGORI_VALID = Object.values(MaterialCategory);
// Sub-jenis bawaan per kelompok bila hanya ada satu pilihan yang jelas; selain itu Gudang memilih (tidak menebak).
const SUBJENIS_BAWAAN = Object.freeze({ BUSA: "BUSA", KAIN: "KAIN", BENANG: "BENANG", KAYU: "KAYU", LEM_KIMIA: "LEM" });

async function namaPelaku(db, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}
const bahanKatalog = async (db) => (await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true } })).map((m) => ({ id: m.id, kode: m.code, nama: m.name, satuan: m.unit, aktif: m.active }));
const usulanTerbuka = (db) => db.materialProposal.findMany({ where: { status: "MENUNGGU_GUDANG" }, select: { id: true, name: true, nameKey: true, unit: true } });

/** Baca-saja: kandidat kembar untuk nama/kode yang sedang diketik + saran kode. */
export async function cekKembarBahan(db, { name, code = null }) {
  const nama = String(name ?? "").trim();
  if (nama.length < 2) return { kandidat: [], adaSama: false, adaMirip: false };
  const [bahan, terbuka] = await Promise.all([bahanKatalog(db), usulanTerbuka(db)]);
  const kandidat = cariKembar({ nama, kode: code, bahan, usulanTerbuka: terbuka }).slice(0, 8);
  return { kandidat, adaSama: adaKembarSama(kandidat), adaMirip: kandidat.some((k) => k.tingkat === "MIRIP") };
}

const tampilUsulan = (p, nama, kodeAda = null, unitCode = null) => ({
  id: p.id, name: p.name, unit: p.unit, kelompok: { kode: p.kelompok, label: KELOMPOK[p.kelompok] ?? p.kelompok }, itemGroup: p.itemGroup, description: p.description,
  status: p.status, statusLabel: STATUS_USULAN[p.status] ?? p.status, diajukanOleh: nama.get(p.requestedById) ?? null, diajukanAt: p.requestedAt, unitId: p.unitId, unitCode,
  materialId: p.materialId, material: p.material ? { id: p.material.id, kode: p.material.code, nama: p.material.name } : null,
  diputuskanOleh: p.decidedById ? nama.get(p.decidedById) ?? null : null, diputuskanAt: p.decidedAt, catatanKeputusan: p.decisionNote,
  ...(kodeAda ? { saranKode: saranKode({ name: p.name, kelompok: p.kelompok }, kodeAda), subJenis: subJenisKelompok(p.kelompok), subJenisBawaan: SUBJENIS_BAWAAN[p.kelompok] ?? null } : {}),
  dampakStok: "Tidak ada (usulan bukan stok: tanpa saldo, penerimaan, pergerakan, biaya, atau jurnal).",
});

/** Ajukan usulan bahan baru. Idempoten per nama: usulan terbuka yang sama dikembalikan apa adanya (replayed). */
export async function ajukanBahanBaru(prisma, { input, actorId, konfirmasiBedaDariKandidat = false }) {
  const data = normalisasiUsulan(input);
  const jalankan = () => prisma.$transaction(async (tx) => {
    const [bahan, terbuka] = await Promise.all([bahanKatalog(tx), tx.materialProposal.findMany({ where: { status: "MENUNGGU_GUDANG" } })]);
    const kandidat = cariKembar({ nama: data.name, bahan, usulanTerbuka: terbuka });
    const kembarUsulan = kandidat.find((k) => k.jenis === "USULAN" && k.tingkat === "SAMA");
    if (kembarUsulan) {
      const ada = terbuka.find((u) => u.id === kembarUsulan.proposalId);
      const nama = await namaPelaku(tx, [ada.requestedById]);
      return { replayed: true, usulan: tampilUsulan(ada, nama), catatan: CATATAN_USULAN };
    }
    const kembarKatalog = kandidat.filter((k) => k.jenis === "KATALOG");
    if (adaKembarSama(kembarKatalog)) throw new BahanUsulanError("Bahan dengan nama ini sudah ada di katalog. Pilih bahan itu, bukan mengusulkan yang baru.", "BAHAN_SUDAH_ADA", 409, { kandidat: kandidat.slice(0, 8) });
    if (kandidat.length && !konfirmasiBedaDariKandidat) throw new BahanUsulanError("Ada bahan atau usulan yang namanya mirip. Periksa dulu; bila memang berbeda, ajukan dengan konfirmasi.", "BAHAN_MIRIP_ADA", 409, { kandidat: kandidat.slice(0, 8) });
    let unit = null;
    if (data.unitId) { unit = await tx.unit.findUnique({ where: { id: data.unitId }, select: { id: true, unitCode: true } }); if (!unit) throw new BahanUsulanError("Unit tidak ditemukan", "UNIT_TIDAK_ADA", 404); }
    const baris = await tx.materialProposal.create({ data: { name: data.name, nameKey: data.nameKey, unit: data.unit, kelompok: data.kelompok, itemGroup: data.itemGroup, description: data.description, requestedById: actorId, unitId: unit?.id ?? null } });
    const nama = await namaPelaku(tx, [actorId]);
    await recordActivity(tx, { entityType: ENTITY_TYPES.MATERIAL_PROPOSAL, entityId: baris.id, eventType: EVENT_TYPES.PRODUCTION_USULAN_BAHAN_DIAJUKAN, actorId, metadata: { name: data.name, unit: data.unit, kelompok: data.kelompok, unitCode: unit?.unitCode ?? null, deciderName: nama.get(actorId) ?? null } });
    return { replayed: false, usulan: tampilUsulan(baris, nama, null, unit?.unitCode ?? null), catatan: CATATAN_USULAN };
  });
  try { return await jalankan(); } catch (e) {
    if (e?.code !== "P2002") throw e;
    // dua klik/dua tab bersamaan: indeks unik parsial menolak yang kedua → kembalikan usulan terbuka yang sudah ada
    const ada = await prisma.materialProposal.findFirst({ where: { nameKey: data.nameKey, status: "MENUNGGU_GUDANG" } });
    if (!ada) throw e;
    return { replayed: true, usulan: tampilUsulan(ada, await namaPelaku(prisma, [ada.requestedById])), catatan: CATATAN_USULAN };
  }
}

/** Antrean usulan untuk Gudang/Admin (baca-saja). Usulan menunggu didahulukan; saran kode + sub-jenis hanya untuk yang menunggu. */
export async function daftarUsulan(db, { status = null, q = "", limit = 100 } = {}) {
  const cari = String(q || "").trim();
  const where = { ...(status && STATUS_USULAN[status] ? { status } : {}), ...(cari ? { name: { contains: cari, mode: "insensitive" } } : {}) };
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 300);
  const [rows, hitung, kodeRows] = await Promise.all([
    db.materialProposal.findMany({ where, include: { material: { select: { id: true, code: true, name: true } }, unitContext: { select: { unitCode: true } } }, orderBy: [{ requestedAt: "desc" }], take: lim }),
    db.materialProposal.groupBy({ by: ["status"], _count: { _all: true } }),
    db.material.findMany({ select: { code: true } }),
  ]);
  const kodeAda = new Set(kodeRows.map((m) => m.code));
  const nama = await namaPelaku(db, rows.flatMap((r) => [r.requestedById, r.decidedById]));
  const urut = [...rows].sort((a, b) => (a.status === "MENUNGGU_GUDANG" ? 0 : 1) - (b.status === "MENUNGGU_GUDANG" ? 0 : 1) || new Date(b.requestedAt) - new Date(a.requestedAt));
  const jumlah = Object.fromEntries(Object.keys(STATUS_USULAN).map((s) => [s, 0])); for (const h of hitung) jumlah[h.status] = h._count._all;
  return { rows: urut.map((r) => tampilUsulan(r, nama, r.status === "MENUNGGU_GUDANG" ? kodeAda : null, r.unitContext?.unitCode ?? null)), jumlah, kategori: KATEGORI_VALID, catatan: CATATAN_USULAN };
}

/** Keputusan Gudang. Idempoten: keputusan yang sama oleh pelaku yang sama pada usulan yang sudah diputuskan dikembalikan apa adanya. */
export async function putuskanUsulan(prisma, { proposalId, input, actorId }) {
  const d = normalisasiKeputusan(input);
  return prisma.$transaction(async (tx) => {
    await lockRowForUpdate(tx, "material_proposals", proposalId);
    const p = await tx.materialProposal.findUnique({ where: { id: proposalId }, include: { material: { select: { id: true, code: true, name: true } } } });
    if (!p) throw new BahanUsulanError("Usulan tidak ditemukan", "USULAN_TIDAK_ADA", 404);
    const hasilStatus = { SETUJUI: "DISETUJUI", GABUNG: "DIGABUNG", TOLAK: "DITOLAK" }[d.keputusan];
    if (p.status !== "MENUNGGU_GUDANG") {
      const sama = p.status === hasilStatus && p.decidedById === actorId && (d.keputusan !== "GABUNG" || p.materialId === d.materialId) && (d.keputusan !== "SETUJUI" || p.material?.code === d.kode);
      if (sama) return { replayed: true, usulan: tampilUsulan(p, await namaPelaku(tx, [p.requestedById, p.decidedById])) };
      const siapa = p.decidedById ? (await namaPelaku(tx, [p.decidedById])).get(p.decidedById) : null;
      throw new BahanUsulanError(`Usulan ini sudah diputuskan${siapa ? ` oleh ${siapa}` : ""} (${STATUS_USULAN[p.status]}). Muat ulang.`, "USULAN_SUDAH_DIPUTUSKAN", 409, { status: p.status });
    }
    const aktor = (await namaPelaku(tx, [actorId])).get(actorId) ?? null;
    let materialId = null; let materialCode = null;
    if (d.keputusan === "SETUJUI") {
      const itemGroup = d.itemGroup ?? p.itemGroup ?? SUBJENIS_BAWAAN[p.kelompok] ?? null;
      if (!itemGroup) throw new BahanUsulanError("Pilih sub-jenis bahan supaya kategorinya benar di Stok & Lokasi.", "KEPUTUSAN_SUBJENIS_WAJIB", 400, { subJenis: subJenisKelompok(p.kelompok) });
      if (kelompokDariItemGroup(itemGroup).kode !== p.kelompok) throw new BahanUsulanError("Sub-jenis tidak sesuai dengan kategori usulan.", "KEPUTUSAN_SUBJENIS_INVALID", 400, { subJenis: subJenisKelompok(p.kelompok) });
      if (d.category && !KATEGORI_VALID.includes(d.category)) throw new BahanUsulanError("Jenis persediaan tidak valid.", "KEPUTUSAN_KATEGORI_INVALID", 400);
      if (!Object.values(MaterialUnit).includes(p.unit)) throw new BahanUsulanError("Satuan usulan tidak valid.", "USULAN_SATUAN_INVALID", 400);
      const kembar = cariKembar({ nama: p.name, kode: d.kode, bahan: await bahanKatalog(tx) }).filter((k) => k.tingkat === "SAMA");
      if (kembar.length) throw new BahanUsulanError(`Bahan dengan ${kembar[0].alasan.toLowerCase()} sudah ada di katalog (${kembar[0].kode}). Gabungkan usulan ke bahan itu, atau ubah kode.`, "BAHAN_SUDAH_ADA", 409, { kandidat: kembar });
      // PERHATIAN: hanya baris katalog. Tidak ada StockMovement, saldo awal, penerimaan, harga, atau jurnal.
      const m = await tx.material.create({ data: { code: d.kode, name: p.name, unit: p.unit, category: d.category ?? null, itemGroup, active: true, dataNote: `Dibuat dari usulan Produksi ${p.id.slice(0, 8)}; belum ada saldo/penerimaan` } });
      materialId = m.id; materialCode = m.code;
    } else if (d.keputusan === "GABUNG") {
      const m = await tx.material.findUnique({ where: { id: d.materialId }, select: { id: true, code: true, name: true, unit: true, active: true } });
      if (!m) throw new BahanUsulanError("Bahan tujuan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
      if (!m.active) throw new BahanUsulanError("Bahan tujuan sudah nonaktif", "BAHAN_NONAKTIF", 409);
      if (m.unit !== p.unit) throw new BahanUsulanError(`Satuan usulan (${p.unit}) berbeda dari satuan bahan tujuan (${m.unit}). Gabungkan hanya bila satuannya sama.`, "SATUAN_BEDA", 409, { satuanUsulan: p.unit, satuanBahan: m.unit });
      materialId = m.id; materialCode = m.code;
    }
    const baru = await tx.materialProposal.update({ where: { id: p.id }, data: { status: hasilStatus, materialId, decidedById: actorId, decidedAt: new Date(), decisionNote: d.catatan ?? null }, include: { material: { select: { id: true, code: true, name: true } } } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.MATERIAL_PROPOSAL, entityId: p.id, eventType: EVENT_TYPES.PRODUCTION_USULAN_BAHAN_DIPUTUSKAN, actorId, metadata: { name: p.name, keputusan: hasilStatus, materialId, materialCode, catatan: d.catatan ?? null, deciderName: aktor } });
    return { replayed: false, usulan: tampilUsulan(baru, await namaPelaku(tx, [p.requestedById, actorId])) };
  });
}
