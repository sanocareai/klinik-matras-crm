// WAKTU WIB — lantai produksi bekerja dalam kalender Asia/Jakarta, apa pun zona waktu HP.

const HARI = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const HARI3 = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const OFFSET_MS = 7 * 3600_000;

/** Komponen tanggal WIB dari sebuah instan (tanpa bergantung zona waktu perangkat). */
export function wib(d: Date = new Date()) {
  const x = new Date(d.getTime() + OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), hari: x.getUTCDay(), jam: x.getUTCHours(), menit: x.getUTCMinutes() };
}

/** "Kamis, 12 Nov" */
export function tanggalPanjangWib(d: Date = new Date()) {
  const w = wib(d);
  return `${HARI[w.hari]}, ${w.d} ${BULAN[w.m]}`;
}

/** "2026-11-12" (format tanggal produksi di server). */
export function kunciTanggalWib(d: Date = new Date()) {
  const w = wib(d);
  return `${w.y}-${String(w.m + 1).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** Deretan hari kerja mulai kemarin: [{kunci, hari3, tgl}] — untuk pemilih tanggal Target. */
export function deretHari(jumlah = 6, mulai = -1, d: Date = new Date()) {
  return Array.from({ length: jumlah }, (_, i) => {
    const x = new Date(d.getTime() + (mulai + i) * 86400_000);
    const w = wib(x);
    return { kunci: kunciTanggalWib(x), hari3: HARI3[w.hari]!, tgl: w.d };
  });
}

/** Tujuh tanggal minggu berjalan (Senin → Minggu, WIB) dalam format server "YYYY-MM-DD". */
export function mingguIniWib(d: Date = new Date()) {
  const mundur = (wib(d).hari + 6) % 7; // Senin = 0
  return Array.from({ length: 7 }, (_, i) => kunciTanggalWib(new Date(d.getTime() + (i - mundur) * 86400_000)));
}

/** "10:42" WIB */
export function jamWib(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  const w = wib(t);
  return `${String(w.jam).padStart(2, "0")}:${String(w.menit).padStart(2, "0")}`;
}
