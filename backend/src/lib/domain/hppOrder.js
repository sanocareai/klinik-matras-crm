// HPP PER ORDER — aturan MURNI (tanpa DB; diuji node --test). Dipakai antrean PIC, laporan HPP per order, dan jalur biaya tanpa stok.
//
// PRINSIP:
//   1. "Ada pemakaian" ≠ "HPP lengkap". Unit LENGKAP hanya bila: seluruh baris biayanya bernilai, tidak ada catatan/biaya yang masih tertahan, DAN PIC sudah mengonfirmasi pemakaian lengkap
//      dengan sidik baris yang SAMA dengan saat ini (baris berubah sesudah konfirmasi → BASI). Pengecualian: pernyataan "tanpa bahan baru" yang sudah ada (unit_material_declarations) tanpa baris bahan.
//   2. Biaya kosong tetap BELUM DIKETAHUI (null), tidak pernah Rp0.
//   3. Jalur pencatatan ditentukan TANGGAL PEMAKAIAN terhadap tanggal SO yang ditautkan ke bahan: sesudah SO → pengeluaran stok resmi; pada/sebelum SO → biaya tanpa stok (stok tidak dikurangi lagi).
//   4. Hasil manajemen sementara mengganti beban BAHAN jurnal dengan HPP operasional order yang pendapatannya diakui; upah, overhead, dan beban operasional tetap dari jurnal. Akun bahan jurnal
//      (5-1100/5-1150/5-1900/5-1950/5-1960) DIKELUARKAN dari hasil manajemen agar tidak terhitung dua kali, dan ditampilkan terpisah.
import crypto from "node:crypto";

export const JALUR = Object.freeze({
  STOK: Object.freeze({ key: "STOK", label: "Pengeluaran bahan resmi", teks: "Tanggal pemakaian SESUDAH tanggal SO bahan (atau bahan tanpa tautan SO): catat sebagai pengeluaran stok resmi lewat pembetulan unit — hanya bila belum tercatat." }),
  BIAYA_TANPA_STOK: Object.freeze({ key: "BIAYA_TANPA_STOK", label: "Biaya per order tanpa stok", teks: "Tanggal pemakaian PADA/SEBELUM tanggal SO yang ditautkan: hitung fisik SO sudah mencakup pemakaian ini. Catat biaya per order TANPA mengurangi stok lagi; berlaku sesudah disetujui orang lain." }),
});

/** Jalur untuk satu pemakaian. tanggal & soTanggal = YYYY-MM-DD (WIB). soTanggal null = bahan tanpa tautan SO. */
export function tentukanJalur({ tanggal, soTanggal = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tanggal ?? ""))) throw new Error("tanggal pemakaian wajib YYYY-MM-DD");
  return soTanggal && tanggal <= soTanggal ? JALUR.BIAYA_TANPA_STOK : JALUR.STOK;
}

export const STATUS_UNIT = Object.freeze({
  BELUM_ADA_PEMAKAIAN: Object.freeze({ key: "BELUM_ADA_PEMAKAIAN", label: "Belum ada pemakaian", tone: "red", lengkap: false, langkah: "Catat pemakaian bahan (atau nyatakan tanpa bahan baru bila memang tidak ada)." }),
  BELUM_LENGKAP: Object.freeze({ key: "BELUM_LENGKAP", label: "Ada pemakaian, belum lengkap", tone: "orange", lengkap: false, langkah: "Lengkapi harga/catatan yang tertahan, lalu konfirmasi pemakaian lengkap." }),
  MENUNGGU_PERSETUJUAN: Object.freeze({ key: "MENUNGGU_PERSETUJUAN", label: "Menunggu persetujuan biaya", tone: "amber", lengkap: false, langkah: "Biaya tanpa stok menunggu persetujuan Finance/Owner (orang lain dari pengaju)." }),
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
 * @param {Array} f.baris            baris biaya (pergerakan stok unit bertipe biaya + biaya tanpa stok DISETUJUI): { id, sumber, status ('DIBEKUKAN'|'TANPA_HARGA'|'BELUM_DIBEKUKAN'|'GAGAL'), subtotal }
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

// Akun beban pokok jurnal yang berasal dari BAHAN (digantikan HPP operasional pada hasil manajemen; tidak boleh dijumlah dua kali).
export const AKUN_BAHAN_JURNAL = Object.freeze({
  "5-1100": "Pemakaian bahan baku (perpetual)", "5-1150": "Pembelian bahan baku — input manual", "5-1900": "Susut & bahan rusak",
  "5-1950": "Selisih harga pembelian", "5-1960": "Selisih stok opname",
});
export const AKUN_UPAH = "5-1200"; export const AKUN_OVERHEAD = "5-1300";

/**
 * Hasil manajemen sementara (murni). Semua nominal number (2 desimal).
 * jurnal = { pendapatanBersih, akunBebanPokok: [{kode,nama,nilai}], bebanOperasional }
 * operasional = { bahanDiakui (Σ nilai diketahui order berpendapatan diakui), susutPeriode, orderDiakui, orderLengkap, unitDiakui, unitLengkap, unitBelumDiketahui }
 */
export function hasilManajemen({ jurnal, operasional }) {
  const bahanJurnal = []; let upah = 0; let overhead = 0; const lain = [];
  for (const a of jurnal.akunBebanPokok ?? []) {
    if (AKUN_BAHAN_JURNAL[a.kode]) bahanJurnal.push({ kode: a.kode, nama: a.nama ?? AKUN_BAHAN_JURNAL[a.kode], nilai: r2(a.nilai) });
    else if (a.kode === AKUN_UPAH) upah += Number(a.nilai);
    else if (a.kode === AKUN_OVERHEAD) overhead += Number(a.nilai);
    else lain.push({ kode: a.kode, nama: a.nama, nilai: r2(a.nilai) });
  }
  const lainTotal = r2(lain.reduce((s, a) => s + a.nilai, 0));
  const bahan = r2(operasional.bahanDiakui ?? 0); const susut = r2(operasional.susutPeriode ?? 0);
  const pendapatan = r2(jurnal.pendapatanBersih); const bebanOps = r2(jurnal.bebanOperasional);
  const hppManajemen = r2(bahan + susut + upah + overhead + lainTotal);
  const labaKotor = r2(pendapatan - hppManajemen); const laba = r2(labaKotor - bebanOps);
  const lengkap = operasional.orderDiakui > 0 && operasional.orderLengkap === operasional.orderDiakui;
  return {
    status: lengkap ? "LENGKAP" : "SEMENTARA", final: false,
    teksStatus: lengkap ? "HPP bahan seluruh order berpendapatan diakui sudah lengkap. Tetap hasil manajemen (bukan jurnal) sampai Finance membukukan." : `SEMENTARA — HPP bahan baru lengkap untuk ${operasional.orderLengkap} dari ${operasional.orderDiakui} order berpendapatan diakui. Biaya ${operasional.unitBelumDiketahui} unit belum diketahui (tidak dihitung Rp0), jadi laba ini lebih tinggi dari kenyataan.`,
    baris: [
      { kunci: "pendapatan", label: "Pendapatan bersih (jurnal)", nilai: pendapatan, sumber: "JURNAL" },
      { kunci: "bahan", label: "Bahan — HPP operasional order berpendapatan diakui (bagian yang diketahui)", nilai: bahan, sumber: "OPERASIONAL", belumDiketahuiUnit: operasional.unitBelumDiketahui },
      { kunci: "susut", label: "Susut bahan (operasional, tanggal pemakaian dalam periode)", nilai: susut, sumber: "OPERASIONAL" },
      { kunci: "upah", label: "Upah produksi (jurnal 5-1200)", nilai: r2(upah), sumber: "JURNAL" },
      { kunci: "overhead", label: "Overhead produksi (jurnal 5-1300)", nilai: r2(overhead), sumber: "JURNAL" },
      ...(lain.length ? [{ kunci: "beban_pokok_lain", label: "Beban pokok lain (jurnal)", nilai: lainTotal, sumber: "JURNAL", akun: lain }] : []),
      { kunci: "hpp", label: "HPP manajemen", nilai: hppManajemen, sumber: "GABUNGAN" },
      { kunci: "laba_kotor", label: "Laba kotor manajemen", nilai: labaKotor, sumber: "GABUNGAN" },
      { kunci: "beban_operasional", label: "Beban operasional (jurnal)", nilai: bebanOps, sumber: "JURNAL" },
      { kunci: "laba", label: "Hasil manajemen sementara", nilai: laba, sumber: "GABUNGAN" },
    ],
    dikeluarkan: { akun: bahanJurnal, total: r2(bahanJurnal.reduce((s, a) => s + a.nilai, 0)), teks: "Beban bahan menurut jurnal TIDAK dijumlahkan di hasil manajemen (diganti HPP operasional per order) agar tidak terhitung dua kali. Selisih stok opname dan selisih harga = rekonsiliasi saldo lama, paket terpisah; tidak dibebankan ke periode ini." },
  };
}
