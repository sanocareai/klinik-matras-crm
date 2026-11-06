// Logika PENYAJIAN Beranda Gudang (murni, tanpa React; diuji dengan node --test). Hanya menyusun ulang yang SUDAH dikirim GET /inventory/pusat-kerja:
// tidak ada hitungan stok, status, tanggal jatuh tempo, atau izin yang dibuat di sini. Angka ringkasan datang dari server (`jumlah` per antrean/sebab, `ringkasan`);
// satu-satunya angka turunan di klien adalah jumlah BARIS yang sedang dimuat/disaring, dan ia selalu disebut sebagai itu.

/** Kelompok jenis pekerjaan untuk tab cepat. Jenis yang tak dikenal jatuh ke "Stok & bahan". */
export const KELOMPOK = Object.freeze([
  { kode: "semua", label: "Semua" },
  { kode: "penerimaan", label: "Penerimaan" },
  { kode: "stok", label: "Stok & bahan" },
  { kode: "produksi", label: "Produksi" },
]);
const JENIS_KELOMPOK = Object.freeze({ penerimaan: "penerimaan", po: "penerimaan", bahan: "produksi" });
export const kelompokJenis = (jenis) => JENIS_KELOMPOK[jenis] ?? "stok";

/** Daftar halaman tiap jenis (sama dengan JENIS.daftar di server) — untuk menu "Buka daftar". */
export const DAFTAR_JENIS = Object.freeze({
  penerimaan: "/warehouse/goods-receipt", po: "/warehouse/barang-akan-datang", "pengeluaran-material": "/warehouse/material-issue", transfer: "/warehouse/transfers",
  opname: "/warehouse/stock-count", restok: "/warehouse/replenishment", rusak: "/warehouse/adjustments/damaged", retur: "/warehouse/adjustments/returns",
  penyesuaian: "/warehouse/adjustments/stock", koreksi: "/warehouse/adjustments/koreksi", "retur-supplier": "/warehouse/retur-supplier",
});

/** Penjelasan singkat tiap sebab tertahan untuk panel "Perlu perhatian" (teks tampilan; angkanya dari server). */
export const KET_SEBAB = Object.freeze({
  JADWAL_LEWAT: "Ada tanggal sah (jadwal, estimasi, atau tanggal dibutuhkan) yang sudah lewat.",
  STOK_TIDAK_CUKUP: "Saldo bahan kurang dari yang diminta; konfirmasi keluar akan ditolak sistem.",
  DATA_WAJIB: "Data yang diwajibkan tahap berikutnya belum lengkap.",
  MENUNGGU_WORKSPACE: "Tindakan berikutnya ada pada pihak lain, bukan Gudang.",
  PERLU_KOREKSI_RESMI: "Hanya dapat diselesaikan lewat tinjauan atau koreksi resmi.",
});
export const LABEL_SEBAB_PENDEK = Object.freeze({
  JADWAL_LEWAT: "Lewat jadwal", STOK_TIDAK_CUKUP: "Stok tidak cukup", DATA_WAJIB: "Data belum lengkap", MENUNGGU_WORKSPACE: "Menunggu pihak lain", PERLU_KOREKSI_RESMI: "Perlu keputusan resmi",
});

const NADA_OUTLINE = new Set(["JADWALKAN", "ISI_PEMERIKSAAN", "BUKA_ANTREAN", "SELESAIKAN_SELISIH", "SERAHKAN_HITUNGAN", "MULAI_HITUNG"]);
/** Tombol tindakan utama: tindakan yang memajukan dokumen = solid; tindakan melengkapi/menjadwalkan = garis. */
export const gayaAksi = (kode) => (NADA_OUTLINE.has(kode) ? "garis" : "solid");

const ISO = /(\d{4})-(\d{2})-(\d{2})/;
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-10-12" → "12 Okt 2026"; selain itu null. */
export function tanggalDariTeks(teks) {
  const m = ISO.exec(String(teks ?? "")); if (!m) return null;
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/**
 * Ringkasan SATU hambatan untuk kolom "Jadwal / masalah": judul pendek + keterangan. Teks lengkap dari server tetap dikirim apa adanya (`teks`) dan tampil di rincian baris.
 * Pola yang dikenali hanya untuk memendekkan tampilan; bila tidak cocok, teks server dipakai utuh.
 */
export function ringkasHambatan(h) {
  const teks = String(h?.teks ?? "");
  if (h?.sebab === "JADWAL_LEWAT") {
    const hari = /(\d+)\s*hari/.exec(teks)?.[1]; const tgl = tanggalDariTeks(teks);
    if (hari) return { judul: tgl ?? `Lewat ${hari} hari`, ket: `Lewat ${hari} hari`, tegas: true };
  }
  if (h?.sebab === "DATA_WAJIB" && /tidak ada item dengan jumlah baik/i.test(teks)) return { judul: "Tidak ada jumlah baik", ket: "Simpan ke stok akan ditolak; lengkapi pemeriksaan.", tegas: true };
  if (h?.sebab === "DATA_WAJIB" && /belum punya hasil pemeriksaan/i.test(teks)) return { judul: "Hasil pemeriksaan belum lengkap", ket: teks, tegas: true };
  return { judul: LABEL_SEBAB_PENDEK[h?.sebab] ?? "Tertahan", ket: teks, tegas: h?.sebab !== "MENUNGGU_WORKSPACE" };
}

const urutAntrean = (a, b) => a.indeksAntrean - b.indeksAntrean || (b.umurHari ?? -1) - (a.umurHari ?? -1) || String(a.nomor).localeCompare(String(b.nomor));
const hariLewat = (h) => Number(/(\d+)\s*hari/.exec(String(h?.teks ?? ""))?.[1] ?? 0);

/**
 * Susun SATU daftar pekerjaan dari respons server. Satu dokumen = satu baris (kunci `jenis:id[:sub]`), keterlambatan dan hambatan menjadi penanda pada baris yang sama.
 * `data` = respons /pusat-kerja; `ekstra` = halaman tambahan yang sudah dimuat { antrean: {kode: item[]}, tertahan: {kode: item[]} }.
 * Dokumen yang hanya ada di daftar tertahan (menunggu pihak lain) ikut sebagai baris tanpa tombol Gudang — jumlah "tertahan" dari server tidak boleh lebih besar dari yang terlihat.
 */
export function susunPekerjaan(data, ekstra = { antrean: {}, tertahan: {} }) {
  const baris = new Map(); const hambatanPer = new Map();
  (data?.tertahan ?? []).forEach((s) => {
    [...(s.item ?? []), ...(ekstra.tertahan?.[s.kode] ?? [])].forEach((it) => {
      const daftar = hambatanPer.get(it.kunci) ?? []; if (!daftar.some((x) => x.sebab === s.kode)) daftar.push({ sebab: s.kode, teks: it.tertahan?.teks ?? "", cakupan: it.cakupan ?? null, bahan: it.bahan ?? null }); hambatanPer.set(it.kunci, daftar);
      if (!baris.has(it.kunci)) baris.set(it.kunci, { ...it, indeksAntrean: 999, antreanKode: null, antreanJudul: null, hanyaTertahan: true });
    });
  });
  (data?.antrean ?? []).forEach((a, i) => {
    [...(a.item ?? []), ...(ekstra.antrean?.[a.kode] ?? [])].forEach((it) => { baris.set(it.kunci, { ...it, indeksAntrean: i, antreanKode: a.kode, antreanJudul: a.judul, hanyaTertahan: false }); });
  });
  const hasil = [...baris.values()].map((r) => {
    const hambatan = (hambatanPer.get(r.kunci) ?? []).sort((a, b) => (a.sebab === "JADWAL_LEWAT" ? -1 : 0) - (b.sebab === "JADWAL_LEWAT" ? -1 : 0));
    const lewat = hambatan.find((h) => h.sebab === "JADWAL_LEWAT") ?? null;
    // Dokumen "Siap masuk stok" yang tidak punya jumlah baik: server menyatakan hambatan DATA_WAJIB, tetapi aksi bawaannya masih Simpan ke stok (akan ditolak sistem).
    // Tombol diarahkan ke pemeriksaan yang perlu dilengkapi (ISI_PEMERIKSAAN, aksi sah di dokumen); status asli dan hambatan tidak diubah.
    const terblokirSimpan = r.aksi?.kode === "SIMPAN_KE_STOK" && hambatan.some((h) => h.sebab === "DATA_WAJIB");
    const aksi = terblokirSimpan ? { kode: "ISI_PEMERIKSAAN", label: "Lengkapi pemeriksaan" } : r.aksi ?? null;
    return { ...r, hambatan, lewat, lewatHari: lewat ? hariLewat(lewat) : 0, terblokirSimpan, aksi, aksiAsli: r.aksi ?? null, kelompok: kelompokJenis(r.jenis) };
  });
  return hasil.sort((a, b) => (b.lewatHari > 0) - (a.lewatHari > 0) || b.lewatHari - a.lewatHari || urutAntrean(a, b));
}

/** Penanda (filter keterlambatan/hambatan): kode "semua" | "lewat" | sebab server | "tanpa". */
export function cocokPenanda(r, penanda) {
  if (!penanda || penanda === "semua") return true;
  if (penanda === "lewat") return !!r.lewat;
  if (penanda === "tanpa") return r.hambatan.length === 0;
  if (penanda === "ada") return r.hambatan.length > 0;
  return r.hambatan.some((h) => h.sebab === penanda);
}

const norm = (v) => String(v ?? "").toLowerCase();
/** Saring baris yang SUDAH dimuat: kata kunci (nomor, terkait, jenis, status, alasan), kelompok, jenis, tahap (status), penanda. Semua kata harus cocok. */
export function saringPekerjaan(daftar, { q = "", kelompok = "semua", jenis = [], tahap = [], antrean = [], penanda = "semua" } = {}) {
  const kata = norm(q).split(/\s+/).filter(Boolean);
  return daftar.filter((r) => {
    if (kelompok !== "semua" && r.kelompok !== kelompok) return false;
    if (jenis.length && !jenis.includes(r.jenis)) return false;
    if (tahap.length && !tahap.includes(r.status)) return false;
    if (antrean.length && !antrean.includes(r.antreanKode)) return false;
    if (!cocokPenanda(r, penanda)) return false;
    if (!kata.length) return true;
    const gudang = [r.nomor, r.judul, r.terkait, r.jenisLabel, r.status, r.alasan, r.pemilikLabel, ...r.hambatan.map((h) => h.teks)].map(norm).join(" ");
    return kata.every((k) => gudang.includes(k));
  });
}

export const jumlahFilterAktif = ({ jenis = [], tahap = [], antrean = [], penanda = "semua" } = {}) => (jenis.length > 0 ? 1 : 0) + (tahap.length > 0 || antrean.length > 0 ? 1 : 0) + (penanda && penanda !== "semua" ? 1 : 0);
export const adaFilter = (f) => !!(String(f?.q ?? "").trim() || (f?.kelompok && f.kelompok !== "semua") || jumlahFilterAktif(f) > 0);

/** Pilihan filter dari baris yang dimuat (jenis & tahap yang benar-benar ada), dengan jumlah per pilihan. */
export function pilihanFilter(daftar) {
  const hitung = (kunci, label) => { const m = new Map(); daftar.forEach((r) => { const k = r[kunci]; const x = m.get(k) ?? { nilai: k, label: label(r), jumlah: 0 }; x.jumlah += 1; m.set(k, x); }); return [...m.values()].sort((a, b) => b.jumlah - a.jumlah || String(a.label).localeCompare(String(b.label), "id")); };
  return { jenis: hitung("jenis", (r) => r.jenisLabel), tahap: hitung("status", (r) => r.status) };
}

/** Jumlah baris per kelompok dari yang dimuat. */
export function hitungKelompok(daftar) {
  const h = { semua: daftar.length, penerimaan: 0, stok: 0, produksi: 0 };
  daftar.forEach((r) => { h[r.kelompok] += 1; });
  return h;
}

/**
 * Sisa data yang belum dimuat. Server memuat paling banyak `batasPerAntrean` baris per antrean/sebab; `lebih` = sisanya. Selama ada sisa, hitungan baris/tab tidak boleh disajikan sebagai total.
 */
export function sisaBelumDimuat(data, ekstra = { antrean: {}, tertahan: {} }) {
  const sisa = (daftar, peta) => (daftar ?? []).reduce((n, a) => n + Math.max(0, (a.lebih ?? 0) - (peta?.[a.kode]?.length ?? 0)), 0);
  const antrean = sisa(data?.antrean, ekstra.antrean); const tertahan = sisa(data?.tertahan, ekstra.tertahan);
  return { antrean, tertahan, ada: antrean + tertahan > 0 };
}

const antreanDi = (data, kode) => (data?.antrean ?? []).find((a) => a.kode === kode) ?? null;

/**
 * Empat kartu ringkasan. Angka = `jumlah` server (jumlah DOKUMEN per antrean; "terlambat/tertahan" = dokumen unik dari `ringkasan.tertahan`). Kartu-kartu ini bisa tumpang tindih
 * (satu dokumen boleh ada di kartu antrean dan juga bertanda terlambat), jadi tidak dijumlahkan. Keterangan "perlu dilengkapi" hanya dihitung bila semua baris sudah termuat.
 */
export function kartuRingkasan(data, baris, lengkap) {
  const a = (k) => antreanDi(data, k); const j = (k) => a(k)?.jumlah ?? 0;
  const blokir = (k) => baris.filter((r) => r.antreanKode === k && r.hambatan.some((h) => h.sebab === "DATA_WAJIB")).length;
  const lewatPenerimaan = baris.filter((r) => r.antreanKode === "PENERIMAAN_AKAN_DATANG" && r.lewat).length;
  return [
    { kode: "kedatangan", label: "Menunggu kedatangan", nilai: j("PENERIMAAN_AKAN_DATANG"), satuan: "dokumen", nada: "biru", ket: lengkap && lewatPenerimaan > 0 ? `${lewatPenerimaan} lewat jadwal` : null, filter: { antrean: ["PENERIMAAN_AKAN_DATANG"] } },
    { kode: "periksa", label: "Perlu diperiksa", nilai: j("PENERIMAAN_PERIKSA"), satuan: "dokumen", nada: "muda", ket: lengkap && blokir("PENERIMAAN_PERIKSA") > 0 ? `${blokir("PENERIMAAN_PERIKSA")} perlu dilengkapi` : null, filter: { antrean: ["PENERIMAAN_PERIKSA"] } },
    { kode: "siap", label: "Siap disimpan", nilai: j("PENERIMAAN_SIAP_STOK"), satuan: "dokumen", nada: "lavender", ket: lengkap && blokir("PENERIMAAN_SIAP_STOK") > 0 ? `${blokir("PENERIMAAN_SIAP_STOK")} perlu dilengkapi` : null, filter: { antrean: ["PENERIMAAN_SIAP_STOK"] } },
    { kode: "tertahan", label: "Terlambat atau tertahan", nilai: data?.ringkasan?.tertahan ?? 0, satuan: "dokumen", nada: "lime", ket: null, filter: { penanda: "ada" } },
  ];
}

/** Panel "Perlu perhatian": sebab tertahan dengan jumlah > 0 (angka server). */
export function ringkasPerhatian(data) {
  return (data?.tertahan ?? []).filter((s) => s.jumlah > 0).map((s) => ({ kode: s.kode, judul: s.judul, jumlah: s.jumlah, ket: KET_SEBAB[s.kode] ?? "", satuan: s.satuanHitung ?? "dokumen" }));
}

/** Pembaruan terakhir: "7 Nov, 00.21" dari `dihitungPada` (waktu server). */
export function waktuPembaruan(iso) {
  if (!iso) return null; const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")} ${g("month")}, ${g("hour")}.${g("minute")}`;
}

/** Tombol cepat dari hasil pencarian server: aksi "Simpan ke stok" dari pencarian TIDAK ditawarkan (jumlah baik tak diketahui di hasil pencarian) — pengguna membuka dokumennya. */
export function aksiHasilCari(h) {
  if (!h?.aksi) return null;
  if (h.jenis === "penerimaan" && h.aksi.kode === "SIMPAN_KE_STOK") return null;
  return h.aksi;
}
