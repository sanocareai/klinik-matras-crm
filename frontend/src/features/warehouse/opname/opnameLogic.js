// Logika murni halaman kerja Stock Opname (sesi model 2) — diuji `node --test`, tanpa DOM/API.
// ATURAN INTI: kolom KOSONG = belum dihitung; NOL hanya bila petugas mengetik 0 secara eksplisit. Tidak pernah diisi dari saldo sistem.

export const MODE_LABEL = Object.freeze({ FULL: "Opname penuh", GROUP: "Per kelompok", ITEMS: "Cycle Count" });
export const MODE_DESKRIPSI = Object.freeze({
  FULL: "Satu kali pilih: seluruh bahan aktif masuk sesi. Untuk opname gudang menyeluruh.",
  GROUP: "Pilih satu atau beberapa kelompok bahan (mis. Busa dan Kain) sekaligus.",
  ITEMS: "Cari dan centang bahan tertentu. Untuk hitungan kecil (maksimal 50 bahan).",
});
export const TAB = Object.freeze([
  { kunci: "belum", label: "Belum dihitung" }, { kunci: "sudah", label: "Sudah dihitung" }, { kunci: "periksa", label: "Perlu diperiksa" }, { kunci: "keluar", label: "Dikeluarkan" },
]);

/** "" → { kosong: true }; "12,5" / "12.5" / "0" → { nilai }; selain itu → { galat }. Negatif ditolak. */
export function parseJumlah(teks) {
  const t = String(teks ?? "").trim();
  if (t === "") return { kosong: true };
  if (!/^\d+([.,]\d+)?$/.test(t)) return { galat: "Isi angka 0 atau lebih (mis. 12 atau 12,5)" };
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? { nilai: n } : { galat: "Angka tidak valid" };
}

export const sudahDihitung = (b) => b.counted !== null && b.counted !== undefined;

export function hitungTab(baris) {
  const aktif = baris.filter((b) => !b.excluded);
  return { belum: aktif.filter((b) => !sudahDihitung(b)).length, sudah: aktif.filter(sudahDihitung).length, periksa: aktif.filter((b) => b.perluPeriksa).length, keluar: baris.length - aktif.length };
}

/** Penyaring tab + kelompok + pencarian (kode atau nama, tanpa membedakan huruf besar/kecil). */
export function saringBaris(baris, { tab = "belum", q = "", kelompok = "" } = {}) {
  const kata = String(q).trim().toLowerCase();
  return baris.filter((b) => {
    if (tab === "keluar") { if (!b.excluded) return false; }
    else {
      if (b.excluded) return false;
      if (tab === "belum" && sudahDihitung(b)) return false;
      if (tab === "sudah" && !sudahDihitung(b)) return false;
      if (tab === "periksa" && !b.perluPeriksa) return false;
    }
    if (kelompok && b.kelompokKode !== kelompok) return false;
    return !kata || `${b.kode} ${b.nama}`.toLowerCase().includes(kata);
  });
}

/**
 * Menyusun payload simpan dari draf. draf: { [lineId]: { teks?: string, alasan?: string, ragu?: boolean } }.
 * Mengembalikan { items, galat: {lineId: pesan} }. Baris tanpa perubahan nyata tidak dikirim.
 */
export function susunItemSimpan(baris, draf) {
  const items = []; const galat = {};
  const peta = new Map(baris.map((b) => [b.id, b]));
  for (const [lineId, d] of Object.entries(draf)) {
    const b = peta.get(lineId); if (!b || b.excluded) continue;
    let counted = b.counted ?? null; let nilaiBerubah = false;
    if (d.teks !== undefined) {
      const p = parseJumlah(d.teks);
      if (p.galat) { galat[lineId] = p.galat; continue; }
      const baru = p.kosong ? null : p.nilai;
      if (baru !== counted) { counted = baru; nilaiBerubah = true; }
    }
    const raguBerubah = d.ragu !== undefined && d.ragu !== b.ditandaRagu;
    if (!nilaiBerubah && !raguBerubah) continue;
    const alasan = String(d.alasan ?? "").trim();
    if (nilaiBerubah && b.counted !== null && b.counted !== undefined && alasan.length < 3) { galat[lineId] = "Alasan koreksi wajib diisi (min. 3 karakter) karena angka sebelumnya sudah tersimpan"; continue; }
    items.push({ lineId, revision: b.revision, countedQty: counted, ...(alasan ? { alasan } : {}), ...(d.ragu !== undefined ? { perluPeriksa: d.ragu } : {}) });
  }
  return { items, galat };
}

/** Menerapkan hasil simpan dari server ke baris lokal + menyusun draf sisa/konflik. */
export function terapkanHasilSimpan(baris, draf, hasil) {
  const peta = new Map(baris.map((b) => [b.id, b]));
  const dr = { ...draf }; const konflik = {}; const galatBaris = {};
  for (const h of hasil) {
    const b = peta.get(h.lineId); if (!b) continue;
    if (h.status === "DISIMPAN") {
      peta.set(b.id, { ...b, counted: h.counted, countedAt: h.countedAt, countedBy: h.oleh ?? b.countedBy, revision: h.revision, perluPeriksa: h.perluPeriksa, ditandaRagu: dr[b.id]?.ragu ?? b.ditandaRagu, dikoreksi: h.revision >= 2 });
      delete dr[b.id];
    } else if (h.status === "TIDAK_BERUBAH") { peta.set(b.id, { ...b, revision: h.revision ?? b.revision }); delete dr[b.id]; }
    else if (h.status === "KONFLIK") konflik[b.id] = h.saatIni;
    else galatBaris[b.id] = h.pesan ?? "Ditolak";
  }
  return { baris: baris.map((b) => peta.get(b.id)), draf: dr, konflik, galatBaris };
}

/** Antrean kartu HP: id baris sesuai penyaring saat ini (dibekukan supaya urutan tidak bergeser ketika baris yang disimpan keluar dari tab). */
export const bekukanAntrean = (baris, penyaring) => saringBaris(baris, penyaring).map((b) => b.id);
export const posisiBerikutnya = (antrean, pos) => Math.min(antrean.length, pos + 1);

/** Ringkasan teks progres: "142 dari 360 bahan dihitung (39,4%)". */
export function teksProgres(p) {
  if (!p || !p.total) return "Belum ada bahan di sesi";
  return `${p.dihitung} dari ${p.total} bahan dihitung (${String(p.persen).replace(".", ",")}%)`;
}

/** Waktu singkat lokal untuk "dihitung oleh X pukul HH.MM". */
export const jamTeks = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

