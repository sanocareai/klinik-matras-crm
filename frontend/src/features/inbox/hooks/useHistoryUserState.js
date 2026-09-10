import { useCallback, useEffect, useState } from "react";

// Baca `window.history.state.usr` (tempat react-router v6 menyimpan
// `navigate(path, { state })`) secara REAKTIF — re-render saat berubah
// lewat popstate (swipe-back / tombol back OS / navigate(-1)).
//
// KENAPA TIDAK pakai useLocation().state: RUSAK sejak D-144 (sistem tab
// dalam-app ala Notion, commit 74fa4883). TabbedContent.jsx membungkus
// tiap halaman dalam `<Routes location={tab.path}>` sendiri — `tab.path`
// STRING dari localStorage, jadi `useLocation()` di dalam halaman
// mengembalikan lokasi sintetis TANPA `state` (selalu null). `navigate()`
// sendiri TETAP memanggil BrowserRouter sungguhan (satu-satunya di app),
// jadi `window.history` yang asli TETAP terisi & bisa di-pop — cuma
// pembacaannya lewat react-router yang terputus. Hook ini membaca langsung
// dari `window.history`, lolos dari wrapping itu.
//
// Mengembalikan `[state, sync]` — panggil `sync()` MANUAL setelah tiap
// `navigate(path, { state })` (push TIDAK memicu popstate, jadi tidak ada
// yang otomatis me-refresh) supaya komponen langsung baca state baru.
export function useHistoryUserState() {
  const read = () => {
    try {
      return window.history.state?.usr ?? null;
    } catch {
      return null;
    }
  };

  const [state, setState] = useState(read);
  const sync = useCallback(() => setState(read()), []);

  useEffect(() => {
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [sync]);

  return [state, sync];
}
