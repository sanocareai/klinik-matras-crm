// Daftar Inbox di HP bisa basi: socket Android sering putus saat app di background / jaringan berpindah, dan event yang terlewat tidak pernah
// dikirim ulang. Bug 7 Okt 2026 (laporan Rahmi Kusmastuti): balasan 16:26 sudah terkirim, tapi Inbox di HP Owner masih menampilkan pesan
// pelanggan 13:31 → chat tampak belum dibalas. Modul ini memuat ulang daftar (debounce) saat: app kembali aktif, socket tersambung ulang,
// atau ada update percakapan yang pesan terakhirnya belum kita punya. Murni (timer & invalidasi diinjeksi) supaya bisa dites.

export const JEDA_MUAT_ULANG_MS = 1500;
// createdAt pesan vs lastMessageAt percakapan untuk pesan YANG SAMA hanya beda puluhan milidetik; lebih dari ini = ada pesan yang lebih baru.
export const TOLERANSI_MS = 500;

/** True bila data percakapan di HP belum memuat pesan terakhirnya (preview/ikon centang di daftar akan basi). */
export function pesanTerakhirBasi(conv) {
  if (!conv?.lastMessageAt) return false;
  const pesan = conv.messages?.[0];
  if (!pesan?.createdAt) return true;
  return new Date(conv.lastMessageAt).getTime() - new Date(pesan.createdAt).getTime() > TOLERANSI_MS;
}

/** Pemicu muat-ulang ber-debounce: banyak permintaan beruntun = satu muat ulang. */
export function buatPemulih({ muatUlang, setTimer = setTimeout, clearTimer = clearTimeout, jeda = JEDA_MUAT_ULANG_MS }) {
  let timer = null;
  return {
    minta() {
      if (timer) return;
      timer = setTimer(() => { timer = null; muatUlang(); }, jeda);
    },
    batal() {
      if (timer) { clearTimer(timer); timer = null; }
    },
  };
}
