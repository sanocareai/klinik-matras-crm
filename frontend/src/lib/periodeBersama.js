// PERIODE (RENTANG TANGGAL) BERSAMA ANTAR TAB/HALAMAN FINANCE.
//
// Dulu tiap halaman Finance menyimpan periodenya sendiri (`useState(periodeDefault)`), jadi tanggal yang dipilih di satu tab tidak ikut ke tab lain dan harus dipilih ulang.
// Kini semua halaman Finance membaca/menulis SATU penyimpan (`usePeriodeFinance`). Semua tab dalam-app dirender sekaligus (TabbedContent.jsx), jadi `useSyncExternalStore`
// membuat tab yang tersembunyi ikut berganti periode seketika dan tab yang dibuka lagi sudah menunjukkan tanggal yang sama.
//   • Bertahan selama sesi browser (sessionStorage; muat ulang tidak menghapus, menutup tab browser menghapus).
//   • Kembali ke bulan berjalan (WIB) di HARI berikutnya — rentang lama tidak boleh menempel berhari-hari tanpa disadari.
//   • Nilai tersimpan yang rusak/tidak masuk akal diabaikan (kembali ke bulan berjalan).
// Murni + dapat disuntik (jam, penyimpanan) supaya bisa diuji `node --test`. Tidak ada rumus/endpoint yang berubah: halaman tetap memakai `periode.from`/`periode.to` seperti sebelumnya.
import { useCallback, useSyncExternalStore } from "react";

const KUNCI = "periode-finance:v1";
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n) => String(n).padStart(2, "0");

/** Tanggal kalender WIB (YYYY-MM-DD) dari sebuah instant. */
export function hariWIB(d = new Date()) {
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  return `${w.getUTCFullYear()}-${p2(w.getUTCMonth() + 1)}-${p2(w.getUTCDate())}`;
}

/** Bulan berjalan (WIB): awal–akhir bulan. Sama dengan `periodeDefault` di features/finance/shared.jsx. */
export function periodeBulanIni(d = new Date()) {
  const w = new Date(d.getTime() + 7 * 3600 * 1000);
  const y = w.getUTCFullYear(); const m = w.getUTCMonth();
  const akhir = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return { from: `${y}-${p2(m + 1)}-01`, to: `${y}-${p2(m + 1)}-${p2(akhir)}` };
}

const sah = (p) => !!p && POLA_TANGGAL.test(p.from) && POLA_TANGGAL.test(p.to) && p.from <= p.to;

/**
 * Buat penyimpan periode. `jam()` → Date; `penyimpanan` = { getItem, setItem } (boleh null/melempar galat: penyimpanan gagal tidak boleh menjatuhkan halaman).
 * `ambil()` mengembalikan OBJEK YANG SAMA selama nilai/harinya tidak berubah (syarat useSyncExternalStore).
 */
export function buatPenyimpanPeriode({ jam = () => new Date(), penyimpanan = null } = {}) {
  const pendengar = new Set();
  let hari = hariWIB(jam());
  let nilai = null;

  const muatDariPenyimpanan = () => {
    try {
      const mentah = penyimpanan?.getItem(KUNCI);
      if (!mentah) return null;
      const d = JSON.parse(mentah);
      return d?.hari === hari && sah(d) ? { from: d.from, to: d.to } : null;
    } catch { return null; }
  };
  const tulis = () => { try { penyimpanan?.setItem(KUNCI, JSON.stringify({ hari, from: nilai.from, to: nilai.to })); } catch { /* penyimpanan penuh/dilarang: abaikan */ } };
  const segarkanHari = () => {
    const sekarang = hariWIB(jam());
    if (sekarang !== hari) { hari = sekarang; nilai = periodeBulanIni(jam()); tulis(); }
  };
  nilai = muatDariPenyimpanan() ?? periodeBulanIni(jam());

  return {
    ambil() { segarkanHari(); return nilai; },
    setel(baru) {
      if (!sah(baru)) return; // masukan tidak sah (mis. "Semua" tanpa tanggal) tidak menimpa periode
      segarkanHari();
      if (baru.from === nilai.from && baru.to === nilai.to) return;
      nilai = { from: baru.from, to: baru.to };
      tulis();
      for (const f of [...pendengar]) f();
    },
    langganan(f) { pendengar.add(f); return () => pendengar.delete(f); },
    /** Kembali ke bulan berjalan. */
    aturUlang() { nilai = periodeBulanIni(jam()); tulis(); for (const f of [...pendengar]) f(); },
  };
}

let tunggal = null;
const penyimpanBersama = () => {
  if (!tunggal) {
    let st = null;
    try { st = typeof sessionStorage !== "undefined" ? sessionStorage : null; } catch { st = null; }
    tunggal = buatPenyimpanPeriode({ penyimpanan: st });
  }
  return tunggal;
};

/** Kembali ke bulan berjalan di memori DAN penyimpanan — dipanggil saat logout / login ulang supaya pengguna berikutnya di browser yang sama tidak mewarisi rentang tanggal pengguna lama. */
export function aturUlangPeriodeFinance() { penyimpanBersama().aturUlang(); }

/** Pengganti `useState(periodeDefault)` di halaman Finance: `[periode, setPeriode]` dengan bentuk yang sama, tetapi dibagi ke semua halaman/tab Finance. */
export function usePeriodeFinance() {
  const s = penyimpanBersama();
  const periode = useSyncExternalStore(s.langganan, s.ambil, s.ambil);
  const setPeriode = useCallback((p) => s.setel(typeof p === "function" ? p(s.ambil()) : p), [s]);
  return [periode, setPeriode];
}
