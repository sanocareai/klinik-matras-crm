import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// ─── TEMA: Terang / Gelap / Sistem ───────────────────────────────────────────
// Preferensi user disimpan di localStorage; penerapannya lewat atribut
// data-theme di <html> (dibaca styles/tokens.css).
//
// PENTING — anti-kedip: nilai awal SUDAH diterapkan oleh script blocking di
// index.html SEBELUM paint pertama. Provider ini hanya mengambil alih setelah
// React mount. Kalau logika di sini diubah, ubah juga script di index.html —
// dua-duanya memakai key & aturan yang sama.
export const THEME_KEY = "sano-theme";
const VALID = ["light", "dark", "system"];

const ThemeContext = createContext({
  theme: "light",       // pilihan user: light | dark | system
  resolved: "light",    // yang benar-benar dipakai: light | dark
  setTheme: () => {},
});

function bacaPreferensi() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return VALID.includes(v) ? v : "light"; // default: TERANG
  } catch {
    return "light"; // localStorage bisa diblokir (mode privat) — jangan crash
  }
}

function sistemGelap() {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

// data-theme hanya di-set saat GELAP; terang = tanpa atribut (default :root).
function terapkan(resolved) {
  const el = document.documentElement;
  if (resolved === "dark") el.setAttribute("data-theme", "dark");
  else el.removeAttribute("data-theme");

  // theme-color ikut berubah supaya UI browser/PWA (status bar Android,
  // address bar) tidak tetap biru terang saat app-nya gelap.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#000000" : "#F5F5F7");
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(bacaPreferensi);
  const [resolved, setResolved] = useState(() =>
    bacaPreferensi() === "system" ? (sistemGelap() ? "dark" : "light") : bacaPreferensi()
  );

  // Terapkan setiap kali pilihan berubah, dan — kalau "system" — ikuti OS
  // secara live (user ganti tema OS tanpa reload).
  useEffect(() => {
    const hitung = () => (theme === "system" ? (sistemGelap() ? "dark" : "light") : theme);
    const next = hitung();
    setResolved(next);
    terapkan(next);

    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { const r = hitung(); setResolved(r); terapkan(r); };
    // addEventListener tidak ada di Safari lama — fallback addListener.
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  const setTheme = useCallback((t) => {
    if (!VALID.includes(t)) return;
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* mode privat — abaikan */ }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
