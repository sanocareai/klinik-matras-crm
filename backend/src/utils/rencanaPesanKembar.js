// Merencanakan pembersihan pesan keluar KEMBAR (satu pesan WA tersimpan dua baris) — dasar scripts/bersihkan-pesan-kembar.js.
//
// Penyebab (diperbaiki di utils/cariPesanSudahAda.js): gema webhook WAHA membawa id berbasis LID, jadi tidak dikenali sebagai pesan yang
// sudah disimpan CRM. Dua baris berbagi ID pesan inti (bagian tengah externalId) di percakapan yang sama.
//
// Baris yang DIPERTAHANKAN: punya pengirim (sentById) > centang tertinggi > punya media > paling awal dibuat. Sisanya dihapus; ack tertinggi
// dan media yang hilang digabung ke baris yang dipertahankan. Grup yang waktunya berjauhan (> BATAS_DETIK) dilewati, bukan ditebak.
import { idPesanInti } from "./idPesanWa.js";

export const PANJANG_MIN_ID_INTI = 16;
export const BATAS_DETIK = 120;

const t = (r) => new Date(r.createdAt).getTime();

export function rencanaPesanKembar(rows) {
  const grupMap = new Map();
  for (const r of rows) {
    const inti = idPesanInti(r.externalId);
    if (!inti || inti.length < PANJANG_MIN_ID_INTI || r.direction !== "OUTBOUND") continue;
    const key = `${r.conversationId}|${inti}`;
    if (!grupMap.has(key)) grupMap.set(key, []);
    grupMap.get(key).push(r);
  }
  const rencana = [];
  const dilewati = [];
  for (const anggota of grupMap.values()) {
    if (anggota.length < 2) continue;
    const urut = [...anggota].sort((a, b) =>
      (Number(!!b.sentById) - Number(!!a.sentById)) || ((b.ack || 0) - (a.ack || 0)) || (Number(!!b.mediaUrl) - Number(!!a.mediaUrl)) || (t(a) - t(b)) || (a.id < b.id ? -1 : 1));
    const [survivor, ...korban] = urut;
    if (korban.some((k) => Math.abs(t(k) - t(survivor)) / 1000 > BATAS_DETIK)) { dilewati.push(anggota); continue; }
    const ackMaks = Math.max(...urut.map((r) => r.ack || 0));
    const sumberMedia = survivor.mediaUrl ? null : korban.find((k) => k.mediaUrl) || null;
    rencana.push({ survivor, korban, ackBaru: ackMaks > (survivor.ack || 0) ? ackMaks : null, sumberMedia });
  }
  return { rencana, dilewati };
}
