// STOCK OPNAME SESI MODEL 2 (Okt 2026) — cakupan yang disimpan, TIGA WAKTU terpisah per bahan, pembanding saldo, progres. Murni di mana mungkin (tanpa DB) supaya aturan waktu mudah diuji.
//
// TIGA WAKTU (tidak pernah saling mengisi):
//   • observedAt  — waktu PENGAMATAN fisik: kapan barang itu benar-benar dihitung. Dicatat petugas ("Mulai hitung" dicap server di bawah kunci bahan, atau dinyatakan/dikoreksi dengan alasan dan jejak).
//                   NULL = tidak diketahui. TIDAK PERNAH diturunkan dari savedAt.
//   • savedAt     — waktu ANGKA DISIMPAN ke sistem (server). Hanya batas atas "jendela hitung"; bukan acuan saldo.
//   • posting     — waktu transaksi ledger DIPOSTING = stock_movements.created_at (INSERT di bawah kunci bahan, jadi urut per bahan; tidak ada jendela tetap).
//
// ATURAN PEMBANDING (satu-satunya definisi; dipakai Pemeriksa, Selesaikan, dan layar):
//   • Pergerakan yang DIPOSTING SEBELUM observedAt (created_at < observedAt) sudah ada saat barang dihitung → otomatis masuk pembanding.
//   • SELURUH pergerakan bahan itu yang diposting pada/sesudah observedAt sampai penyelesaian (created_at ≥ observedAt) DITANDAI — tanpa jendela tetap. Tiap tanda berkelas:
//       SERENTAK           diposting tepat di milidetik pengamatan (urutan tidak bisa dipastikan)
//       SAAT_HITUNG        diposting antara pengamatan dan angka disimpan (barang sedang dihitung — sangat mungkin ikut/tidak ikut terhitung)
//       BERTANGGAL_MUNDUR  diposting belakangan tetapi tanggal kejadian dokumennya (mis. tanggal terima) pada/sebelum hari pengamatan → fisiknya mungkin sudah ada saat dihitung
//       SESUDAH_DISIMPAN   diposting sesudah angka disimpan dan tidak bertanggal mundur
//     Pemeriksa memutuskan tiap tanda: SUDAH tercermin di hitungan fisik (masuk pembanding) atau BELUM (tidak masuk, tetap utuh di ledger). Sistem tidak menebak; Selesaikan ditolak selama ada yang belum diputuskan.
//   • Penyesuaian = fisik − pembanding, ditulis SEKALI saat Selesaikan di bawah kunci semua bahan; saldo akhir = fisik + Σ pergerakan yang diputuskan BELUM tercermin.
//   • observedAt tidak diketahui → tidak ada pembanding; hitungan tidak bisa diserahkan/diselesaikan sampai waktunya dinyatakan/dikoreksi.
import { kelompokDariItemGroup, URUTAN_KELOMPOK, KELOMPOK, KELOMPOK_BELUM, LABEL_BELUM } from "../constants/kelompokBahan.js";
import { LABEL_JENIS } from "../constants/kelompokBahan.js";
import { bacaTandaSesi } from "./pergerakanSesiHitung.js";
import { muatJejakStok, ALASAN_TIDAK_DILACAK } from "./stokFisik.js";
import { WIB_OFFSET_MS } from "../utils/wib.js";

export const MAKS_BAHAN_CYCLE_COUNT = 50;
export const MODE = Object.freeze({ FULL: "FULL", GROUP: "GROUP", ITEMS: "ITEMS" });
export const SUMBER_WAKTU = Object.freeze({ MULAI: "MULAI", DINYATAKAN: "DINYATAKAN", DIKOREKSI: "DIKOREKSI" });
export const KELAS = Object.freeze({ SEBELUM: "SEBELUM_PENGAMATAN", SERENTAK: "SERENTAK", SAAT_HITUNG: "SAAT_HITUNG", MUNDUR: "BERTANGGAL_MUNDUR", SESUDAH: "SESUDAH_DISIMPAN" });
/** Hanya kelas ini yang boleh diputuskan massal ("belum tercermin"); kelas berisiko diputuskan satu per satu. */
export const KELAS_BOLEH_MASSAL = Object.freeze([KELAS.SESUDAH]);
export const AKSI_CAKUPAN_DIABAIKAN = "CAKUPAN_DIABAIKAN";
export const AKSI_BAHAN_DIKELUARKAN = "BAHAN_DIKELUARKAN";
export const AKSI_BAHAN_DIKEMBALIKAN = "BAHAN_DIKEMBALIKAN";
export const AKSI_BAHAN_DITAMBAHKAN = "BAHAN_DITAMBAHKAN";
export const AKSI_WAKTU_HITUNG = "WAKTU_HITUNG_DICATAT";

const EPS = 1e-6;
const r4 = (x) => Math.round(Number(x) * 10000) / 10000;
const JENIS_VALID = new Set([...Object.keys(LABEL_JENIS), "NONE"]);
const ms = (d) => new Date(d).getTime();

export class GalatSesi extends Error {
  constructor(pesan, status = 400, code = null) { super(pesan); this.statusCode = status; if (code) this.code = code; }
}

/** Murni. Tanggal kalender WIB ("YYYY-MM-DD") dari sebuah instant. */
export const tanggalWib = (d) => new Date(ms(d) + WIB_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Murni. Kelas satu pergerakan terhadap pengamatan satu bahan.
 * tanggalKejadian: "YYYY-MM-DD" tanggal kejadian dokumen sumber bila ada (mis. tanggal terima), selain itu null.
 */
export function klasifikasiPergerakan({ createdAt, observedAt, savedAt = null, tanggalKejadian = null }) {
  const t = ms(createdAt); const o = ms(observedAt);
  if (t < o) return KELAS.SEBELUM;
  if (t === o) return KELAS.SERENTAK;
  if (tanggalKejadian && String(tanggalKejadian) <= tanggalWib(o)) return KELAS.MUNDUR;
  if (savedAt && t <= ms(savedAt)) return KELAS.SAAT_HITUNG;
  return KELAS.SESUDAH;
}

/**
 * Murni. Pembanding sebuah bahan.
 *   saldoSebelum : Σ qty pergerakan yang diposting SEBELUM observedAt (selain penyesuaian sesi ini)
 *   pergerakan   : SEMUA pergerakan bahan itu yang diposting pada/sesudah observedAt s.d. penyelesaian: [{id, qty, kelas, tanda: null|"SUDAH_TERHITUNG"|"BELUM_TERHITUNG"}]
 * pembanding = saldoSebelum + Σ qty yang diputuskan SUDAH tercermin. Yang belum diputuskan (tanda null) menghalangi Selesaikan.
 */
export function hitungPembanding({ saldoSebelum, countedQty, pergerakan = [] }) {
  const belumDiputuskan = pergerakan.filter((p) => p.tanda === null || p.tanda === undefined);
  const sudah = r4(pergerakan.filter((p) => p.tanda === "SUDAH_TERHITUNG").reduce((s, p) => s + Number(p.qty), 0));
  const belum = r4(pergerakan.filter((p) => p.tanda === "BELUM_TERHITUNG").reduce((s, p) => s + Number(p.qty), 0));
  const pembanding = r4(Number(saldoSebelum) + sudah);
  const selisih = countedQty == null ? null : r4(Number(countedQty) - pembanding);
  return { pembanding, selisih, berselisih: selisih !== null && Math.abs(selisih) > EPS, sudahTercermin: sudah, belumTercermin: belum, belumDiputuskan };
}

/** Murni. Progres total + per kelompok dari baris kompak { kelompokKode, counted, perluPeriksa, excluded, tanpaWaktu }. */
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
    tanpaWaktu: dihitung.filter((b) => b.tanpaWaktu).length,
    persen: aktif.length ? Math.round((dihitung.length / aktif.length) * 1000) / 10 : 0,
    perKelompok: URUTAN_KELOMPOK.map((kode) => ({ kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode], ...mk.get(kode) })).filter((k) => k.total > 0),
  };
}

/**
 * Murni. Satu bahan memenuhi kriteria cakupan sesi? Bahan harus aktif. Opname Penuh / Per kelompok mengikutkan bahan yang SALDONYA DILACAK FISIK (m.dilacak, lihat services/stokFisik.js),
 * ditambah bahan tak dilacak yang diikutkan secara eksplisit (scope.ikutkanTakDilacak). Nama kategori TIDAK menentukan.
 */
export function memenuhiCakupan(m, scope) {
  if (!m.active) return false;
  const jenis = m.category ?? "NONE";
  if ((scope.excludeJenis ?? []).includes(jenis)) return false;
  if ((scope.excludeMaterialIds ?? []).includes(m.id)) return false;
  if (scope.mode === MODE.ITEMS) return false; // ITEMS: hanya yang dipilih eksplisit
  if (m.dilacak === false && !(scope.ikutkanTakDilacak ?? []).includes(m.id)) return false;
  if (scope.mode === MODE.FULL) return true;
  if (scope.mode === MODE.GROUP) return (scope.groups ?? []).includes(kelompokDariItemGroup(m.itemGroup).kode);
  return false;
}

/** Semua bahan + penanda `dilacak`/`sinyal` (bukti) untuk bahan aktif. */
export async function muatBahan(db) {
  const [bahan, jejak] = await Promise.all([
    db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true, category: true, itemGroup: true }, orderBy: { code: "asc" } }),
    muatJejakStok(db),
  ]);
  return bahan.map((m) => { const j = jejak.get(m.id); return { ...m, dilacak: m.active ? !!j?.dilacak : false, sinyal: j?.sinyal ?? [] }; });
}

function normalkanScope(body) {
  const mode = body?.mode;
  if (!Object.values(MODE).includes(mode)) throw new GalatSesi("Pilih cakupan: Opname penuh, Per kelompok, atau Cycle Count.", 400, "MODE_TIDAK_VALID");
  const groups = [...new Set(Array.isArray(body.groups) ? body.groups : [])];
  for (const g of groups) if (!URUTAN_KELOMPOK.includes(g)) throw new GalatSesi(`Kelompok tidak dikenal: ${g}`, 400, "KELOMPOK_TIDAK_VALID");
  const excludeJenis = [...new Set(Array.isArray(body.excludeJenis) ? body.excludeJenis : [])];
  for (const j of excludeJenis) if (!JENIS_VALID.has(j)) throw new GalatSesi(`Jenis bahan tidak dikenal: ${j}`, 400, "JENIS_TIDAK_VALID");
  const excludeMaterialIds = [...new Set(Array.isArray(body.excludeMaterialIds) ? body.excludeMaterialIds : [])];
  const ikutkanTakDilacak = [...new Set(Array.isArray(body.ikutkanTakDilacak) ? body.ikutkanTakDilacak : [])];
  const materialIds = [...new Set(Array.isArray(body.materialIds) ? body.materialIds : [])];
  const excludeReason = typeof body.excludeReason === "string" ? body.excludeReason.trim() : "";
  const ikutkanAlasan = typeof body.ikutkanAlasan === "string" ? body.ikutkanAlasan.trim() : "";
  if (mode === MODE.GROUP && groups.length === 0) throw new GalatSesi("Pilih minimal satu kelompok bahan.", 400, "KELOMPOK_KOSONG");
  if (mode === MODE.ITEMS && materialIds.length === 0) throw new GalatSesi("Pilih minimal satu bahan.", 400, "BAHAN_KOSONG");
  if (mode === MODE.ITEMS && materialIds.length > MAKS_BAHAN_CYCLE_COUNT) throw new GalatSesi(`Cycle Count dibatasi ${MAKS_BAHAN_CYCLE_COUNT} bahan. Untuk cakupan lebih besar pakai Per kelompok atau Opname penuh.`, 400, "TERLALU_BANYAK_BAHAN");
  if (mode !== MODE.ITEMS && excludeMaterialIds.length && excludeReason.length < 3) throw new GalatSesi("Alasan pengecualian bahan wajib diisi (min. 3 karakter).", 400, "ALASAN_PENGECUALIAN_WAJIB");
  if (mode !== MODE.ITEMS && ikutkanTakDilacak.length && ikutkanAlasan.length < 3) throw new GalatSesi("Alasan mengikutkan bahan yang tidak dilacak wajib diisi (min. 3 karakter), mis. \"ada barangnya di rak\".", 400, "ALASAN_IKUTKAN_WAJIB");
  const non = mode === MODE.ITEMS;
  return { mode, groups: mode === MODE.GROUP ? groups : [], excludeJenis: non ? [] : excludeJenis, excludeMaterialIds: non ? [] : excludeMaterialIds, ikutkanTakDilacak: non ? [] : ikutkanTakDilacak, materialIds: non ? materialIds : [], excludeReason: non ? "" : excludeReason, ikutkanAlasan: non ? "" : ikutkanAlasan };
}

/**
 * Pratinjau cakupan (BACA-SAJA) sekaligus daftar Material ID yang akan disimpan di sesi. `keadaan` (opsional) = Map(materialId → {saldo, keadaan}) dari stokLokasi untuk menandai bahan tanpa catatan/minus.
 * `bahan` = hasil muatBahan (dengan `dilacak`/`sinyal`).
 */
export function bangunCakupan(bahan, body, keadaan = new Map()) {
  const scope = normalkanScope(body);
  const aktif = bahan.filter((m) => m.active); const nonaktif = bahan.filter((m) => !m.active);
  const dalamKelompok = (m) => scope.mode === MODE.FULL || (scope.mode === MODE.GROUP && scope.groups.includes(kelompokDariItemGroup(m.itemGroup).kode));
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
    for (const id of scope.ikutkanTakDilacak) { const m = bahan.find((x) => x.id === id); if (!m || !m.active) throw new GalatSesi("Ada bahan yang diikutkan tetapi tidak ditemukan atau nonaktif.", 400, "BAHAN_IKUTKAN_TIDAK_VALID"); }
    masuk = aktif.filter((m) => memenuhiCakupan(m, scope));
  }
  const idsMasuk = new Set(masuk.map((m) => m.id));
  const pengecualianJenis = scope.excludeJenis.map((j) => ({ kode: j, label: j === "NONE" ? "Tanpa kategori" : LABEL_JENIS[j], jumlah: aktif.filter((m) => (m.category ?? "NONE") === j && dalamKelompok(m)).length }));
  const pengecualianBahan = scope.excludeMaterialIds.map((id) => { const m = bahan.find((x) => x.id === id); return m ? { materialId: m.id, kode: m.code, nama: m.name, alasan: scope.excludeReason } : { materialId: id, kode: "?", nama: "tidak ditemukan", alasan: scope.excludeReason }; });
  const perKelompok = URUTAN_KELOMPOK.map((kode) => ({
    kode, label: kode === KELOMPOK_BELUM ? LABEL_BELUM : KELOMPOK[kode],
    masuk: masuk.filter((m) => kelompokDariItemGroup(m.itemGroup).kode === kode).length,
    aktif: aktif.filter((m) => kelompokDariItemGroup(m.itemGroup).kode === kode).length,
  }));
  const perSatuan = {}; for (const m of masuk) perSatuan[m.unit] = (perSatuan[m.unit] ?? 0) + 1;
  const perJenis = {}; for (const m of masuk) { const j = m.category ?? "NONE"; perJenis[j] = (perJenis[j] ?? 0) + 1; }
  const ket = (m) => keadaan.get(m.id)?.keadaan;
  // Bahan aktif di cakupan kelompok ini yang saldonya TIDAK dilacak (tidak ada jejak stok): ditampilkan beserta alasannya, bukan dibuang diam-diam.
  const takDilacak = scope.mode === MODE.ITEMS ? [] : aktif.filter((m) => !m.dilacak && dalamKelompok(m) && !scope.excludeMaterialIds.includes(m.id) && !scope.excludeJenis.includes(m.category ?? "NONE"))
    .map((m) => ({ materialId: m.id, kode: m.code, nama: m.name, satuan: m.unit, jenis: m.category ?? "NONE", kelompok: kelompokDariItemGroup(m.itemGroup).kode, alasan: ALASAN_TIDAK_DILACAK, diikutkan: scope.ikutkanTakDilacak.includes(m.id) }));
  const peringatanItems = scope.mode === MODE.ITEMS ? masuk.filter((m) => !m.dilacak).map((m) => ({ materialId: m.id, kode: m.code, alasan: ALASAN_TIDAK_DILACAK })) : [];
  const ringkasan = {
    mode: scope.mode, bahanAktif: aktif.length, masuk: masuk.length, perKelompok,
    dasarCakupan: scope.mode === MODE.ITEMS ? "Bahan yang dipilih satu per satu." : "Semua bahan aktif yang saldonya dilacak secara fisik (ada jejak stok), termasuk Habis Pakai bila memang dikelola sebagai stok. Nama kategori tidak menentukan.",
    dilacak: aktif.filter((m) => m.dilacak && dalamKelompok(m)).length,
    tidakDilacak: { jumlah: takDilacak.length, diikutkan: takDilacak.filter((x) => x.diikutkan).length, daftar: takDilacak, alasanUmum: ALASAN_TIDAK_DILACAK },
    peringatanItems,
    belumDikelompokkan: { masuk: perKelompok.find((k) => k.kode === KELOMPOK_BELUM)?.masuk ?? 0, catatan: "Bahan aktif yang belum dikelompokkan dan saldonya dilacak tetap ikut Opname penuh." },
    nonaktif: { jumlah: nonaktif.length, catatan: "Bahan nonaktif tidak ikut dihitung." },
    pengecualian: { jenis: pengecualianJenis, bahan: pengecualianBahan, totalBahanDikecualikan: aktif.filter((m) => scope.mode !== MODE.ITEMS && !idsMasuk.has(m.id) && m.dilacak && (scope.excludeJenis.includes(m.category ?? "NONE") || scope.excludeMaterialIds.includes(m.id)) && dalamKelompok(m)).length },
    tanpaCatatanStok: masuk.filter((m) => ket(m) === "BELUM_ADA_CATATAN").length, saldoMinus: masuk.filter((m) => ket(m) === "MINUS").length, perSatuan, perJenis,
  };
  return { scope, materialIds: masuk.map((m) => m.id), ringkasan };
}

/** Bahan aktif yang memenuhi kriteria sesi (termasuk "dilacak" saat ini) tetapi BELUM ada di sesi dan belum diputuskan diabaikan → "di luar cakupan sesi". */
export function bahanDiLuarCakupan(bahan, count, diabaikanIds = new Set()) {
  if (count.modelVersion !== 2 || !["FULL", "GROUP"].includes(count.scopeMode)) return [];
  const info = count.scopeInfo ?? {}; const scope = { mode: count.scopeMode, groups: info.groups ?? [], excludeJenis: info.excludeJenis ?? [], excludeMaterialIds: info.excludeMaterialIds ?? [], ikutkanTakDilacak: info.ikutkanTakDilacak ?? [] };
  const sudah = new Set(count.lines.map((l) => l.materialId));
  return bahan.filter((m) => memenuhiCakupan(m, scope) && !sudah.has(m.id) && !diabaikanIds.has(m.id));
}

const tanggalIso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
/** Tanggal kejadian dokumen sumber (paling awal) bila dokumen membawa tanggal kejadian sendiri — saat ini Penerimaan (tanggal tiba / tanggal terima). */
function tanggalKejadianDokumen(m) {
  const g = m.goodsReceipt; if (!g) return null;
  const ds = [tanggalIso(g.arrivedDate), tanggalIso(g.receivedDate)].filter(Boolean).sort();
  return ds[0] ?? null;
}

/**
 * Pembanding per baris sesi model 2 (BACA-SAJA, dipakai layar Pemeriksa dan Selesaikan). Tanpa jendela tetap:
 *   saldoSebelum = Σ ledger yang diposting SEBELUM observedAt (SQL); pergerakan = SEMUA pergerakan bahan yang diposting pada/sesudah observedAt s.d. `sampai` (diklasifikasi, bertanda dari activity_events).
 * Mengembalikan { perBaris: Map(lineId → hasil), belumDitandai: [...], tanpaWaktu: [lineId...], pergerakan: [...] }.
 */
export async function muatPembandingSesi(db, count, { sampai = null } = {}) {
  const batas = sampai || count.completedAt || new Date();
  const dihitung = count.lines.filter((l) => !l.excludedAt && l.countedQty != null);
  const perBaris = new Map(); const tanpaWaktu = [];
  const berwaktu = dihitung.filter((l) => l.observedAt);
  for (const l of dihitung) if (!l.observedAt) { tanpaWaktu.push(l.id); perBaris.set(l.id, { lineId: l.id, waktuTidakDiketahui: true, pembanding: null, selisih: null, berselisih: false, saldoSebelum: null, pergerakan: [], belumDiputuskan: [] }); }
  if (!berwaktu.length) return { perBaris, belumDitandai: [], tanpaWaktu, pergerakan: [] };
  const saldoRows = await db.$queryRaw`
    SELECT l.id AS "lineId", COALESCE(SUM(m.qty), 0)::float AS saldo
    FROM stock_count_lines l
    LEFT JOIN stock_movements m ON m.material_id = l.material_id AND m.created_at < l.observed_at AND (m.stock_count_id IS NULL OR m.stock_count_id <> l.stock_count_id)
    WHERE l.stock_count_id = ${count.id}::uuid AND l.observed_at IS NOT NULL AND l.excluded_at IS NULL AND l.counted_qty IS NOT NULL
    GROUP BY l.id`;
  const saldo = new Map(saldoRows.map((r) => [r.lineId, Number(r.saldo)]));
  const awal = new Date(Math.min(...berwaktu.map((l) => ms(l.observedAt))));
  const rows = await db.stockMovement.findMany({
    where: { materialId: { in: [...new Set(berwaktu.map((l) => l.materialId))] }, createdAt: { gte: awal, lte: batas }, OR: [{ stockCountId: null }, { stockCountId: { not: count.id } }] },
    select: {
      id: true, materialId: true, type: true, qty: true, createdAt: true, note: true, reason: true, createdById: true,
      goodsReceipt: { select: { receiptNumber: true, arrivedDate: true, receivedDate: true } }, materialIssue: { select: { issueNumber: true } }, stockTransfer: { select: { transferNumber: true } },
      damagedStockRecord: { select: { recordNumber: true } }, returnRecord: { select: { returnNumber: true } }, stockAdjustmentRequest: { select: { adjustmentNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const tandaPerId = await bacaTandaSesi(db, count.id, new Map(rows.map((m) => [m.id, m.materialId])));
  const perBahan = new Map(); for (const m of rows) { if (!perBahan.has(m.materialId)) perBahan.set(m.materialId, []); perBahan.get(m.materialId).push(m); }
  const belumDitandai = []; const semua = [];
  for (const l of berwaktu) {
    const pergerakan = [];
    for (const m of perBahan.get(l.materialId) ?? []) {
      if (m.createdAt < l.observedAt) continue; // sebelum pengamatan: sudah ada saat dihitung — sudah ikut saldoSebelum
      const tanggalKejadian = tanggalKejadianDokumen(m);
      pergerakan.push({
        id: m.id, materialId: m.materialId, lineId: l.id, type: m.type, qty: Number(m.qty), at: m.createdAt, note: m.note, reason: m.reason, createdById: m.createdById, tanggalKejadian,
        dokumen: m.goodsReceipt?.receiptNumber || m.materialIssue?.issueNumber || m.stockTransfer?.transferNumber || m.damagedStockRecord?.recordNumber || m.returnRecord?.returnNumber || m.stockAdjustmentRequest?.adjustmentNumber || null,
        kelas: klasifikasiPergerakan({ createdAt: m.createdAt, observedAt: l.observedAt, savedAt: l.savedAt, tanggalKejadian }),
        tanda: tandaPerId.has(m.id) ? (tandaPerId.get(m.id).tercermin ? "SUDAH_TERHITUNG" : "BELUM_TERHITUNG") : null,
      });
    }
    const h = hitungPembanding({ saldoSebelum: saldo.get(l.id) ?? 0, countedQty: l.countedQty, pergerakan });
    perBaris.set(l.id, { lineId: l.id, waktuTidakDiketahui: false, saldoSebelum: r4(saldo.get(l.id) ?? 0), pergerakan, ...h });
    for (const p of h.belumDiputuskan) belumDitandai.push(p);
    semua.push(...pergerakan);
  }
  return { perBaris, belumDitandai, tanpaWaktu, pergerakan: semua };
}
