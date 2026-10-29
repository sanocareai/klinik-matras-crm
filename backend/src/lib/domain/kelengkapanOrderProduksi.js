// KELENGKAPAN ORDER PRODUKSI — klasifikasi MURNI (tanpa DB; diuji node --test). SATU sumber untuk daftar, drawer, ekspor Excel, dan hitungan filter.
//
// Empat penyaring cepat untuk Admin menemukan dan melengkapi data. Unit boleh masuk BEBERAPA kategori; total gabungan menghitung unit UNIK.
//
//   1. BAHAN_BELUM_DICATAT — unit yang SUDAH dikerjakan/selesai tetapi TIDAK punya catatan pemakaian apa pun (Gudang/Material Issue ISSUE, pemakaian sementara, komponen lama, catatan historis)
//      dan TIDAK punya pernyataan eksplisit "tanpa bahan baru". Unit yang belum tiba/menunggu dijemput, belum dikerjakan, atau dibatalkan TIDAK dianggap kurang bahan.
//      Tidak ada tebakan "unit ini pasti tidak butuh bahan": hanya pernyataan yang bisa diaudit (unit_material_declarations) yang menghapus kekurangan ini.
//   2. BAHAN_PERLU_DICEK — alasan KONKRET yang benar-benar ada di sistem: pemakaian sementara belum direkonsiliasi (bahan belum terpetakan ke katalog / stok belum diketahui) dan catatan
//      historis berstatus "Perlu dicek" (belum terpetakan ke katalog, satuan bermasalah, atau penanda lain dari katalog penanda). Catatan historis BUKAN pengeluaran stok resmi.
//   3. HPP_BELUM_LENGKAP — HPP OPERASIONAL (harga berlaku Gudang; BUKAN nilai persediaan/biaya Finance): harga belum diketahui, pemakaian belum dibekukan/dibekukan tanpa harga padahal harga sudah ada,
//      kegagalan pembekuan, pemakaian sementara (belum punya harga), catatan historis tertahan (belum jadi pengeluaran stok), dan unit yang dikerjakan tetapi bahan belum dicatat (HPP belum bisa dihitung,
//      bukan "nol"). HPP TIDAK disebut lengkap hanya karena catatan yang kebetulan sudah diinput bernilai: kelengkapan catatan ikut dinilai.
//   4. DATA_ORDER_KURANG — HANYA kebutuhan wajib yang dapat dibuktikan dari aturan saat ini: kelengkapan order Penjualan Karyawan (merk, ukuran, kirim/ambil, alamat per kategori — gerbang yang sama dipakai
//      Rencana Produksi). Target, PIC, rencana bahan, dan data lain yang opsional TIDAK pernah dihitung sebagai kekurangan. Aturan Ukuran Custom wajib (pengaturan) belum aktif ⇒ tidak dinilai.

export const KELENGKAPAN = Object.freeze({
  BAHAN_BELUM_DICATAT: Object.freeze({ key: "BAHAN_BELUM_DICATAT", label: "Bahan belum dicatat", bagian: "bahan", tone: "orange" }),
  BAHAN_PERLU_DICEK: Object.freeze({ key: "BAHAN_PERLU_DICEK", label: "Bahan perlu dicek", bagian: "bahan-cek", tone: "orange" }),
  HPP_BELUM_LENGKAP: Object.freeze({ key: "HPP_BELUM_LENGKAP", label: "HPP belum lengkap", bagian: "hpp", tone: "orange" }),
  DATA_ORDER_KURANG: Object.freeze({ key: "DATA_ORDER_KURANG", label: "Data order kurang", bagian: "data-order", tone: "orange" }),
});
export const KELENGKAPAN_KEYS = Object.freeze(Object.keys(KELENGKAPAN));
export const KELENGKAPAN_LABEL = Object.freeze(Object.fromEntries(KELENGKAPAN_KEYS.map((k) => [k, KELENGKAPAN[k].label])));
/** Catatan yang selalu ditampilkan di info: apa yang TIDAK dihitung sebagai kekurangan. */
export const BUKAN_KEKURANGAN = "Target selesai, PIC, dan rencana bahan bersifat opsional — tidak dihitung sebagai kekurangan. Pekerjaan yang belum dilakukan juga bukan kekurangan data.";
export const CATATAN_HPP = "HPP operasional = harga berlaku Gudang pada waktu pemakaian. Bukan nilai persediaan dan bukan biaya/jurnal Finance.";

/** Status kerja yang berarti pekerjaan SUDAH berjalan/selesai (dasar menilai "bahan belum dicatat"). TERTUNDA/BELUM/DIJADWALKAN tidak dinilai. */
export const KERJA_BERJALAN = Object.freeze(["DIKERJAKAN", "MENUNGGU_QC", "DIKERJAKAN_ULANG", "SELESAI"]);
const BELUM_TIBA = new Set(["AWAITING_PICKUP", "IN_TRANSIT_IN"]);

/** Apakah bahan unit ini layak dinilai ("sudah dikerjakan/selesai"). Menunggu dijemput/dalam perjalanan masuk, belum dikerjakan, dan dibatalkan TIDAK. */
export function bahanLayakDinilai({ unitStatus, kerjaKey } = {}) {
  if (!unitStatus || unitStatus === "CANCELLED" || BELUM_TIBA.has(unitStatus)) return false;
  return KERJA_BERJALAN.includes(kerjaKey);
}

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const jamak = (jumlah, satu, banyak = satu) => `${jumlah} ${jumlah === 1 ? satu : banyak}`;
const item = (def, alasan) => ({ key: def.key, label: def.label, bagian: def.bagian, tone: def.tone, alasan, ringkas: alasan[0]?.teks ?? def.label });
const sebab = (kode, teks, jumlah = null) => ({ kode, teks, ...(jumlah === null ? {} : { jumlah }) });

/**
 * Klasifikasi kelengkapan SATU unit.
 * @param {object} f
 * @param {string} f.unitStatus       Unit.status
 * @param {string} f.kerjaKey         status kerja EFEKTIF (adopsi.kerja.key)
 * @param {{baru?:number,lama?:number,sementaraPerlu?:number,sementaraSelesai?:number}} [f.pemakaian] pemakaian aktual: bahan baru (ISSUE), komponen lama dipakai kembali, pemakaian sementara
 * @param {{perluTerpetakan?:number,perluBelumTerpetakan?:number}} [f.sementara] pemakaian sementara PERLU_REKONSILIASI: yang sudah punya bahan katalog vs belum terpetakan
 * @param {{ada?:number,perluDicek?:number,siapPosting?:number,alasan?:{katalog?:number,satuan?:number,lain?:Array<{kode:string,teks:string,jumlah:number}>}}} [f.catatan] catatan historis EFEKTIF (tanpa jumlah-0)
 * @param {{gerak?:number,hargaBelumDiketahui?:number,perluPenerapan?:number,gagal?:number}} [f.hpp] pergerakan bertaut unit menurut keadaan pembekuan harga operasional
 * @param {{alasan?:string,oleh?:string|null,at?:Date|string|null}|null} [f.pernyataan] pernyataan "tanpa bahan baru" AKTIF
 * @param {{nomor?:string|null,lengkap?:boolean,kurang?:string[]}|null} [f.pkr] kelengkapan order Penjualan Karyawan (rujukanPkrDariOrder); null = bukan order PKR
 * @returns {{keys:string[],items:Record<string,object>,ringkas:string,bahanDinilai:boolean,pernyataan:object|null}}
 */
export function klasifikasiKelengkapan(f = {}) {
  const aktif = f.unitStatus && f.unitStatus !== "CANCELLED";
  const pem = f.pemakaian ?? {}; const sem = f.sementara ?? {}; const cat = f.catatan ?? {}; const hpp = f.hpp ?? {};
  const pernyataan = f.pernyataan ?? null;
  const sementaraTotal = n(pem.sementaraPerlu) + n(pem.sementaraSelesai);
  const adaCatatan = n(pem.baru) > 0 || n(pem.lama) > 0 || sementaraTotal > 0 || n(cat.ada) > 0;
  const dinilai = bahanLayakDinilai({ unitStatus: f.unitStatus, kerjaKey: f.kerjaKey });
  const items = {};

  // 1) Bahan belum dicatat
  const belumDicatat = !!aktif && dinilai && !adaCatatan && !pernyataan;
  if (belumDicatat) {
    items.BAHAN_BELUM_DICATAT = item(KELENGKAPAN.BAHAN_BELUM_DICATAT, [
      sebab("BAHAN_TIDAK_ADA_CATATAN", "Unit sudah dikerjakan/selesai, tetapi belum ada catatan pemakaian bahan (Gudang, sementara, komponen lama, atau historis)."),
      sebab("PERNYATAAN_BELUM_ADA", "Bila unit ini memang tidak memakai bahan baru, nyatakan secara eksplisit (tercatat atas nama Anda) — bukan ditebak."),
    ]);
  }

  // 2) Bahan perlu dicek — hanya alasan yang benar-benar ada di sistem
  const cek = [];
  if (aktif) {
    if (n(sem.perluBelumTerpetakan) > 0) cek.push(sebab("SEMENTARA_BELUM_TERPETAKAN", `${jamak(n(sem.perluBelumTerpetakan), "pemakaian sementara")}: bahan belum terpetakan ke katalog Gudang (menunggu rekonsiliasi).`, n(sem.perluBelumTerpetakan)));
    if (n(sem.perluTerpetakan) > 0) cek.push(sebab("SEMENTARA_BELUM_DIREKONSILIASI", `${jamak(n(sem.perluTerpetakan), "pemakaian sementara")} belum direkonsiliasi Gudang (stok bahan belum diketahui).`, n(sem.perluTerpetakan)));
    const al = cat.alasan ?? {};
    if (n(al.katalog) > 0) cek.push(sebab("CATATAN_BELUM_TERPETAKAN", `${jamak(n(al.katalog), "catatan historis")}: bahan belum terpetakan ke katalog (belum ada, ganda, atau nonaktif).`, n(al.katalog)));
    if (n(al.satuan) > 0) cek.push(sebab("CATATAN_SATUAN_BERMASALAH", `${jamak(n(al.satuan), "catatan historis")}: satuan bermasalah (tidak dikenal atau beda dari satuan bahan).`, n(al.satuan)));
    for (const l of al.lain ?? []) if (n(l.jumlah) > 0) cek.push(sebab(`CATATAN_${l.kode}`, `${jamak(n(l.jumlah), "catatan historis")}: ${l.teks}`, n(l.jumlah)));
    // catatan "Perlu dicek" tanpa penanda BLOK yang bisa diuraikan tetap harus terlihat (jangan hilang diam-diam)
    const terurai = n(al.katalog) + n(al.satuan) + (al.lain ?? []).reduce((s, l) => s + n(l.jumlah), 0);
    if (n(cat.perluDicek) > terurai) cek.push(sebab("CATATAN_PERLU_DICEK_LAIN", `${jamak(n(cat.perluDicek) - terurai, "catatan historis")} berstatus Perlu dicek (alasan rinci ada di catatan).`, n(cat.perluDicek) - terurai));
  }
  if (cek.length) items.BAHAN_PERLU_DICEK = item(KELENGKAPAN.BAHAN_PERLU_DICEK, cek);

  // 3) HPP belum lengkap (HPP OPERASIONAL; bukan biaya Finance)
  const h = [];
  if (aktif) {
    if (n(hpp.hargaBelumDiketahui) > 0) h.push(sebab("HPP_HARGA_BELUM_DIKETAHUI", `${jamak(n(hpp.hargaBelumDiketahui), "pemakaian bahan")} tanpa harga operasional (harga berlaku bahan belum diisi).`, n(hpp.hargaBelumDiketahui)));
    if (n(hpp.perluPenerapan) > 0) h.push(sebab("HPP_BELUM_DITERAPKAN", `${jamak(n(hpp.perluPenerapan), "pemakaian bahan")} belum dibekukan / dibekukan tanpa harga, padahal harga berlaku sudah ada (perlu penerapan khusus).`, n(hpp.perluPenerapan)));
    if (n(hpp.gagal) > 0) h.push(sebab("HPP_GAGAL_PEMBEKUAN", `${jamak(n(hpp.gagal), "pembekuan harga")} gagal saat pemakaian diposting (tercatat; perlu diperbaiki).`, n(hpp.gagal)));
    if (n(pem.sementaraPerlu) > 0) h.push(sebab("HPP_SEMENTARA", `${jamak(n(pem.sementaraPerlu), "pemakaian sementara")} belum punya harga operasional (belum masuk HPP sampai direkonsiliasi).`, n(pem.sementaraPerlu)));
    const tertahan = n(cat.siapPosting) + n(cat.perluDicek);
    if (tertahan > 0) h.push(sebab("HPP_CATATAN_TERTAHAN", `${jamak(tertahan, "catatan historis")} belum jadi pengeluaran stok resmi (tertahan) — belum masuk HPP.`, tertahan));
    if (belumDicatat) h.push(sebab("HPP_BAHAN_BELUM_DICATAT", "Pemakaian bahan belum dicatat, jadi HPP belum bisa dihitung (bukan nol)."));
  }
  if (h.length) items.HPP_BELUM_LENGKAP = item(KELENGKAPAN.HPP_BELUM_LENGKAP, h);

  // 4) Data order kurang — hanya yang wajib dan terbukti (order PKR)
  if (aktif && f.pkr && f.pkr.lengkap === false && (f.pkr.kurang ?? []).length) {
    items.DATA_ORDER_KURANG = item(KELENGKAPAN.DATA_ORDER_KURANG, [
      sebab("PKR_BELUM_LENGKAP", `Order Penjualan Karyawan${f.pkr.nomor ? ` ${f.pkr.nomor}` : ""} belum lengkap: ${f.pkr.kurang.join(", ")}.`, f.pkr.kurang.length),
    ]);
  }

  const keys = KELENGKAPAN_KEYS.filter((k) => items[k]);
  return {
    keys, items, ringkas: keys.map((k) => KELENGKAPAN[k].label).join(" · "),
    bahanDinilai: dinilai,
    pernyataan: pernyataan ? { alasan: pernyataan.alasan ?? null, oleh: pernyataan.oleh ?? null, at: pernyataan.at ?? null } : null,
  };
}

/**
 * Pengelompokan penanda BLOK catatan historis menjadi alasan konkret (katalog / satuan / lain). Murni.
 * @param {Array<Array<{kode:string,tingkat?:string,teks?:string}>>} daftarFlags satu daftar penanda per catatan "Perlu dicek"
 */
export function uraikanAlasanCatatan(daftarFlags) {
  const KATALOG = new Set(["NAMA_TIDAK_DI_KATALOG", "BAHAN_GANDA", "BAHAN_NONAKTIF"]);
  const SATUAN = new Set(["SATUAN_BEDA_MASTER", "SATUAN_TAK_DIKENAL", "ISSUE_LAMA_SATUAN_BEDA"]);
  const out = { katalog: 0, satuan: 0, lain: [] };
  const lain = new Map();
  for (const flags of daftarFlags || []) {
    const blok = (flags || []).filter((x) => x?.tingkat === "BLOK");
    if (!blok.length) continue;
    // satu catatan dihitung SEKALI per kelompok, memakai penanda BLOK pertama yang menentukan kelompoknya
    const kodeKatalog = blok.some((x) => KATALOG.has(x.kode)); const kodeSatuan = blok.some((x) => SATUAN.has(x.kode));
    if (kodeKatalog) { out.katalog += 1; continue; }
    if (kodeSatuan) { out.satuan += 1; continue; }
    const p = blok[0]; const e = lain.get(p.kode) ?? { kode: p.kode, teks: String(p.teks ?? p.kode).replace(/\s+/g, " ").trim().slice(0, 140), jumlah: 0 }; e.jumlah += 1; lain.set(p.kode, e);
  }
  out.lain = [...lain.values()].sort((a, b) => b.jumlah - a.jumlah).slice(0, 3);
  return out;
}

/** Gabungan UNIK: berapa unit yang masuk setidaknya satu dari kunci terpilih (kosong = semua kategori). Murni. */
export function hitungKelengkapan(daftarKunciPerUnit) {
  const counts = Object.fromEntries(KELENGKAPAN_KEYS.map((k) => [k, 0]));
  let unik = 0;
  for (const keys of daftarKunciPerUnit) { if (keys.length) unik += 1; for (const k of keys) if (k in counts) counts[k] += 1; }
  return { counts, unik };
}

/** Penyaring: unit lolos bila punya SETIDAKNYA SATU kunci terpilih (gabungan/OR). Daftar kosong = tanpa penyaringan. */
export const lolosKelengkapan = (keys, terpilih) => !terpilih?.length || terpilih.some((k) => keys.includes(k));
/** Kunci terpilih dari query string (csv; hanya kunci dikenal; huruf besar). */
export const parseKelengkapan = (v) => [...new Set(String(v ?? "").toUpperCase().split(",").map((s) => s.trim()).filter((k) => KELENGKAPAN_KEYS.includes(k)))];
