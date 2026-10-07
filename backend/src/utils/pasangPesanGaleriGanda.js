// Memasangkan pesan galeri "hantu" dengan gema webhook-nya — dasar skrip scripts/bersihkan-pesan-galeri-ganda.js.
//
// Latar belakang: sebelum 1 Okt 2026, send-product / send-documentation menyimpan pesan TANPA externalId. Akibatnya (1) pesan itu macet
// di ikon jam (ack 0) selamanya, dan (2) gema webhook WAHA tidak dikenali sebagai pesan yang sama → tersimpan sebagai baris KEDUA
// (punya externalId, ack benar, tapi tanpa pengirim). Satu foto terkirim = dua gelembung di chat.
//
//   hantu = baris asli dari galeri (tanpa externalId, ack 0)   → yang DIHAPUS
//   gema  = baris dari webhook (externalId terisi, ack asli)  → yang DIPERTAHANKAN
//
// Pemasangan SENGAJA ketat — salah pasang berarti menghapus pesan yang sebenarnya tidak ganda:
//   - percakapan sama, arah keluar, jenis media sama, caption sama persis (setelah trim),
//   - selisih waktu <= BATAS_DETIK (gema datang < ~2 dtk setelah kirim; jendela 120 dtk di analisis awal salah memasangkan foto berbeda),
//   - gema BELUM punya pengirim (kalau punya, ia dikirim lewat rute lain bukan gema galeri),
//   - gema PUNYA mediaUrl (kalau unduhan media gema dulu gagal, menghapus hantu = fotonya hilang dari chat),
//   - satu-ke-satu: satu gema hanya untuk satu hantu; yang selisihnya paling kecil dipasang lebih dulu.
export const BATAS_DETIK = 5; // data nyata 7 Okt 2026: median 0,38 dtk, 99% <= 1,4 dtk

const norm = (s) => String(s ?? "").trim();

/**
 * @param {Array<{id,conversationId,content,mediaType,createdAt,direction}>} hantu
 * @param {Array<{id,conversationId,content,mediaType,createdAt,direction,externalId,sentById}>} gema
 * @returns {{pasangan: Array<{hantu, gema, selisihDetik:number}>, tanpaPasangan: Array<object>}}
 */
export function pasangkanPesanGaleri(hantu, gema, { batasDetik = BATAS_DETIK } = {}) {
  const kandidat = [];
  const gemaPerPercakapan = new Map();
  for (const g of gema) {
    if (g.direction !== "OUTBOUND" || !g.externalId || g.sentById || !g.mediaUrl) continue;
    if (!gemaPerPercakapan.has(g.conversationId)) gemaPerPercakapan.set(g.conversationId, []);
    gemaPerPercakapan.get(g.conversationId).push(g);
  }
  for (const h of hantu) {
    for (const g of gemaPerPercakapan.get(h.conversationId) || []) {
      if (g.mediaType !== h.mediaType || norm(g.content) !== norm(h.content)) continue;
      const selisih = Math.abs(new Date(g.createdAt) - new Date(h.createdAt)) / 1000;
      if (selisih <= batasDetik) kandidat.push({ hantu: h, gema: g, selisihDetik: selisih });
    }
  }
  kandidat.sort((a, b) => a.selisihDetik - b.selisihDetik || (a.hantu.id < b.hantu.id ? -1 : 1));
  const hantuTerpakai = new Set(); const gemaTerpakai = new Set(); const pasangan = [];
  for (const k of kandidat) {
    if (hantuTerpakai.has(k.hantu.id) || gemaTerpakai.has(k.gema.id)) continue;
    hantuTerpakai.add(k.hantu.id); gemaTerpakai.add(k.gema.id); pasangan.push(k);
  }
  return { pasangan, tanpaPasangan: hantu.filter((h) => !hantuTerpakai.has(h.id)) };
}
