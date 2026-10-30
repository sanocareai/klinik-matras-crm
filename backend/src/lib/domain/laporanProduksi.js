// LAPORAN PRODUKSI TERPADU (4 tab: Ringkasan · Biaya per Order · Kinerja Produksi · Bahan & Gudang) — aturan MURNI (tanpa DB; diuji node --test).
//
// Prinsip yang dijaga di sini (jangan dilonggarkan tanpa keputusan Owner):
//   • HPP Bahan = HPP OPERASIONAL (harga berlaku yang DIBEKUKAN saat pemakaian diposting). Bukan nilai persediaan/jurnal Finance, bukan delivery, bukan biaya lain.
//     Pemakaian lama TIDAK dihitung ulang dengan harga master terbaru: yang belum dibekukan / tanpa harga / gagal dibekukan = MASALAH (gap), bukan Rp0.
//   • "Lengkap" tidak pernah disimpulkan dari "semua catatan yang kebetulan sudah diinput berharga": status juga bergantung pada kelengkapan catatan (catatan historis tertahan,
//     unit selesai tanpa pemakaian, pemakaian sementara, SANO GUARD) — sumber yang sama dengan filter Kelengkapan Order Produksi.
//   • SANO GUARD = bahan produksi internal. Harga Berlaku yang dikonfirmasi Owner adalah harga operasional yang SAH: bila ada ISSUE dan snapshot operasional resmi, nilainya DIHITUNG (tidak dikecualikan hanya karena bahan dibuat internal).
//     Yang belum tersedia = biaya PERAKITAN (hubungan ke bahan penyusun) → ditandai gap + potensi hitung ganda bila komponen penyusunnya juga tercatat; nilai tampil terpisah (nilaiGuard) supaya tidak hilang diam-diam.
//   • Tanggal = hari kalender WIB. Tanggal PEMAKAIAN (dasar metrik biaya) dibedakan dari waktu PENCATATAN.
import { TIPE_OP, tanggalDasarHarga } from "../../services/finance/hargaBerlaku.js";

export const WIB_OFFSET_MS = 7 * 3600_000;
export const wibKeyDari = (instant) => new Date(new Date(instant).getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);

/** Kode bahan SANO GUARD (bahan produksi internal; perakitan ke bahan penyusun belum dimodelkan). */
export const GUARD_PREFIX = "SANO-GUARD";
export const isGuard = (kode) => String(kode ?? "").toUpperCase().startsWith(GUARD_PREFIX);

export const JENIS_PERGERAKAN = Object.freeze({ ISSUE: "PEMAKAIAN", RETURN: "PENGEMBALIAN", WASTE: "SUSUT", ADJUSTMENT: "KOREKSI" });
export const STATUS_NILAI = Object.freeze({
  DIBEKUKAN: "Dibekukan (harga resmi saat pemakaian)",
  BELUM_DIBEKUKAN: "Belum dibekukan",
  TANPA_HARGA: "Tanpa harga berlaku saat pemakaian",
  GAGAL: "Pembekuan gagal",
});
export const STATUS_BIAYA = Object.freeze({
  LENGKAP: { key: "LENGKAP", label: "Lengkap", tone: "green" },
  PARSIAL: { key: "PARSIAL", label: "Parsial", tone: "orange" },
  BELUM_DIKETAHUI: { key: "BELUM_DIKETAHUI", label: "Belum diketahui", tone: "red" },
});
export const STATUS_BIAYA_KEYS = Object.freeze(Object.keys(STATUS_BIAYA));

/** Jenis masalah (gap) yang bisa ditindaklanjuti — satu definisi untuk layar, rincian, dan Excel. */
export const MASALAH = Object.freeze({
  BELUM_DIBEKUKAN: { label: "Pemakaian belum dibekukan harganya", aksi: "Stok → Harga Berlaku → Penerapan harga (Finance/Owner)" },
  TANPA_HARGA: { label: "Pemakaian tanpa harga berlaku pada waktu pemakaian", aksi: "Isi Harga Berlaku bahan (Stok), lalu ajukan penerapan" },
  GAGAL: { label: "Pembekuan harga gagal saat diposting", aksi: "Perbaiki lewat penerapan khusus (Stok → Harga Berlaku)" },
  CATATAN_TERTAHAN: { label: "Catatan pemakaian historis belum jadi pengeluaran stok", aksi: "Order Produksi → Lengkapi → Pemakaian aktual" },
  BAHAN_BELUM_DICATAT: { label: "Unit dinilai tetapi pemakaian bahan belum dicatat", aksi: "Order Produksi → Lengkapi (catat bahan atau nyatakan tanpa bahan baru)" },
  SEMENTARA: { label: "Pemakaian sementara belum direkonsiliasi", aksi: "Order Produksi → Lengkapi → rekonsiliasi pemakaian sementara" },
  GUARD: { label: "SANO GUARD: biaya perakitan belum tersedia; potensi hitung ganda bila komponen penyusun juga tercatat", aksi: "Nilai Harga Berlaku tercatat dan ikut dihitung; verifikasi dengan komponen penyusun sampai biaya perakitan dimodelkan" },
});

/** Tanggal PEMAKAIAN (YYYY-MM-DD WIB) sebuah pergerakan: tanggal yang dilaporkan (pembetulan) > tanggal pemakaian catatan historis tertaut > waktu pencatatan. */
export function tanggalPemakaian(mov, usedAtCatatan = null) {
  const dilaporkan = tanggalDasarHarga(mov);
  if (dilaporkan) return { tanggal: dilaporkan, dasar: "DILAPORKAN" };
  if (usedAtCatatan) return { tanggal: wibKeyDari(usedAtCatatan), dasar: "CATATAN_HISTORIS" };
  return { tanggal: wibKeyDari(mov.createdAt), dasar: "PENCATATAN" };
}
export const DASAR_TANGGAL_TEKS = Object.freeze({
  DILAPORKAN: "Tanggal pemakaian yang dilaporkan (pembetulan)", CATATAN_HISTORIS: "Tanggal pemakaian pada catatan historis", PENCATATAN: "Hari pencatatan di sistem",
});

/** Status nilai satu pergerakan dari baris biaya operasional TERAKHIR (snapshot). */
export function statusNilai(mov, snapshot) {
  if (!snapshot) return "BELUM_DIBEKUKAN";
  if (snapshot.status === "DINILAI") return "DIBEKUKAN";
  if (snapshot.status === "GAGAL_PEMBEKUAN") return "GAGAL";
  return "TANPA_HARGA";
}

const num = (v) => (v == null ? 0 : Number(v));
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Rincian satu pergerakan (siap tampil). `nilai` hanya terisi bila DIBEKUKAN; SUSUT dan GUARD tidak masuk HPP diketahui. */
export function barisPergerakan(mov, snapshot, { usedAtCatatan = null } = {}) {
  const st = statusNilai(mov, snapshot);
  const tgl = tanggalPemakaian(mov, usedAtCatatan);
  const qty = num(mov.qty);
  const jenis = JENIS_PERGERAKAN[mov.type] ?? mov.type;
  const dinilai = st === "DIBEKUKAN";
  return {
    movementId: mov.id, unitId: mov.unitId, materialId: mov.materialId, kode: mov.materialKode, bahan: mov.materialNama, satuan: mov.materialSatuan,
    jenis, tipe: mov.type, qty: r2(Math.abs(qty) * 10000) / 10000, arah: qty < 0 ? "KELUAR" : "MASUK",
    harga: dinilai ? num(snapshot.unitCost) : null,
    subtotal: dinilai ? num(snapshot.value) : null, // bertanda: pemakaian +, pengembalian −
    tanggalPemakaian: tgl.tanggal, dasarTanggal: tgl.dasar, waktuPencatatan: mov.createdAt,
    dasarHargaTanggal: dinilai && snapshot.priceEffectiveFrom ? wibKeyDari(snapshot.priceEffectiveFrom) : null, // tanggal mulai berlaku harga yang dibekukan
    basisHarga: snapshot?.basisHarga ?? null, sumberHarga: snapshot?.sumber ?? null, labelBukti: snapshot?.evidenceLabel ?? null,
    status: st, termasukHpp: dinilai && mov.type !== "WASTE", guard: isGuard(mov.materialKode),
    koreksiDari: mov.correctsMovementId ?? null, catatan: mov.note ?? null,
  };
}

/** Jumlah pergerakan bermasalah menurut jenis (untuk badge + daftar tindakan). */
export function hitungMasalahPergerakan(baris) {
  const m = { BELUM_DIBEKUKAN: 0, TANPA_HARGA: 0, GAGAL: 0, GUARD: 0 };
  for (const b of baris) { if (b.status === "BELUM_DIBEKUKAN") m.BELUM_DIBEKUKAN += 1; else if (b.status === "TANPA_HARGA") m.TANPA_HARGA += 1; else if (b.status === "GAGAL") m.GAGAL += 1; if (b.guard && b.tipe !== "WASTE") m.GUARD += 1; }
  return m;
}

/**
 * Agregasi satu kelompok (unit atau order) dari baris pergerakan + masalah tingkat unit.
 *   nilaiDiketahui = Σ subtotal baris DIBEKUKAN (pemakaian +, pengembalian −, koreksi bertanda), tanpa SUSUT dan tanpa SANO GUARD.
 *   susut          = Σ nilai SUSUT dibekukan (terpisah).
 * `masalahUnit` = { catatanTertahan, bahanBelumDicatat, sementara } (jumlah, posisi saat ini, dari fakta Kelengkapan yang sama).
 */
export function agregasi(baris, masalahUnit = {}) {
  let nilai = 0; let susut = 0; let nDinilai = 0; let nilaiGuard = 0;
  for (const b of baris) {
    if (b.status !== "DIBEKUKAN") continue;
    if (b.tipe === "WASTE") susut += b.subtotal; else { nilai += b.subtotal; nDinilai += 1; if (b.guard) nilaiGuard += b.subtotal; }
  }
  const mp = hitungMasalahPergerakan(baris);
  const masalah = { ...mp, CATATAN_TERTAHAN: masalahUnit.catatanTertahan ?? 0, BAHAN_BELUM_DICATAT: masalahUnit.bahanBelumDicatat ?? 0, SEMENTARA: masalahUnit.sementara ?? 0 };
  const jumlahMasalah = Object.values(masalah).reduce((a, v) => a + v, 0);
  const adaPemakaian = baris.some((b) => b.tipe === "ISSUE");
  return { baris: baris.length, dinilai: nDinilai, nilaiDiketahui: r2(nilai), nilaiGuard: r2(nilaiGuard), susut: r2(susut), masalah, jumlahMasalah, adaPemakaian, adaNilai: nDinilai > 0 };
}

/** Status biaya: LENGKAP hanya bila tidak ada masalah apa pun DAN ada dasar (nilai dibekukan, atau semua unit dinyatakan tanpa bahan). */
export function statusBiaya(agg, { semuaTanpaBahan = false } = {}) {
  if (agg.jumlahMasalah === 0 && (agg.adaNilai || semuaTanpaBahan)) return STATUS_BIAYA.LENGKAP;
  if (!agg.adaNilai) return STATUS_BIAYA.BELUM_DIKETAHUI;
  return STATUS_BIAYA.PARSIAL;
}

/** Jumlahkan agregasi unit menjadi agregasi order — SATU fungsi, supaya total order = Σ rincian unit (diuji). */
export function gabungAgregasi(daftar) {
  const out = { baris: 0, dinilai: 0, nilaiDiketahui: 0, nilaiGuard: 0, susut: 0, masalah: { BELUM_DIBEKUKAN: 0, TANPA_HARGA: 0, GAGAL: 0, GUARD: 0, CATATAN_TERTAHAN: 0, BAHAN_BELUM_DICATAT: 0, SEMENTARA: 0 }, jumlahMasalah: 0, adaPemakaian: false, adaNilai: false };
  for (const a of daftar) {
    out.baris += a.baris; out.dinilai += a.dinilai; out.nilaiDiketahui += a.nilaiDiketahui; out.nilaiGuard += a.nilaiGuard ?? 0; out.susut += a.susut; out.jumlahMasalah += a.jumlahMasalah;
    for (const k of Object.keys(out.masalah)) out.masalah[k] += a.masalah[k] ?? 0;
    out.adaPemakaian ||= a.adaPemakaian; out.adaNilai ||= a.adaNilai;
  }
  out.nilaiDiketahui = r2(out.nilaiDiketahui); out.nilaiGuard = r2(out.nilaiGuard); out.susut = r2(out.susut);
  return out;
}

// ───────────────────────────────────────────── bucket harian ─────────────────────────────────────────────
export function hariDalamPeriode(from, to) {
  const out = []; let t = new Date(`${from}T00:00:00.000Z`).getTime(); const akhir = new Date(`${to}T00:00:00.000Z`).getTime();
  while (t <= akhir) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86_400_000; }
  return out;
}
export function seriHarian(hari, nilaiPerTanggal) { return hari.map((d) => ({ tanggal: d, nilai: r2(nilaiPerTanggal.get(d) ?? 0) })); }

// ───────────────────────────────────────────── kinerja ─────────────────────────────────────────────
/** Unit yang SUDAH selesai produksi menurut posisi SAAT INI (status order Siap Kirim/Siap Kirim-Ditahan/Dalam Pengiriman/Terkirim). */
export const STATUS_SELESAI_POSISI = Object.freeze(["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"]);
export const SUMBER_SELESAI = Object.freeze({
  SERAH_BARANG_JADI: "Serah barang jadi ke Gudang", FASE_HANDOFF: "Fase serah terima produksi selesai", PELEPASAN_PENGIRIMAN: "Dilepas Siap Kirim oleh Admin/Owner", STATUS_KERJA_SELESAI: "Status kerja Selesai dicatat (waktu pencatatan)",
});
/**
 * Pisahkan POSISI SAAT INI dari KEJADIAN selesai bertanggal. Satu unit dihitung SEKALI.
 *   posisi      = unit berstatus selesai produksi sekarang (TIDAK bergantung periode).
 *   bertanggal  = subset posisi (atau unit lain yang punya bukti kejadian) dengan tanggal selesai TERBUKTI dari sumber resmi; tanggal = yang paling awal. Tanpa bukti → tidak ditebak.
 *   tanpaTanggal = posisi − bertanggal: selesai tetapi tanggalnya tidak dapat dibuktikan → TIDAK masuk tren tanggal mana pun, dan tidak boleh tampil sebagai 0.
 * @param units [{ id, status }] · @param buktiPerUnit Map unitId → [{ sumber, at }] · @returns {{ posisi, bertanggal: Map, tanpaTanggal: string[], perSumber }}
 */
export function klasifikasiSelesai(units, buktiPerUnit = new Map()) {
  const posisi = units.filter((u) => STATUS_SELESAI_POSISI.includes(u.status)).map((u) => u.id);
  const bertanggal = new Map(); const perSumber = {};
  for (const u of units) {
    const b = (buktiPerUnit.get(u.id) ?? []).filter((x) => x?.at && Number.isFinite(new Date(x.at).getTime())).sort((a, c) => new Date(a.at) - new Date(c.at))[0];
    if (!b) continue;
    bertanggal.set(u.id, { at: new Date(b.at).toISOString(), key: wibKeyDari(b.at), sumber: b.sumber });
    perSumber[b.sumber] = (perSumber[b.sumber] ?? 0) + 1;
  }
  const tanpaTanggal = posisi.filter((id) => !bertanggal.has(id));
  return { posisi, bertanggal, tanpaTanggal, perSumber };
}

export const MIN_SAMPEL_DURASI = 3;
/**
 * Setiap unit selesai dihitung TEPAT SEKALI. Pemilik (meja / PIC) = penetapan TERAKHIR sebelum/saat unit diserahkan; bila tidak ada → "Tidak tercatat" (bukan ditebak).
 * Total baris per meja/PIC + "Tidak tercatat" = total unit selesai (invarian yang diuji).
 */
export function kelompokkanSelesai(units, kunci, labelKunci = (k) => k) {
  const peta = new Map();
  for (const u of units) {
    const k = kunci(u) ?? "__TIDAK_TERCATAT__";
    if (!peta.has(k)) peta.set(k, { key: k, label: k === "__TIDAK_TERCATAT__" ? "Tidak tercatat" : labelKunci(k), selesai: 0, unitIds: [] });
    const g = peta.get(k); g.selesai += 1; g.unitIds.push(u.unitId);
  }
  return [...peta.values()].sort((a, b) => (a.key === "__TIDAK_TERCATAT__") - (b.key === "__TIDAK_TERCATAT__") || String(a.label).localeCompare(String(b.label), "id"));
}
export function rataDurasi(menit) {
  const v = menit.filter((m) => Number.isFinite(m) && m >= 0);
  if (v.length === 0) return { n: 0, rataMenit: null, catatan: "Belum tersedia" };
  if (v.length < MIN_SAMPEL_DURASI) return { n: v.length, rataMenit: null, catatan: `Data belum cukup (n=${v.length}, minimal ${MIN_SAMPEL_DURASI})` };
  return { n: v.length, rataMenit: Math.round(v.reduce((a, b) => a + b, 0) / v.length), catatan: null };
}

export const TIPE_PERGERAKAN_BIAYA = TIPE_OP;
