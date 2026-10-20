// Logika murni halaman kerja Stock Opname (sesi model 2) — diuji `node --test`, tanpa DOM/API.
// ATURAN INTI 1: kolom KOSONG = belum dihitung; NOL hanya bila petugas mengetik 0 secara eksplisit. Tidak pernah diisi dari saldo sistem.
// ATURAN INTI 2 (tiga waktu): "Dihitung" (waktu pengamatan fisik) ≠ "Disimpan" (angka masuk sistem) ≠ "Diposting" (transaksi ledger). Waktu hitung yang tidak diketahui TIDAK diisi dari waktu simpan.
//   Aturan petugas: tekan "Mulai hitung" TEPAT SEBELUM menghitung barangnya (waktu dicap server). Terlanjur menghitung? Saat menyimpan, nyatakan jam hitungnya. Salah? Ubah waktu dengan alasan (tercatat).

export const MODE_LABEL = Object.freeze({ FULL: "Opname penuh", GROUP: "Per kelompok", ITEMS: "Cycle Count" });
export const MODE_DESKRIPSI = Object.freeze({
  FULL: "Satu kali pilih: semua bahan aktif yang saldonya dilacak secara fisik masuk sesi. Untuk opname gudang menyeluruh.",
  GROUP: "Pilih satu atau beberapa kelompok bahan (mis. Busa dan Kain) sekaligus.",
  ITEMS: "Cari dan centang bahan tertentu. Untuk hitungan kecil (maksimal 50 bahan).",
});
export const TAB = Object.freeze([
  { kunci: "belum", label: "Belum dihitung" }, { kunci: "sudah", label: "Sudah dihitung" }, { kunci: "waktu", label: "Tanpa waktu hitung" }, { kunci: "periksa", label: "Perlu diperiksa" }, { kunci: "keluar", label: "Dikeluarkan" },
]);
export const SUMBER_LABEL = Object.freeze({ MULAI: "Mulai hitung", DINYATAKAN: "dinyatakan petugas", DIKOREKSI: "dikoreksi" });

/** Kelas pergerakan sejak pengamatan (dari server) → label, penjelasan singkat, dan apakah boleh diputuskan massal. */
export const KELAS_PERGERAKAN = Object.freeze({
  SERENTAK: { label: "Serentak dengan hitung", ket: "Diposting tepat di saat bahan dihitung; urutannya tidak bisa dipastikan.", massal: false },
  SAAT_HITUNG: { label: "Saat dihitung", ket: "Diposting antara bahan dihitung dan angka disimpan; mungkin ikut atau tidak ikut terhitung.", massal: false },
  BERTANGGAL_MUNDUR: { label: "Bertanggal mundur", ket: "Diposting belakangan, tetapi tanggal kejadian dokumennya pada atau sebelum hari bahan dihitung; barangnya mungkin sudah ada di rak.", massal: false },
  SESUDAH_DISIMPAN: { label: "Sesudah angka disimpan", ket: "Diposting sesudah angka disimpan dan tidak bertanggal mundur.", massal: true },
});

/** "" → { kosong: true }; "12,5" / "12.5" / "0" → { nilai }; selain itu → { galat }. Negatif ditolak. */
export function parseJumlah(teks) {
  const t = String(teks ?? "").trim();
  if (t === "") return { kosong: true };
  if (!/^\d+([.,]\d+)?$/.test(t)) return { galat: "Isi angka 0 atau lebih (mis. 12 atau 12,5)" };
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? { nilai: n } : { galat: "Angka tidak valid" };
}

export const sudahDihitung = (b) => b.counted !== null && b.counted !== undefined;
/** Sudah ada angka tetapi waktu hitungnya tidak diketahui (tidak dikarang dari waktu simpan). */
export const tanpaWaktu = (b) => !b.excluded && sudahDihitung(b) && !b.observedAt;

export function hitungTab(baris) {
  const aktif = baris.filter((b) => !b.excluded);
  return { belum: aktif.filter((b) => !sudahDihitung(b)).length, sudah: aktif.filter(sudahDihitung).length, waktu: aktif.filter(tanpaWaktu).length, periksa: aktif.filter((b) => b.perluPeriksa).length, keluar: baris.length - aktif.length };
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
      if (tab === "waktu" && !tanpaWaktu(b)) return false;
      if (tab === "periksa" && !b.perluPeriksa) return false;
    }
    if (kelompok && b.kelompokKode !== kelompok) return false;
    return !kata || `${b.kode} ${b.nama}`.toLowerCase().includes(kata);
  });
}

export const WAKTU_TANPA = "TANPA"; // pilihan petugas: simpan tanpa waktu hitung (ditandai, wajib dilengkapi sebelum diserahkan)

/**
 * Menyusun payload simpan dari draf. draf: { [lineId]: { teks?: string, alasan?: string, ragu?: boolean, salahKetik?: boolean } }.
 * Angka PERTAMA pada bahan yang belum punya waktu hitung, atau koreksi angka yang bukan salah ketik (hitung ulang), membutuhkan WAKTU HITUNG dari petugas:
 * tanpa `waktu` baris itu dilaporkan di `perluWaktu` (halaman menanyakan "Kapan barang ini dihitung?") dan belum dikirim. `waktu` = ISO, atau WAKTU_TANPA untuk menyimpan tanpa waktu.
 * Koreksi salah ketik (bawaan) mengirim waktuTetap: waktu hitung tidak berubah. Mengembalikan { items, galat: {lineId: pesan}, perluWaktu: [lineId] }.
 */
export function susunItemSimpan(baris, draf, { waktu = null } = {}) {
  const items = []; const galat = {}; const perluWaktu = [];
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
    const koreksi = nilaiBerubah && sudahDihitung(b);
    if (koreksi && alasan.length < 3) { galat[lineId] = "Alasan koreksi wajib diisi (min. 3 karakter) karena angka sebelumnya sudah tersimpan"; continue; }
    const item = { lineId, revision: b.revision, countedQty: counted, ...(alasan ? { alasan } : {}), ...(d.ragu !== undefined ? { perluPeriksa: d.ragu } : {}) };
    if (nilaiBerubah && counted !== null) {
      const salahKetik = koreksi && d.salahKetik !== false;
      if (salahKetik) item.waktuTetap = true;
      else if (!koreksi && b.observedAt) { /* angka pertama memakai waktu "Mulai hitung" yang sudah dicap server */ }
      else if (waktu === null) { perluWaktu.push(lineId); continue; }
      else if (waktu !== WAKTU_TANPA) item.observedAt = waktu;
    }
    items.push(item);
  }
  return { items, galat, perluWaktu };
}

/** Menerapkan hasil simpan dari server ke baris lokal + menyusun draf sisa/konflik. */
export function terapkanHasilSimpan(baris, draf, hasil) {
  const peta = new Map(baris.map((b) => [b.id, b]));
  const dr = { ...draf }; const konflik = {}; const galatBaris = {};
  for (const h of hasil) {
    const b = peta.get(h.lineId); if (!b) continue;
    if (h.status === "DISIMPAN") {
      peta.set(b.id, { ...b, counted: h.counted, savedAt: h.savedAt, observedAt: h.observedAt ?? null, observedSource: h.observedSource ?? null, tanpaWaktu: !!h.tanpaWaktu, sedangDihitung: false, countedBy: h.oleh ?? b.countedBy, revision: h.revision, perluPeriksa: h.perluPeriksa, ditandaRagu: dr[b.id]?.ragu ?? b.ditandaRagu, dikoreksi: h.revision >= 2 });
      delete dr[b.id];
    } else if (h.status === "TIDAK_BERUBAH") { peta.set(b.id, { ...b, revision: h.revision ?? b.revision }); delete dr[b.id]; }
    else if (h.status === "KONFLIK") konflik[b.id] = h.saatIni;
    else galatBaris[b.id] = h.pesan ?? "Ditolak";
  }
  return { baris: baris.map((b) => peta.get(b.id)), draf: dr, konflik, galatBaris };
}

/** Menerapkan hasil "Mulai hitung" dari server: DIMULAI / SUDAH_DIMULAI mengisi waktu pengamatan; DITOLAK menjadi pesan. */
export function terapkanHasilMulai(baris, hasil) {
  const peta = new Map(baris.map((b) => [b.id, b])); const galatBaris = {};
  for (const h of hasil) {
    const b = peta.get(h.lineId); if (!b) continue;
    if (h.status === "DIMULAI" || h.status === "SUDAH_DIMULAI") peta.set(b.id, { ...b, observedAt: h.observedAt, observedSource: h.observedSource ?? "MULAI", observedBy: h.oleh ?? b.observedBy, sedangDihitung: !sudahDihitung(b) });
    else galatBaris[b.id] = h.pesan ?? "Ditolak";
  }
  return { baris: baris.map((b) => peta.get(b.id)), galatBaris };
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

/** Keterangan tiga waktu satu bahan, dalam bahasa petugas. Waktu hitung yang tidak diketahui dinyatakan terang-terangan. */
export function teksWaktuBaris(b) {
  if (b.excluded) return "dikeluarkan dari sesi";
  const siapa = b.countedBy?.nama ? ` oleh ${b.countedBy.nama}` : "";
  if (sudahDihitung(b)) return b.observedAt ? `Dihitung ${jamTeks(b.observedAt)} · disimpan ${jamTeks(b.savedAt)}${siapa}` : `Waktu hitung belum diketahui · disimpan ${jamTeks(b.savedAt)}${siapa}`;
  if (b.observedAt) return `Sedang dihitung sejak ${jamTeks(b.observedAt)}`;
  return "belum dihitung";
}

const dua = (n) => String(n).padStart(2, "0");
/** ISO → nilai <input type="datetime-local"> (waktu lokal perangkat, tanpa detik). */
export function isoKeInputWaktu(iso) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${dua(d.getMonth() + 1)}-${dua(d.getDate())}T${dua(d.getHours())}:${dua(d.getMinutes())}`; }
/** Nilai <input type="datetime-local"> (lokal perangkat) → ISO UTC; "" / tidak valid → null. */
export function inputWaktuKeIso(teks) { if (!teks) return null; const d = new Date(teks); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }
