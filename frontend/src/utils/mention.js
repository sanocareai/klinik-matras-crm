// Mention grup WhatsApp: dari LID mentah jadi nama orang.
//
// PORT dari mobile/src/utils/mention.js (D-031 lanjutan, 21 Agustus 2026) —
// web sebelumnya menampilkan mention mentah "@201086224863438" di bubble
// grup, sementara mobile sudah punya resolusi LID→nama sejak awal. Logikanya
// murni JS (tanpa dependency React Native), jadi di-port apa adanya —
// JANGAN biarkan dua definisi ini menyimpang, sinkronkan kalau salah satu
// diubah.
//
// MASALAH YANG DIPECAHKAN. WhatsApp menyimpan mention DI DALAM TEKS pesan
// sebagai "@<id>", dan di grup id itu berbentuk LID — angka internal WhatsApp
// (mis. "@165811675242551"), bukan nomor telepon dan sama sekali tidak berarti
// bagi manusia.
//
// Peta nama datang dari GET /conversations/:id/participants (lihat
// backend/src/routes/conversations.js) — anggota grup dari WAHA, namanya
// dicocokkan lewat nomor telepon ke tabel Customer.
//
// Substitusi dilakukan SEBELUM parseWaFormatting() supaya format *tebal* dkk
// tetap diproses parser yang sama seperti pesan lain.

// LID panjangnya 8-20+ digit. Batas bawah 8 digit mencegah "@2024" (tahun,
// nominal harga, nomor order) ikut dianggap mention lalu berubah/hilang.
const POLA_MENTION = /@(\d{8,})/g;

// Nomor telepon jadi bentuk yang enak dibaca saat namanya TIDAK ketemu:
// "6287781861218" -> "0878-7861-218".
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatNomor(phone) {
  if (!phone) return null;
  const lokal = phone.startsWith("62") ? "0" + phone.slice(2) : phone;
  return lokal.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}

/**
 * Bangun peta pencarian dari daftar anggota grup.
 *
 * Di-index dengan LID DAN nomor telepon — mention di teks bisa datang
 * dalam dua bentuk: LID (umum di grup) atau nomor telepon biasa (pesan lama
 * / chat pribadi).
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
 * angka yang jujur daripada menebak nama yang salah.
 */
export function gantiMention(text, peta) {
  if (!text || !peta || peta.size === 0) return text;
  return String(text).replace(POLA_MENTION, (utuh, id) => {
    const nama = peta.get(id);
    return nama ? `@${nama}` : utuh;
  });
}

/**
 * Ambil daftar ID yang di-mention dari teks — dipakai saat MENGIRIM.
 */
export function ambilMention(text) {
  if (!text) return [];
  return [...String(text).matchAll(POLA_MENTION)].map((m) => m[1]);
}

/**
 * Ubah "@Nama" yang terlihat di composer jadi "@nomor" yang dituntut WhatsApp.
 */
export function siapkanMentionUntukKirim(text, picks) {
  let hasil = String(text || "");
  const mentions = [];
  const urut = [...(picks || [])].filter((p) => p.name && p.phone)
    .sort((a, b) => b.name.length - a.name.length);
  for (const p of urut) {
    const pola = new RegExp(`@${escapeRegex(p.name)}(?![\\p{L}\\p{N}])`, "gu");
    if (!pola.test(hasil)) continue;
    hasil = hasil.replace(pola, `@${p.phone}`);
    if (!mentions.includes(p.phone)) mentions.push(p.phone);
  }
  return { text: hasil, mentions };
}
