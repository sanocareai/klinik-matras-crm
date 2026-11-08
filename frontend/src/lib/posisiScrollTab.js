// POSISI SCROLL PER TAB DALAM-APP — murni (tanpa React/DOM) supaya perilakunya bisa diuji `node --test`.
//
// Semua tab yang terbuka dirender sekaligus dan yang tidak aktif disembunyikan `hidden` (display:none; lihat TabbedContent.jsx). Status React (isian, data) tetap hidup, tetapi
// POSISI SCROLL tidak: penggulir utama `.page-body` dipakai bersama semua tab, dan elemen yang disembunyikan display:none kehilangan scrollTop-nya. Penyimpan ini mencatat
//   • `utama`  : scrollTop penggulir bersama saat tab ditinggalkan, dan
//   • `dalam`  : scrollTop panel gulir DI DALAM halaman (mis. daftar percakapan Inbox) — elemen → posisi,
// lalu mengembalikannya saat tab itu aktif lagi. Tab yang belum pernah dicatat kembali ke atas (0), bukan mewarisi posisi tab sebelumnya.

export function buatPenyimpanScroll() {
  const per = new Map(); // idTab → { utama: number, dalam: Map<elemen, number> }
  const ambilAtauBuat = (id) => {
    let p = per.get(id);
    if (!p) { p = { utama: 0, dalam: new Map() }; per.set(id, p); }
    return p;
  };
  return {
    catatUtama(id, top) { if (id != null && Number.isFinite(top)) ambilAtauBuat(id).utama = Math.max(0, top); },
    catatDalam(id, elemen, top) { if (id != null && elemen && Number.isFinite(top)) ambilAtauBuat(id).dalam.set(elemen, Math.max(0, top)); },
    /** Posisi yang harus dipulihkan untuk tab `id`. Elemen yang sudah lepas dari dokumen dibuang. */
    ambil(id) {
      const p = per.get(id);
      if (!p) return { utama: 0, dalam: [] };
      const dalam = [];
      for (const [el, top] of p.dalam) { if (el.isConnected === false) p.dalam.delete(el); else dalam.push([el, top]); }
      return { utama: p.utama, dalam };
    },
    /** Buang catatan tab yang sudah ditutup. */
    sisakan(idAktif) { const ada = new Set(idAktif); for (const id of [...per.keys()]) if (!ada.has(id)) per.delete(id); },
    ukuran: () => per.size,
  };
}

/** Terapkan posisi hasil `ambil` ke penggulir utama + panel dalam. `utama` boleh null (tidak ada kontainer). */
export function terapkanScroll(posisi, utama) {
  if (utama) utama.scrollTop = posisi.utama;
  for (const [el, top] of posisi.dalam) el.scrollTop = top;
}
