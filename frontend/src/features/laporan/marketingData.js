// Antrean pembacaan laporan atribusi untuk tab Marketing. Server menjaga SATU perhitungan laporan atribusi sekaligus per proses (penjagaLaporan.js) dan menolak permintaan paralel dengan 429 SEDANG_DIHITUNG.
// Karena Marketing membaca beberapa laporan (sumber, campaign Meta), semuanya dijalankan BERURUTAN lewat satu rantai dan dicoba ulang singkat bila tetap 429 (permintaan dari sesi/pengguna lain).
let rantai = Promise.resolve();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

export const galatDibatalkan = () => Object.assign(new Error("Permintaan dibatalkan (periode/filter berganti)."), { dibatalkan: true });
export const COBA_BAWAAN = 4;   // total percobaan (1 awal + 3 ulang) → jeda 1,2 s + 2,4 s + 3,6 s; setelah itu galat 429 ditampilkan, tidak ada loop tanpa batas

/**
 * Jalankan `kerja` setelah pekerjaan sebelumnya selesai. `batal()` (opsional) = true bila hasilnya sudah tidak diperlukan (periode/filter berganti):
 * pekerjaan basi TIDAK dijalankan/diulang, sehingga antrean tidak menumpuk dan permintaan terbaru tidak menunggu yang basi.
 */
export function berurutan(kerja, { coba = COBA_BAWAAN, jeda = 1200, batal = null } = {}) {
  const jalankan = async () => {
    let terakhir;
    for (let i = 0; i < coba; i++) {
      if (batal?.()) throw galatDibatalkan();
      try { return await kerja(); }
      catch (e) {
        terakhir = e;
        if (e?.status !== 429 || i === coba - 1) throw e;
        await tidur(jeda * (i + 1));
      }
    }
    throw terakhir;
  };
  const p = rantai.then(jalankan, jalankan);
  rantai = p.catch(() => {});
  return p;
}

export const pesanGalat = (e, bawaan) => (e?.status === 429 ? "Laporan sedang dihitung untuk permintaan lain — coba lagi sebentar." : (e?.message || bawaan));

/** Salin teks ke clipboard; true bila berhasil (fallback textarea untuk konteks tanpa Clipboard API). */
export async function salinTeks(teks) {
  try { await navigator.clipboard.writeText(String(teks)); return true; }
  catch {
    try {
      const ta = document.createElement("textarea"); ta.value = String(teks); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}
