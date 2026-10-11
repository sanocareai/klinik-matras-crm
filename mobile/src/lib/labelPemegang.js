// Label pemegang di baris daftar Inbox. Dua konsep yang SERING TERTUKAR (CLAUDE.md §20):
//   assignedTo     = yang SEDANG memegang percakapan (berpindah lewat ambil alih / transfer)
//   firstResponder = yang PERTAMA membalas (kredit historis, TIDAK PERNAH berubah)
// Bug 11 Okt 2026 (kasus Risel → Alya): daftar di HP hanya menampilkan firstResponder tanpa keterangan, jadi setelah Alya mengambil alih, baris
// tetap bertuliskan "Risel" selamanya. Web sudah memperbaikinya 23 Agustus (badge utama = pemegang sekarang); mobile tertinggal.
//
// utama  = nama pemegang SEKARANG (badge utama)
// pertama = nama pembalas pertama, HANYA bila orangnya berbeda dari pemegang (diawali "1st:" di tampilan); bila belum ada pemegang tapi ada
//           pembalas pertama, tetap ditampilkan sebagai "1st:" supaya tidak tampak seperti pemegang.
export function labelPemegang(c) {
  const pemegang = c?.assignedTo || null;
  const pertama = c?.firstResponder || null;
  return {
    utama: pemegang?.name || null,
    pertama: pertama && (!pemegang || pertama.id !== pemegang.id) ? pertama.name : null,
  };
}
