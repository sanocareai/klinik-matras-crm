// HPP PER ORDER — aturan MURNI (tanpa DB; diuji node --test). Dipakai antrean PIC, laporan HPP per order, dan jalur biaya tanpa stok.
//
// PRINSIP:
//   1. "Ada pemakaian" ≠ "HPP lengkap". Unit LENGKAP hanya bila: seluruh baris biayanya bernilai, tidak ada catatan/biaya yang masih tertahan, DAN PIC sudah mengonfirmasi pemakaian lengkap
//      dengan sidik baris yang SAMA dengan saat ini (baris berubah sesudah konfirmasi → BASI). Pengecualian: pernyataan "tanpa bahan baru" yang sudah ada (unit_material_declarations) tanpa baris bahan.
//   2. Biaya kosong tetap BELUM DIKETAHUI (null), tidak pernah Rp0.
//   3. Jalur pencatatan ditentukan TANGGAL PEMAKAIAN terhadap tanggal SO yang ditautkan ke bahan: sesudah SO → pengeluaran stok resmi; pada/sebelum SO → biaya tanpa stok (stok tidak dikurangi lagi).
//   4. Hasil manajemen sementara = laba jurnal yang DIJEMBATANI baris per baris (klasifikasiBarisJurnal): hanya baris jurnal yang TERBUKTI sudah terwakili HPP operasional,
//      milik order yang pendapatannya tidak diakui pada periode, atau koreksi saldo lama yang dibalik; SEMUA baris lain tetap dihitung (tidak ada akun yang dikeluarkan utuh).
//   5. Dasar harga: jam pemakaian diketahui → harga pada jam itu; hanya tanggal → harga awal hari HANYA bila harga tidak berubah pada hari itu (harga awal hari = harga sepanjang hari);
//      harga berubah pada hari itu → PERLU_KEPUTUSAN (kandidat disimpan, penyetuju memilih dengan alasan); tidak ada harga → TANPA_HARGA (belum diketahui).
//   6. Ganda: penolakan MUTLAK hanya untuk identitas yang sama — sumber yang sama (jenis + rujukan baris; indeks unik), kunci idempotensi, atau tautan transaksi yang sama
//      (catatan sumber sudah tertaut ke pengeluaran stok). Tanggal + jumlah yang sama hanyalah INDIKATOR kuat: wajib konfirmasi "bukan duplikat" beralasan + persetujuan orang lain.
//   7. Koreksi saldo lama ditentukan ASAL DOKUMEN dan PERIODE YANG DIKOREKSI (Persediaan Awal → saldo s.d. sehari sebelum cutover; penyesuaian stok → tanggal catatan/pergerakan
//      asalnya), bukan jenis sumber saja dan bukan tanggal jurnal terhadap tanggal SO. Dokumen tanpa periode dikoreksi → tetap dihitung, perlu klasifikasi.
import crypto from "node:crypto";

export const JALUR = Object.freeze({
  STOK: Object.freeze({ key: "STOK", label: "Pengeluaran bahan resmi", teks: "Tanggal pemakaian SESUDAH tanggal SO bahan (atau bahan tanpa tautan SO): catat sebagai pengeluaran stok resmi lewat pembetulan unit — hanya bila belum tercatat." }),
  BIAYA_TANPA_STOK: Object.freeze({ key: "BIAYA_TANPA_STOK", label: "Biaya per order tanpa stok", teks: "Tanggal pemakaian PADA/SEBELUM tanggal SO yang ditautkan: hitung fisik SO sudah mencakup pemakaian ini. Catat biaya per order TANPA mengurangi stok lagi; berlaku langsung bila dicatat ADMIN, selain itu sesudah diverifikasi ADMIN lain." }),
});

/** Jalur untuk satu pemakaian. tanggal & soTanggal = YYYY-MM-DD (WIB). soTanggal null = bahan tanpa tautan SO. */
export function tentukanJalur({ tanggal, soTanggal = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tanggal ?? ""))) throw new Error("tanggal pemakaian wajib YYYY-MM-DD");
  return soTanggal && tanggal <= soTanggal ? JALUR.BIAYA_TANPA_STOK : JALUR.STOK;
}

export const STATUS_UNIT = Object.freeze({
  BELUM_ADA_PEMAKAIAN: Object.freeze({ key: "BELUM_ADA_PEMAKAIAN", label: "Belum ada pemakaian", tone: "red", lengkap: false, langkah: "Catat pemakaian bahan (atau nyatakan tanpa bahan baru bila memang tidak ada)." }),
  BELUM_LENGKAP: Object.freeze({ key: "BELUM_LENGKAP", label: "Ada pemakaian, belum lengkap", tone: "orange", lengkap: false, langkah: "Lengkapi harga/catatan yang tertahan, lalu konfirmasi pemakaian lengkap." }),
  MENUNGGU_PERSETUJUAN: Object.freeze({ key: "MENUNGGU_PERSETUJUAN", label: "Menunggu verifikasi biaya", tone: "amber", lengkap: false, langkah: "Biaya tanpa stok menunggu verifikasi ADMIN (orang lain dari pencatat)." }),
  SIAP_DIKONFIRMASI: Object.freeze({ key: "SIAP_DIKONFIRMASI", label: "Siap dikonfirmasi PIC", tone: "blue", lengkap: false, langkah: "Semua baris bernilai. PIC memeriksa apakah SEMUA bahan sudah tercatat, lalu konfirmasi pemakaian lengkap." }),
  KONFIRMASI_BASI: Object.freeze({ key: "KONFIRMASI_BASI", label: "Berubah sesudah konfirmasi", tone: "orange", lengkap: false, langkah: "Baris biaya berubah sesudah dikonfirmasi. Periksa ulang lalu konfirmasi lagi." }),
  LENGKAP: Object.freeze({ key: "LENGKAP", label: "HPP lengkap", tone: "green", lengkap: true, langkah: "" }),
  TANPA_BAHAN_BARU: Object.freeze({ key: "TANPA_BAHAN_BARU", label: "Tanpa bahan baru (pernyataan)", tone: "green", lengkap: true, langkah: "" }),
});
export const STATUS_UNIT_KEYS = Object.freeze(Object.keys(STATUS_UNIT));

const r2 = (v) => Math.round(Number(v) * 100) / 100;

/**
 * Sidik baris biaya unit: berubah bila ada baris baru/hilang, status nilai berubah, atau nominal berubah. Urutan tidak berpengaruh.
 * baris: [{ id, sumber: "STOK"|"BIAYA_TANPA_STOK", status, subtotal }]
 */
export function sidikBaris(baris) {
  const k = (baris ?? []).map((b) => [b.sumber ?? "STOK", String(b.id), b.status ?? "", b.subtotal == null ? "null" : r2(b.subtotal).toFixed(2)].join("|")).sort();
  return crypto.createHash("sha256").update(JSON.stringify(k)).digest("hex");
}

/**
 * Status HPP satu unit.
 * @param {object} f
 * @param {Array} f.baris            baris biaya (pergerakan stok unit bertipe biaya + biaya tanpa stok DISETUJUI): { id, sumber, status ('DIBEKUKAN'|'TANPA_HARGA'|'PERLU_KEPUTUSAN'|'BELUM_DIBEKUKAN'|'GAGAL'), subtotal }
 * @param {number} [f.catatanTertahan] catatan historis PERLU_DICEK/SIAP_POSTING
 * @param {number} [f.sementara]       pemakaian sementara PERLU_REKONSILIASI
 * @param {number} [f.biayaDiajukan]   biaya tanpa stok yang masih DIAJUKAN
 * @param {boolean} [f.pernyataanTanpaBahan] pernyataan aktif "tanpa bahan baru"
 * @param {{sidik:string}|null} [f.konfirmasi] konfirmasi aktif
 */
export function statusUnitHpp({ baris = [], catatanTertahan = 0, sementara = 0, biayaDiajukan = 0, pernyataanTanpaBahan = false, konfirmasi = null } = {}) {
  const tanpaNilai = baris.filter((b) => b.status !== "DIBEKUKAN").length;
  const sidik = sidikBaris(baris);
  const tertahan = (catatanTertahan || 0) + (sementara || 0);
  const nilaiDiketahui = r2(baris.filter((b) => b.status === "DIBEKUKAN").reduce((a, b) => a + Number(b.subtotal || 0), 0));
  const dasar = { sidik, barisBiaya: baris.length, barisTanpaNilai: tanpaNilai, tertahan, biayaDiajukan: biayaDiajukan || 0, nilaiDiketahui: baris.some((b) => b.status === "DIBEKUKAN") ? nilaiDiketahui : null };
  let st;
  if (!baris.length && !tertahan && !biayaDiajukan) st = pernyataanTanpaBahan ? STATUS_UNIT.TANPA_BAHAN_BARU : STATUS_UNIT.BELUM_ADA_PEMAKAIAN;
  else if (tanpaNilai > 0 || tertahan > 0) st = STATUS_UNIT.BELUM_LENGKAP;
  else if (biayaDiajukan > 0) st = STATUS_UNIT.MENUNGGU_PERSETUJUAN;
  else if (!konfirmasi) st = STATUS_UNIT.SIAP_DIKONFIRMASI;
  else if (konfirmasi.sidik !== sidik) st = STATUS_UNIT.KONFIRMASI_BASI;
  else st = STATUS_UNIT.LENGKAP;
  // Nilai HPP unit hanya disebut LENGKAP bila status lengkap; selain itu nilaiDiketahui adalah bagian yang DIKETAHUI saja (bukan total).
  return { ...dasar, key: st.key, label: st.label, tone: st.tone, lengkap: st.lengkap, langkah: st.langkah, nilaiLengkap: st.lengkap ? (st.key === "TANPA_BAHAN_BARU" ? 0 : nilaiDiketahui) : null };
}

/** Status order = gabungan unit: LENGKAP bila semua unit lengkap; BELUM_DIKETAHUI bila tak satu pun bernilai; selain itu PARSIAL. */
export function statusOrderHpp(unitStatus) {
  const n = unitStatus.length; const lengkap = unitStatus.filter((u) => u.lengkap).length;
  const adaNilai = unitStatus.some((u) => u.nilaiDiketahui != null);
  const nilaiDiketahui = r2(unitStatus.reduce((a, u) => a + (u.nilaiDiketahui ?? 0), 0));
  const key = n > 0 && lengkap === n ? "LENGKAP" : adaNilai ? "PARSIAL" : "BELUM_DIKETAHUI";
  return { key, unit: n, unitLengkap: lengkap, nilaiDiketahui: adaNilai || key === "LENGKAP" ? nilaiDiketahui : null, nilaiLengkap: key === "LENGKAP" ? nilaiDiketahui : null };
}

export const AKUN_UPAH = "5-1200"; export const AKUN_OVERHEAD = "5-1300";
export const AKUN_SUSUT = "5-1900"; export const AKUN_SELISIH_OPNAME = "5-1960";

// ───────────────────────────── DASAR HARGA ─────────────────────────────
export const DASAR_HARGA = Object.freeze({
  WAKTU_DIKETAHUI: "Jam pemakaian diketahui dari sumber: Harga Berlaku pada jam itu.",
  AWAL_HARI_TANPA_PERUBAHAN: "Hanya tanggal diketahui dan Harga Berlaku TIDAK berubah pada hari itu: harga awal hari sama dengan harga sepanjang hari, jadi tidak ada pilihan tersembunyi.",
  PERLU_KEPUTUSAN: "Hanya tanggal diketahui dan Harga Berlaku BERUBAH pada hari itu: sistem tidak memilih. Penyetuju memilih salah satu kandidat dengan alasan, atau menolak dan meminta jam pemakaian.",
  KEPUTUSAN_PENYETUJU: "Harga dipilih penyetuju dari kandidat hari itu (alasan tercatat).",
  TANPA_HARGA: "Belum ada Harga Berlaku pada waktu pemakaian: biaya BELUM DIKETAHUI (bukan Rp0).",
});

/**
 * Dasar harga satu biaya (murni).
 *   awalHari        = harga yang berlaku pada 00:00 WIB tanggal pemakaian ({ priceId, harga, mulai }) atau null
 *   berubahPadaHari = harga yang MULAI berlaku di dalam hari itu (sesudah 00:00, sebelum 24:00), urut waktu
 *   waktuDiketahui  = jam pemakaian diketahui dari sumber; diWaktu = harga pada jam itu (atau null)
 */
export function dasarHargaBiaya({ waktuDiketahui = false, awalHari = null, berubahPadaHari = [], diWaktu = null }) {
  if (waktuDiketahui) return diWaktu ? { status: "DINILAI", basis: "WAKTU_DIKETAHUI", pilihan: diWaktu, kandidat: null } : { status: "TANPA_HARGA", basis: "TANPA_HARGA", pilihan: null, kandidat: null };
  if (berubahPadaHari.length) return { status: "PERLU_KEPUTUSAN", basis: "PERLU_KEPUTUSAN", pilihan: null, kandidat: [...(awalHari ? [{ ...awalHari, jenis: "AWAL_HARI" }] : []), ...berubahPadaHari.map((k) => ({ ...k, jenis: "BERUBAH_PADA_HARI" }))] };
  return awalHari ? { status: "DINILAI", basis: "AWAL_HARI_TANPA_PERUBAHAN", pilihan: awalHari, kandidat: null } : { status: "TANPA_HARGA", basis: "TANPA_HARGA", pilihan: null, kandidat: null };
}

// ───────────────────────────── IDENTITAS SUMBER & GANDA ─────────────────────────────
/** Rujukan sumber dinormalkan (huruf kecil, spasi tunggal): "LAP PIC 05/11  baris 3" dan "lap pic 05/11 baris 3" adalah sumber yang sama. */
export const normalRujukan = (t) => String(t ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Pisahkan kandidat ganda menurut kekuatan indikator: identik = tanggal pemakaian sama DAN jumlah sama (indikator KUAT, BUKAN penolakan mutlak); mirip = lainnya.
 * Keduanya butuh konfirmasi "bukan duplikat" beralasan. Penolakan mutlak hanya untuk sumber/tautan transaksi yang sama (diperiksa layanan, bukan di sini).
 * kandidat = [{ kind, id, qty, tanggal|null }] dalam satuan stok / YYYY-MM-DD.
 */
export function pisahkanGanda(kandidat, { qty, tanggal }) {
  const identik = []; const mirip = [];
  for (const k of kandidat ?? []) {
    const sama = k.qty != null && Math.abs(Number(k.qty) - Number(qty)) < 0.00005 && k.tanggal != null && k.tanggal === tanggal;
    (sama ? identik : mirip).push(k);
  }
  return { identik, mirip };
}
/** Sidik daftar kandidat (urutan tidak berpengaruh) — dibandingkan ulang saat persetujuan. */
export function sidikKandidat(kandidat) {
  const k = (kandidat ?? []).map((x) => `${x.kind}|${x.id}`).sort();
  return crypto.createHash("sha256").update(JSON.stringify(k)).digest("hex");
}

// ───────────────────────────── JEMBATAN LABA JURNAL → HASIL MANAJEMEN ─────────────────────────────
export const KELOMPOK_JURNAL = Object.freeze({
  TERWAKILI_HPP_OPERASIONAL: Object.freeze({ key: "TERWAKILI_HPP_OPERASIONAL", label: "Sudah terwakili HPP operasional order diakui", dibalik: true,
    teks: "Pemakaian bahan unit milik order yang pendapatannya diakui pada periode, dan SEMUA pergerakan di baliknya bernilai operasional: diganti HPP operasional (tidak dihitung dua kali)." }),
  ORDER_BELUM_DIAKUI: Object.freeze({ key: "ORDER_BELUM_DIAKUI", label: "Pemakaian untuk order yang pendapatannya tidak diakui pada periode", dibalik: true,
    teks: "Dicocokkan dengan pendapatannya: ditampilkan terpisah, tidak masuk hasil periode ini." }),
  KOREKSI_SALDO_LAMA: Object.freeze({ key: "KOREKSI_SALDO_LAMA", label: "Koreksi saldo lama (paket terpisah)", dibalik: true,
    teks: "Dokumen asalnya (Persediaan Awal, penyesuaian stok bertautan catatan/pergerakan) mengoreksi periode SEBELUM periode laporan: bukan biaya periode ini; diselesaikan di paket saldo lama." }),
  BEBAN_TETAP_DIHITUNG: Object.freeze({ key: "BEBAN_TETAP_DIHITUNG", label: "Beban pokok yang tetap dihitung", dibalik: false,
    teks: "Tidak terbukti terwakili HPP operasional dan bukan koreksi saldo lama: tetap dihitung apa adanya dari jurnal." }),
  PERLU_KLASIFIKASI: Object.freeze({ key: "PERLU_KLASIFIKASI", label: "Tetap dihitung — perlu keputusan klasifikasi", dibalik: false,
    teks: "Tetap dihitung (tidak dikeluarkan otomatis). Finance memutuskan apakah ini koreksi saldo lama atau beban periode." }),
});

const asal = (r) => (r.sumber === "REVERSAL" && r.membalik?.sumber ? r.membalik.sumber : r.sumber);

/**
 * Klasifikasi SATU baris jurnal beban pokok (murni). Setiap baris masuk TEPAT SATU kelompok.
 * r   = { entryId, akunKode, sumber, membalik:{sumber}|null, unitId|null, tanggal(YYYY-MM-DD), kunciKelompok }
 * ctx = { unitDiakui:Set, kelompokBernilai: Map(kunciKelompok → true|false), periodeMulai:'YYYY-MM-DD',
 *         asalKoreksi: Map(entryId → { jenis, nomor|null, periodeAkhir:'YYYY-MM-DD'|null, bukti }) — dokumen koreksi di balik jurnal (pembalik memakai dokumen jurnal yang dibalik) }
 *   kelompokBernilai: true = semua pergerakan di balik baris bernilai operasional; false = ada yang belum; tidak ada = pergerakan tidak ditemukan.
 */
export function klasifikasiBarisJurnal(r, ctx) {
  const s = asal(r); const K = KELOMPOK_JURNAL;
  if (r.akunKode === AKUN_UPAH) return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "UPAH", alasan: "Upah produksi" };
  if (r.akunKode === AKUN_OVERHEAD) return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "OVERHEAD", alasan: "Overhead produksi" };
  const ak = ctx.asalKoreksi?.get(r.entryId) ?? null;
  if (s === "PERSEDIAAN_AWAL" || ak) {
    const dok = ak ? `${ak.bukti}${ak.nomor ? ` ${ak.nomor}` : ""}` : "Persediaan Awal (dokumen tidak ditemukan)";
    if (ak?.periodeAkhir && ctx.periodeMulai && ak.periodeAkhir < ctx.periodeMulai) return { kelompok: K.KOREKSI_SALDO_LAMA.key, peran: "SALDO_LAMA", alasan: `${dok}: mengoreksi saldo s.d. ${ak.periodeAkhir}, sebelum periode laporan` };
    if (ak?.periodeAkhir) return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "KOREKSI_PERIODE_INI", alasan: `${dok}: mengoreksi periode laporan ini (s.d. ${ak.periodeAkhir}) — tetap dihitung` };
    return { kelompok: K.PERLU_KLASIFIKASI.key, peran: "KOREKSI_TANPA_PERIODE", alasan: `${dok}: periode yang dikoreksi tidak tercatat di dokumen — tetap dihitung sampai Finance memutuskan` };
  }
  if (s === "PEMAKAIAN_BAHAN" && r.unitId) {
    if (r.akunKode === AKUN_SUSUT) return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "SUSUT", alasan: "Susut unit: bukan bagian HPP operasional bahan, tetap dihitung dari jurnal" };
    if (!ctx.unitDiakui.has(r.unitId)) return { kelompok: K.ORDER_BELUM_DIAKUI.key, peran: "BAHAN", alasan: "Unit milik order yang pendapatannya tidak diakui pada periode" };
    const bernilai = ctx.kelompokBernilai.get(r.kunciKelompok);
    if (bernilai === true) return { kelompok: K.TERWAKILI_HPP_OPERASIONAL.key, peran: "BAHAN", alasan: "Semua pergerakan di balik baris ini bernilai operasional" };
    return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "BAHAN_NILAI_JURNAL",
      alasan: bernilai === false ? "Sebagian pergerakan belum bernilai operasional: nilai jurnal dipakai, nilai operasional pergerakan itu dikeluarkan agar tidak ganda" : "Pergerakan di balik baris tidak ditemukan: nilai jurnal tetap dihitung" };
  }
  if (r.akunKode === AKUN_SELISIH_OPNAME) return { kelompok: K.PERLU_KLASIFIKASI.key, peran: "SELISIH_STOK", alasan: "Selisih stok tanpa dokumen koreksi yang menyebut periode dikoreksi: tetap dihitung sampai Finance memutuskan (tanggal jurnal saja tidak cukup)" };
  if (r.akunKode === "5-1150" || ((s === "TAGIHAN_SUPPLIER" || s === "PEMBELIAN") && r.akunKode === "5-1100")) return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "PEMBELIAN_LANGSUNG", alasan: "Pembelian dibebankan langsung (tanpa stok): tetap dihitung" };
  return { kelompok: K.BEBAN_TETAP_DIHITUNG.key, peran: "LAIN", alasan: "Beban pokok lain" };
}

/**
 * Hasil manajemen sementara + JEMBATAN dari laba jurnal (murni). Semua nominal number.
 * jurnal = { pendapatanBersih, bebanPokok, bebanOperasional, labaBersih, baris: [{ akunKode, nilai (saldo normal), kelompok, peran }] }  — baris = SEMUA baris beban pokok periode
 * operasional = { bahanDiakui (HPP operasional order diakui TANPA pergerakan yang dipakai nilai jurnalnya), susutBelumDijurnal, orderDiakui, orderLengkap, unitBelumDiketahui }
 * Kontrol wajib cocok: laba jurnal + Σ baris dibalik − bahan operasional − susut belum dijurnal = pendapatan − HPP manajemen − beban operasional; dan Σ semua baris = beban pokok jurnal.
 */
export function hasilManajemen({ jurnal, operasional }) {
  const K = KELOMPOK_JURNAL; const per = new Map(Object.keys(K).map((k) => [k, { nilai: 0, baris: 0, akun: new Map() }]));
  let upah = 0; let overhead = 0; let tetapLain = 0; let perluKlas = 0;
  for (const b of jurnal.baris ?? []) {
    const g = per.get(b.kelompok); if (!g) throw new Error(`kelompok jurnal tidak dikenal: ${b.kelompok}`);
    g.nilai += Number(b.nilai); g.baris += 1; g.akun.set(b.akunKode, r2((g.akun.get(b.akunKode) ?? 0) + Number(b.nilai)));
    if (b.kelompok === K.BEBAN_TETAP_DIHITUNG.key) { if (b.peran === "UPAH") upah += Number(b.nilai); else if (b.peran === "OVERHEAD") overhead += Number(b.nilai); else tetapLain += Number(b.nilai); }
    if (b.kelompok === K.PERLU_KLASIFIKASI.key) perluKlas += Number(b.nilai);
  }
  const kelompok = Object.values(K).map((k) => { const g = per.get(k.key); return { key: k.key, label: k.label, teks: k.teks, dibalik: k.dibalik, nilai: r2(g.nilai), baris: g.baris, akun: [...g.akun.entries()].map(([kode, nilai]) => ({ kode, nilai })) }; });
  const v = (key) => r2(per.get(key).nilai);
  const dibalik = r2(kelompok.filter((k) => k.dibalik).reduce((a, k) => a + k.nilai, 0));
  const pendapatan = r2(jurnal.pendapatanBersih); const bebanOps = r2(jurnal.bebanOperasional); const labaJurnal = r2(jurnal.labaBersih);
  const bahan = r2(operasional.bahanDiakui ?? 0); const susutBaru = r2(operasional.susutBelumDijurnal ?? 0);
  const hppManajemen = r2(bahan + susutBaru + upah + overhead + tetapLain + perluKlas);
  const labaKotor = r2(pendapatan - hppManajemen); const laba = r2(labaKotor - bebanOps);
  const lewatJembatan = r2(labaJurnal + dibalik - bahan - susutBaru);
  const totalBaris = r2(kelompok.reduce((a, k) => a + k.nilai, 0));
  const kontrol = { lewatJembatan, langsung: laba, selisih: r2(lewatJembatan - laba), bebanPokokJurnal: r2(jurnal.bebanPokok), totalBarisDiklasifikasi: totalBaris, selisihKlasifikasi: r2(totalBaris - r2(jurnal.bebanPokok)) };
  kontrol.cocok = Math.abs(kontrol.selisih) < 0.005 && Math.abs(kontrol.selisihKlasifikasi) < 0.005;
  const lengkap = operasional.orderDiakui > 0 && operasional.orderLengkap === operasional.orderDiakui;
  return {
    status: lengkap ? "LENGKAP" : "SEMENTARA", final: false,
    teksStatus: lengkap ? "HPP bahan seluruh order berpendapatan diakui sudah lengkap. Tetap hasil manajemen (bukan jurnal) sampai Finance membukukan." : `SEMENTARA — HPP bahan baru lengkap untuk ${operasional.orderLengkap} dari ${operasional.orderDiakui} order berpendapatan diakui. Biaya ${operasional.unitBelumDiketahui} unit belum diketahui (tidak dihitung Rp0), jadi hasil ini lebih tinggi dari kenyataan.`,
    baris: [
      { kunci: "pendapatan", label: "Pendapatan bersih (jurnal)", nilai: pendapatan, sumber: "JURNAL" },
      { kunci: "bahan", label: "Bahan — HPP operasional order berpendapatan diakui (bagian yang diketahui)", nilai: bahan, sumber: "OPERASIONAL", belumDiketahuiUnit: operasional.unitBelumDiketahui },
      { kunci: "susut_belum_dijurnal", label: "Susut unit tercatat Gudang yang belum dijurnal (operasional)", nilai: susutBaru, sumber: "OPERASIONAL" },
      { kunci: "upah", label: "Upah produksi (jurnal 5-1200)", nilai: r2(upah), sumber: "JURNAL" },
      { kunci: "overhead", label: "Overhead produksi (jurnal 5-1300)", nilai: r2(overhead), sumber: "JURNAL" },
      { kunci: "beban_pokok_lain", label: "Beban pokok lain yang tetap dihitung (jurnal)", nilai: r2(tetapLain), sumber: "JURNAL" },
      { kunci: "perlu_klasifikasi", label: "Tetap dihitung — perlu keputusan klasifikasi (jurnal)", nilai: r2(perluKlas), sumber: "JURNAL" },
      { kunci: "hpp", label: "HPP manajemen", nilai: hppManajemen, sumber: "GABUNGAN" },
      { kunci: "laba_kotor", label: "Laba kotor manajemen", nilai: labaKotor, sumber: "GABUNGAN" },
      { kunci: "beban_operasional", label: "Beban operasional (jurnal)", nilai: bebanOps, sumber: "JURNAL" },
      { kunci: "laba", label: "Hasil manajemen sementara", nilai: laba, sumber: "GABUNGAN" },
    ],
    jembatan: [
      { kunci: "laba_jurnal", label: "Laba bersih menurut jurnal", nilai: labaJurnal },
      { kunci: "balik_terwakili", label: `+ ${K.TERWAKILI_HPP_OPERASIONAL.label} (dibalik)`, nilai: v("TERWAKILI_HPP_OPERASIONAL") },
      { kunci: "balik_belum_diakui", label: `+ ${K.ORDER_BELUM_DIAKUI.label} (dibalik)`, nilai: v("ORDER_BELUM_DIAKUI") },
      { kunci: "balik_saldo_lama", label: `+ ${K.KOREKSI_SALDO_LAMA.label} (dibalik)`, nilai: v("KOREKSI_SALDO_LAMA") },
      { kunci: "kurang_bahan", label: "− HPP operasional bahan order diakui", nilai: -bahan },
      { kunci: "kurang_susut", label: "− Susut unit belum dijurnal", nilai: -susutBaru },
      { kunci: "hasil", label: "= Hasil manajemen sementara", nilai: lewatJembatan },
    ],
    kelompok, kontrol,
  };
}
