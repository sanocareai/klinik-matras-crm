// STOCK OPNAME SESI MODEL 2 (Okt 2026) — cakupan yang disimpan, waktu acuan hitung per bahan, progres. Murni di mana mungkin (tanpa DB) supaya aturan waktu mudah diuji.
//
// ATURAN WAKTU ACUAN (satu-satunya definisi; dipakai Pemeriksa, Selesaikan, dan layar):
//   • Setiap hasil hitung punya `countedAt` = waktu SERVER saat angka itu terakhir disimpan. Angka fisik dianggap menggambarkan keadaan gudang pada saat itu.
//   • Saldo sistem yang sebanding = Σ qty pergerakan ledger bahan itu dengan createdAt ≤ countedAt (selain penyesuaian milik sesi ini sendiri). Dihitung dari ledger, bukan snapshot awal sesi.
//   • Pergerakan SESUDAH countedAt tidak masuk pembanding (fisik belum memuatnya) dan tetap utuh di ledger → tidak ada selisih palsu, tidak terhitung dua kali.
//   • Pergerakan SEBELUM (countedAt − JENDELA_RAGU_MENIT) sudah pasti ada di fisik → ikut pembanding otomatis.
//   • Pergerakan di JENDELA RAGU (JENDELA_RAGU_MENIT terakhir sebelum countedAt, sesudah sesi dimulai) mungkin belum tercermin di fisik (barang masuk/keluar rak persis saat dihitung):
//     penghitung/pemeriksa menandainya (sudah/belum tercermin), sama seperti mekanisme tanda sesi lama; Selesaikan ditolak selama ada yang belum ditandai. "Belum" = dikeluarkan dari pembanding.
//   • Penyesuaian = fisik − pembanding, ditulis SEKALI saat Selesaikan; ledger akhir = ledger saat itu + penyesuaian = fisik + pergerakan sesudah countedAt.
import { kelompokDariItemGroup, URUTAN_KELOMPOK, KELOMPOK, KELOMPOK_BELUM, LABEL_BELUM } from "../constants/kelompokBahan.js";
import { LABEL_JENIS } from "../constants/kelompokBahan.js";
import { muatPergerakanSesi } from "./pergerakanSesiHitung.js";

export const JENDELA_RAGU_MENIT = 30;
export const MAKS_BAHAN_CYCLE_COUNT = 50;
export const MODE = Object.freeze({ FULL: "FULL", GROUP: "GROUP", ITEMS: "ITEMS" });
export const AKSI_CAKUPAN_DIABAIKAN = "CAKUPAN_DIABAIKAN";
export const AKSI_BAHAN_DIKELUARKAN = "BAHAN_DIKELUARKAN";
export const AKSI_BAHAN_DIKEMBALIKAN = "BAHAN_DIKEMBALIKAN";
export const AKSI_BAHAN_DITAMBAHKAN = "BAHAN_DITAMBAHKAN";

const r4 = (x) => Math.round(Number(x) * 10000) / 10000;
const JENIS_VALID = new Set([...Object.keys(LABEL_JENIS), "NONE"]);

export class GalatSesi extends Error {
  constructor(pesan, status = 400, code = null) { super(pesan); this.statusCode = status; if (code) this.code = code; }
}

/** Murni. Klasifikasi satu pergerakan terhadap waktu hitung bahan itu. */
export function klasifikasiPergerakan(at, countedAt, { jendelaMenit = JENDELA_RAGU_MENIT } = {}) {
  if (!countedAt) return "BAHAN_BELUM_DIHITUNG";
  const t = new Date(at).getTime(); const c = new Date(countedAt).getTime();
  if (t > c) return "SETELAH_HITUNG";
  if (t > c - jendelaMenit * 60_000) return "JENDELA_RAGU";
  return "SEBELUM_HITUNG";
}

/**
 * Murni. Pembanding = saldo ledger sampai countedAt − Σ qty pergerakan jendela-ragu yang ditandai BELUM tercermin di fisik.
 * pergerakanBahan: [{id, at, qty, tanda: null|"SUDAH_TERHITUNG"|"BELUM_TERHITUNG"}] untuk bahan itu (sesudah sesi dimulai).
 */
export function hitungPembanding({ saldoSampaiHitung, countedAt, countedQty, pergerakanBahan = [], jendelaMenit = JENDELA_RAGU_MENIT }) {
  const kelas = { sebelum: [], ragu: [], setelah: [] };
  for (const p of pergerakanBahan) {
    const k = klasifikasiPergerakan(p.at, countedAt, { jendelaMenit });
    if (k === "SEBELUM_HITUNG") kelas.sebelum.push(p); else if (k === "JENDELA_RAGU") kelas.ragu.push(p); else if (k === "SETELAH_HITUNG") kelas.setelah.push(p);
  }
  const belumDitandai = kelas.ragu.filter((p) => p.tanda === null);
  const dikeluarkan = r4(kelas.ragu.filter((p) => p.tanda === "BELUM_TERHITUNG").reduce((s, p) => s + Number(p.qty), 0));
  const pembanding = r4(Number(saldoSampaiHitung) - dikeluarkan);
  const selisih = countedQty == null ? null : r4(Number(countedQty) - pembanding);
  return { pembanding, selisih, berselisih: selisih !== null && Math.abs(selisih) > 1e-6, belumDitandai, ...kelas };
}

/** Murni. Progres total + per kelompok dari baris kompak { kelompokKode, counted, perluPeriksa, excluded }. */
export function ringkasProgres(baris) {
  const aktif = baris.filter((b) => !b.excluded);
  const dihitung = aktif.filter((b) => b.counted !== null && b.counted !== undefined);
  const mk = new Map(URUTAN_KELOMPOK.map((k) => [k, { total: 0, dihitung: 0, perluPeriksa: 0 }]));
  for (const b of aktif) {
    const o = mk.get(b.kelompokKode) ?? mk.get(KELOMPOK_BELUM); o.total += 1;
    if (b.counted !== null && b.counted !== undefined) o.dihitung += 1;
    if (b.perluPeriksa) o.perluPeriksa += 1;
  }
  return {
    total: aktif.length, dihitung: dihitung.length, belum: aktif.length - dihitung.length, perluPeriksa: aktif.filter((b) => b.perluPeriksa).length, dikeluarkan: baris.length - aktif.length,
    persen: aktif.length ? Math.round((dihitung.length / aktif.length) * 1000) / 10 : 0,
    perKelompok: URUTAN_KELOMPOK.map((kode) => ({ kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode], ...mk.get(kode) })).filter((k) => k.total > 0),
  };
}

/** Murni. Satu bahan memenuhi kriteria cakupan sesi (mode + kelompok + pengecualian jenis/bahan)? Bahan harus aktif. */
export function memenuhiCakupan(m, scope) {
  if (!m.active) return false;
  const jenis = m.category ?? "NONE";
  if ((scope.excludeJenis ?? []).includes(jenis)) return false;
  if ((scope.excludeMaterialIds ?? []).includes(m.id)) return false;
  if (scope.mode === MODE.FULL) return true;
  if (scope.mode === MODE.GROUP) return (scope.groups ?? []).includes(kelompokDariItemGroup(m.itemGroup).kode);
  return false; // ITEMS: hanya yang dipilih eksplisit
}

export async function muatBahan(db) {
  return db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true, category: true, itemGroup: true }, orderBy: { code: "asc" } });
}

function normalkanScope(body) {
  const mode = body?.mode;
  if (!Object.values(MODE).includes(mode)) throw new GalatSesi("Pilih cakupan: Opname penuh, Per kelompok, atau Cycle Count.", 400, "MODE_TIDAK_VALID");
  const groups = [...new Set(Array.isArray(body.groups) ? body.groups : [])];
  for (const g of groups) if (!URUTAN_KELOMPOK.includes(g)) throw new GalatSesi(`Kelompok tidak dikenal: ${g}`, 400, "KELOMPOK_TIDAK_VALID");
  const excludeJenis = [...new Set(Array.isArray(body.excludeJenis) ? body.excludeJenis : [])];
  for (const j of excludeJenis) if (!JENIS_VALID.has(j)) throw new GalatSesi(`Jenis bahan tidak dikenal: ${j}`, 400, "JENIS_TIDAK_VALID");
  const excludeMaterialIds = [...new Set(Array.isArray(body.excludeMaterialIds) ? body.excludeMaterialIds : [])];
  const materialIds = [...new Set(Array.isArray(body.materialIds) ? body.materialIds : [])];
  const excludeReason = typeof body.excludeReason === "string" ? body.excludeReason.trim() : "";
  if (mode === MODE.GROUP && groups.length === 0) throw new GalatSesi("Pilih minimal satu kelompok bahan.", 400, "KELOMPOK_KOSONG");
  if (mode === MODE.ITEMS && materialIds.length === 0) throw new GalatSesi("Pilih minimal satu bahan.", 400, "BAHAN_KOSONG");
  if (mode === MODE.ITEMS && materialIds.length > MAKS_BAHAN_CYCLE_COUNT) throw new GalatSesi(`Cycle Count dibatasi ${MAKS_BAHAN_CYCLE_COUNT} bahan. Untuk cakupan lebih besar pakai Per kelompok atau Opname penuh.`, 400, "TERLALU_BANYAK_BAHAN");
  if (mode !== MODE.ITEMS && excludeMaterialIds.length && excludeReason.length < 3) throw new GalatSesi("Alasan pengecualian bahan wajib diisi (min. 3 karakter).", 400, "ALASAN_PENGECUALIAN_WAJIB");
  return { mode, groups: mode === MODE.GROUP ? groups : [], excludeJenis: mode === MODE.ITEMS ? [] : excludeJenis, excludeMaterialIds: mode === MODE.ITEMS ? [] : excludeMaterialIds, materialIds: mode === MODE.ITEMS ? materialIds : [], excludeReason: mode === MODE.ITEMS ? "" : excludeReason };
}

/**
 * Pratinjau cakupan (BACA-SAJA) sekaligus daftar Material ID yang akan disimpan di sesi. `keadaan` (opsional) = Map(materialId → {saldo, keadaan}) dari stokLokasi untuk menandai bahan tanpa catatan/minus.
 */
export function bangunCakupan(bahan, body, keadaan = new Map()) {
  const scope = normalkanScope(body);
  const aktif = bahan.filter((m) => m.active); const nonaktif = bahan.filter((m) => !m.active);
  let masuk;
  if (scope.mode === MODE.ITEMS) {
    const peta = new Map(bahan.map((m) => [m.id, m]));
    masuk = scope.materialIds.map((id) => {
      const m = peta.get(id);
      if (!m) throw new GalatSesi("Ada bahan yang tidak ditemukan di master.", 400, "BAHAN_TIDAK_ADA");
      if (!m.active) throw new GalatSesi(`Bahan ${m.code} nonaktif dan tidak bisa dihitung.`, 400, "BAHAN_NONAKTIF");
      return m;
    });
  } else {
    masuk = aktif.filter((m) => memenuhiCakupan(m, scope));
  }
  const idsMasuk = new Set(masuk.map((m) => m.id));
  const pengecualianJenis = scope.excludeJenis.map((j) => ({ kode: j, label: j === "NONE" ? "Tanpa kategori" : LABEL_JENIS[j], jumlah: aktif.filter((m) => (m.category ?? "NONE") === j && (scope.mode === MODE.FULL || (scope.mode === MODE.GROUP && scope.groups.includes(kelompokDariItemGroup(m.itemGroup).kode)))).length }));
  const pengecualianBahan = scope.excludeMaterialIds.map((id) => { const m = bahan.find((x) => x.id === id); return m ? { materialId: m.id, kode: m.code, nama: m.name, alasan: scope.excludeReason } : { materialId: id, kode: "?", nama: "tidak ditemukan", alasan: scope.excludeReason }; });
  const perKelompok = URUTAN_KELOMPOK.map((kode) => ({
    kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode],
    masuk: masuk.filter((m) => kelompokDariItemGroup(m.itemGroup).kode === kode).length,
    aktif: aktif.filter((m) => kelompokDariItemGroup(m.itemGroup).kode === kode).length,
  }));
  const perSatuan = {}; for (const m of masuk) perSatuan[m.unit] = (perSatuan[m.unit] ?? 0) + 1;
  const ket = (m) => keadaan.get(m.id)?.keadaan;
  const ringkasan = {
    mode: scope.mode, bahanAktif: aktif.length, masuk: masuk.length, perKelompok,
    belumDikelompokkan: { masuk: perKelompok.find((k) => k.kode === KELOMPOK_BELUM)?.masuk ?? 0, catatan: "Bahan aktif yang belum dikelompokkan tetap ikut Opname penuh." },
    nonaktif: { jumlah: nonaktif.length, catatan: "Bahan nonaktif tidak ikut dihitung." },
    pengecualian: { jenis: pengecualianJenis, bahan: pengecualianBahan, totalBahanDikecualikan: aktif.filter((m) => scope.mode !== MODE.ITEMS && !idsMasuk.has(m.id) && ((scope.excludeJenis.includes(m.category ?? "NONE")) || scope.excludeMaterialIds.includes(m.id)) && (scope.mode === MODE.FULL || scope.groups.includes(kelompokDariItemGroup(m.itemGroup).kode))).length },
    tanpaCatatanStok: masuk.filter((m) => ket(m) === "BELUM_ADA_CATATAN").length, saldoMinus: masuk.filter((m) => ket(m) === "MINUS").length, perSatuan,
  };
  return { scope, materialIds: masuk.map((m) => m.id), ringkasan };
}

/** Bahan aktif yang memenuhi kriteria sesi tetapi BELUM ada di sesi dan belum diputuskan diabaikan → "di luar cakupan sesi". */
export function bahanDiLuarCakupan(bahan, count, diabaikanIds = new Set()) {
  if (count.modelVersion !== 2 || !["FULL", "GROUP"].includes(count.scopeMode)) return [];
  const info = count.scopeInfo ?? {}; const scope = { mode: count.scopeMode, groups: info.groups ?? [], excludeJenis: info.excludeJenis ?? [], excludeMaterialIds: info.excludeMaterialIds ?? [] };
  const sudah = new Set(count.lines.map((l) => l.materialId));
  return bahan.filter((m) => memenuhiCakupan(m, scope) && !sudah.has(m.id) && !diabaikanIds.has(m.id));
}

/**
 * Pembanding per baris sesi model 2 (BACA-SAJA, dipakai layar Pemeriksa dan Selesaikan). Saldo sampai countedAt dihitung SQL dari ledger; pergerakan sesi + tanda dari muatPergerakanSesi.
 * Mengembalikan { perBaris: Map(lineId → hasil hitungPembanding + lineId), belumDitandai: [pergerakan jendela-ragu tanpa tanda], pergerakan }.
 */
export async function muatPembandingSesi(db, count, { sampai = null } = {}) {
  const baris = count.lines.filter((l) => !l.excludedAt && l.countedAt && l.countedQty != null);
  const perBaris = new Map();
  if (!baris.length) return { perBaris, belumDitandai: [], pergerakan: [] };
  const saldoRows = await db.$queryRaw`
    SELECT l.id AS "lineId", COALESCE(SUM(m.qty), 0)::float AS saldo
    FROM stock_count_lines l
    LEFT JOIN stock_movements m ON m.material_id = l.material_id AND m.created_at <= l.counted_at AND (m.stock_count_id IS NULL OR m.stock_count_id <> l.stock_count_id)
    WHERE l.stock_count_id = ${count.id}::uuid AND l.counted_at IS NOT NULL AND l.excluded_at IS NULL
    GROUP BY l.id`;
  const saldo = new Map(saldoRows.map((r) => [r.lineId, Number(r.saldo)]));
  const { pergerakan } = await muatPergerakanSesi(db, count, { sampai });
  const perBahan = new Map(); for (const p of pergerakan) { if (!perBahan.has(p.materialId)) perBahan.set(p.materialId, []); perBahan.get(p.materialId).push(p); }
  const belumDitandai = [];
  for (const l of baris) {
    const h = hitungPembanding({ saldoSampaiHitung: saldo.get(l.id) ?? 0, countedAt: l.countedAt, countedQty: l.countedQty, pergerakanBahan: perBahan.get(l.materialId) ?? [] });
    perBaris.set(l.id, { lineId: l.id, ...h });
    for (const p of h.belumDitandai) belumDitandai.push(p);
  }
  return { perBaris, belumDitandai, pergerakan };
}
