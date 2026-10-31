// Jalankan sebuah pekerjaan async SEKALI per kunci, walau dipanggil bersamaan.
//
// Latar belakang (audit uploads 21 Okt 2026): WAHA mengirim 2 event untuk pesan
// yang sama ("message" + "message.any") nyaris bersamaan. Pengecekan idempotensi
// di awal handler webhook (findUnique externalId) bersifat cek-lalu-simpan, jadi
// kedua event lolos sebelum salah satunya sempat INSERT, lalu keduanya mengunduh
// dan menulis file media dengan nama acak berbeda. Database hanya menerima satu
// pesan (externalId unik) → file yang lain jadi yatim. Hasil audit: 26.542 file
// (17 GB) salinan byte-persis dari file yang dirujuk database.
//
// Perilaku:
//   - Pemanggil kedua (dan seterusnya) dengan kunci yang sama selama pekerjaan
//     masih berjalan MENUNGGU hasil yang sama, tidak menjalankan ulang `fn`.
//   - Hasil yang berhasil (truthy) diingat `ttlMs` sesudah selesai, menutup
//     celah "event kedua tiba sesudah unduhan selesai tapi sebelum INSERT".
//   - Hasil gagal (null/undefined/false) TIDAK diingat → pemanggil berikutnya
//     boleh mencoba lagi (mis. forward yang mengunduh ulang media yang gagal).
//   - Penolakan (reject) dibagikan ke semua yang menunggu, tidak diingat.
//   - Kunci kosong tidak pernah di-dedupe (tidak ada identitas untuk dicocokkan).
//
// Memori dibatasi: entri kedaluwarsa dibuang, dan paling banyak `maksEntri`
// hasil yang diingat.
export function buatSekaliPerKunci({ ttlMs = 60_000, maksEntri = 500, sekarang = Date.now } = {}) {
  const berjalan = new Map(); // kunci -> Promise yang sedang berjalan
  const selesai = new Map();  // kunci -> { nilai, waktu } hasil berhasil terakhir

  function bersihkan() {
    const t = sekarang();
    for (const [k, v] of selesai) {
      if (t - v.waktu >= ttlMs) selesai.delete(k);
    }
    while (selesai.size > maksEntri) {
      selesai.delete(selesai.keys().next().value);
    }
  }

  return function jalankanSekali(kunci, fn) {
    if (kunci === null || kunci === undefined || kunci === "") {
      return Promise.resolve().then(fn);
    }

    const sudah = selesai.get(kunci);
    if (sudah) {
      if (sekarang() - sudah.waktu < ttlMs) return Promise.resolve(sudah.nilai);
      selesai.delete(kunci);
    }

    const sedang = berjalan.get(kunci);
    if (sedang) return sedang;

    const p = Promise.resolve().then(fn).then((nilai) => {
      if (nilai) {
        selesai.set(kunci, { nilai, waktu: sekarang() });
        bersihkan();
      }
      return nilai;
    });
    berjalan.set(kunci, p);
    const lepas = () => { if (berjalan.get(kunci) === p) berjalan.delete(kunci); };
    p.then(lepas, lepas);
    return p;
  };
}
