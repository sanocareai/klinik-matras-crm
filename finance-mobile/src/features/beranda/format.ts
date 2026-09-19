// Format tampilan non-uang untuk Beranda. (Uang selalu lewat src/lib/money.ts.)

/** Persen dari server → "10,1%" / "-3.496,5%". Hanya tampilan (bukan uang); tanpa toFixed. */
export function formatPersen(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const persepuluh = Math.round(Math.abs(n) * 10);
  const utuh = Math.floor(persepuluh / 10);
  const sisa = persepuluh % 10;
  const ribuan = String(utuh).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const tanda = n < 0 && persepuluh > 0 ? "-" : "";
  return `${tanda}${ribuan}${sisa === 0 ? "" : `,${sisa}`}%`;
}

/** Kata benda + jumlah: "3 pengeluaran". */
export function jumlahDan(n: number, kata: string): string {
  return `${n} ${kata}`;
}
