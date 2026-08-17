// Mention grup WhatsApp: dari LID mentah jadi nama orang.
//
// MASALAH YANG DIPECAHKAN. WhatsApp menyimpan mention DI DALAM TEKS pesan
// sebagai "@<id>", dan di grup id itu berbentuk LID — angka internal WhatsApp
// (mis. "@165811675242551"), bukan nomor telepon dan sama sekali tidak berarti
// bagi manusia. Contoh nyata dari produksi:
//
//   "jatinangor itu bukannya udh lewat bandung ya, pak? @11832752382105 🙏"
//
// Aplikasi WhatsApp asli menampilkan nama karena ia punya daftar anggota grup
// untuk menerjemahkannya. CRM & SANO Messenger tidak pernah punya daftar itu,
// jadi LID-nya tampil apa adanya.
//
// Peta nama datang dari GET /conversations/:id/participants (lihat
// backend/src/routes/conversations.js) — anggota grup dari WAHA, namanya
// dicocokkan lewat nomor telepon ke tabel Customer.
//
// Substitusi dilakukan SEBELUM parseWaFormatting() supaya format *tebal* dkk
// tetap diproses parser yang sama seperti pesan lain — sengaja TIDAK
// menambah pola baru ke parser itu, karena parser tersebut dipakai bersama
// web CRM dan setiap perubahan di sana berlaku ke SEMUA jenis pesan.

// LID panjangnya 8-20+ digit. Batas bawah 8 digit mencegah "@2024" (tahun,
// nominal harga, nomor order) ikut dianggap mention lalu berubah/hilang.
const POLA_MENTION = /@(\d{8,})/g;

// Nomor telepon jadi bentuk yang enak dibaca saat namanya TIDAK ketemu:
// "6287781861218" -> "0878-7861-218". Jauh lebih berguna daripada LID, dan
// sales sering mengenali orang dari nomornya.
// Nama orang bisa memuat karakter yang bermakna khusus di regex — "Budi (CS)",
// "A+ Service", "Rp. Andi". Tanpa di-escape, nama seperti itu membentuk pola
// tidak sah (regex error saat kirim) atau cocok ke tempat yang salah.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Diekspor juga (bukan cuma dipakai internal di sini) — dipakai layar Info
// Grup (GroupInfoContent.js) untuk menampilkan nomor anggota yang belum
// punya nama di CRM, konsisten dengan format yang sama dipakai di sini.
export function formatNomor(phone) {
  if (!phone) return null;
  const lokal = phone.startsWith("62") ? "0" + phone.slice(2) : phone;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

/**
 * Bangun peta pencarian dari daftar anggota grup.
 *
 * Di-index dengan LID DAN nomor telepon — karena mention di teks bisa datang
 * dalam dua bentuk: LID (umum di grup) atau nomor telepon biasa (pesan lama
 * / chat pribadi). Menangani cuma salah satunya membuat sebagian mention
 * tetap tampil mentah tanpa alasan yang jelas bagi pengguna.
 */
export function buatPetaMention(participants) {
  const peta = new Map();
  for (const p of participants || []) {
    const label = p.name || formatNomor(p.phone);
    if (!label) continue;
    if (p.lid) peta.set(p.lid, label);
    if (p.phone) peta.set(p.phone, label);
  }
  return peta;
}

/**
 * Ganti "@<lid>" jadi "@<nama>" di dalam teks pesan.
 *
 * ID yang TIDAK ada di peta dibiarkan apa adanya — lebih baik menampilkan
 * angka yang jujur daripada menebak nama yang salah (mis. anggota yang sudah
 * keluar dari grup, yang memang tidak ada lagi di daftar peserta).
 *
 * @param {string} text isi pesan mentah
 * @param {Map<string,string>} peta hasil buatPetaMention()
 * @returns {string}
 */
export function gantiMention(text, peta) {
  if (!text || !peta || peta.size === 0) return text;
  return String(text).replace(POLA_MENTION, (utuh, id) => {
    const nama = peta.get(id);
    return nama ? `@${nama}` : utuh;
  });
}

/**
 * Ambil daftar ID yang di-mention dari teks — dipakai saat MENGIRIM, supaya
 * backend bisa meneruskan daftar mentions ke WhatsApp. Tanpa daftar itu
 * WhatsApp menampilkan teksnya sebagai tulisan biasa: orangnya tidak
 * tertandai dan TIDAK dinotifikasi (mention yang cuma terlihat benar).
 */
export function ambilMention(text) {
  if (!text) return [];
  return [...String(text).matchAll(POLA_MENTION)].map((m) => m[1]);
}

/**
 * Ubah "@Nama" yang terlihat di composer jadi "@nomor" yang dituntut WhatsApp.
 *
 * KENAPA DUA BENTUK. WhatsApp mengharuskan TEKS terkirim memuat "@<nomor>"
 * plus daftar mentions berisi nomor yang sama; aplikasi penerimalah yang
 * menampilkannya sebagai nama. Tapi memaksa sales melihat "@6285710834203"
 * saat mengetik itu buruk — jadi composer menampilkan nama, dan konversi ke
 * nomor terjadi tepat sebelum kirim (di sini).
 *
 * Kalau sales mengubah teks namanya sampai tidak cocok lagi, mention itu
 * SENGAJA turun jadi tulisan biasa — tidak ada tebakan "nama terdekat",
 * karena salah menandai orang di grup kerja lebih buruk daripada tidak
 * menandai siapa pun.
 *
 * @param {string} text isi composer (memakai nama)
 * @param {Array<{name:string, phone:string}>} picks yang dipilih dari daftar @
 * @returns {{text: string, mentions: string[]}}
 */
export function siapkanMentionUntukKirim(text, picks) {
  let hasil = String(text || "");
  const mentions = [];
  // Nama terpanjang lebih dulu — kalau ada "Novi" dan "Novia", mengganti
  // "Novi" duluan akan merusak "@Novia" jadi "@<nomorNovi>a".
  const urut = [...(picks || [])].filter((p) => p.name && p.phone)
    .sort((a, b) => b.name.length - a.name.length);
  for (const p of urut) {
    // ⚠️ WAJIB pakai batas kata, BUKAN cocok-substring biasa. Versi pertama
    // memakai split/join dan itu BUG NYATA (ketangkap tes): "@Jrr" memuat
    // "@Jr" sebagai substring, jadi hasilnya "@6285692828241r" — nomor
    // rusak yang menandai ORANG YANG SALAH, tepat kegagalan yang paling
    // ingin dihindari di grup kerja. Lookahead di bawah menuntut karakter
    // setelah nama bukan huruf/angka (atau akhir teks).
    const pola = new RegExp(`@${escapeRegex(p.name)}(?![\\p{L}\\p{N}])`, "gu");
    if (!pola.test(hasil)) continue; // sudah dihapus/diedit sales
    hasil = hasil.replace(pola, `@${p.phone}`);
    if (!mentions.includes(p.phone)) mentions.push(p.phone);
  }
  return { text: hasil, mentions };
}
