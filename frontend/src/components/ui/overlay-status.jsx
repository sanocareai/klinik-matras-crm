import { useEffect, useState, useSyncExternalStore } from "react";

// Status overlay global: berapa dialog transaksi / panel layar penuh sedang terbuka. Komponen global yang melayang di atas semuanya (banner Install, banner Versi baru)
// membacanya lewat useOverlayAktif() dan menyingkir selama ada overlay — tanpa memeriksa DOM dan tanpa mengakali z-index.
//
// Cara daftar: letakkan <DaftarOverlay /> sebagai anak <Dialog.Content> (konten Radix hanya terpasang saat terbuka, jadi mendaftar saat dibuka dan berhenti saat ditutup
// atau komponen dibongkar). Hitungan (bukan boolean) supaya dialog bertumpuk (dialog di atas dialog) tidak melepas status saat salah satunya ditutup.
let jumlah = 0;
const pendengar = new Set();
const ubah = (d) => { jumlah = Math.max(0, jumlah + d); pendengar.forEach((f) => f()); };
const langgan = (f) => { pendengar.add(f); return () => { pendengar.delete(f); }; };

export function useOverlayAktif() {
  return useSyncExternalStore(langgan, () => jumlah > 0, () => false);
}

// Tinggi keyboard layar (piksel) selagi `aktif`, dari visualViewport — 0 bila tidak ada keyboard / browser tanpa visualViewport. Ambang 80px mengabaikan naik-turunnya bilah alamat.
// Dialog layar penuh memakainya untuk menumpukan footer di atas keyboard (100dvh TIDAK mengecil saat keyboard muncul di Chrome Android/iOS).
export function useInsetKeyboard(aktif) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!aktif || !vv) { setInset(0); return undefined; }
    const hitung = () => { const d = Math.round(window.innerHeight - vv.height - vv.offsetTop); setInset(d > 80 ? d : 0); };
    hitung();
    vv.addEventListener("resize", hitung); vv.addEventListener("scroll", hitung);
    return () => { vv.removeEventListener("resize", hitung); vv.removeEventListener("scroll", hitung); setInset(0); };
  }, [aktif]);
  return inset;
}

export function DaftarOverlay() {
  useEffect(() => { ubah(1); return () => ubah(-1); }, []);
  return null;
}
