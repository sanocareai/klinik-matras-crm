import React, { useEffect, useState } from "react";
import { ArrowLeft, RefreshCw, WifiOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import ThemeToggle from "./ThemeToggle.jsx";
import { lastActiveTabPath } from "../lib/openTabs.js";

// Shell halaman MANDIRI (di luar sidebar/tab desktop): aplikasi PIC Table/Corner (PWA, mobile-first) dan kiosk Andon TV.
// Tetap memakai sesi login & tema aplikasi (ThemeProvider di main.jsx), hanya tanpa kerangka desktop.
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export default function StandaloneShell({ title, subtitle, onRefresh, refreshing = false, backHref, children, wide = false, right = null, onLeave = null }) {
  const online = useOnline();
  const { pathname } = useLocation();
  // Panah kembali = tab yang tadi aktif (sebelum membuka aplikasi mandiri ini), BUKAN selalu Main Hub. /portal hanya cadangan
  // saat belum ada tab tersimpan (mis. PWA dibuka langsung di halaman ini).
  const target = backHref || lastActiveTabPath(pathname) || "/portal";
  return (
    <div className="min-h-[100dvh] bg-base text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className={`mx-auto flex items-center gap-2 px-3 py-2 ${wide ? "max-w-none" : "max-w-[640px]"}`}>
          <Link to={target} onClick={(e) => { if (onLeave && !onLeave()) e.preventDefault(); }} aria-label={target === "/portal" ? "Kembali ke SANSS" : "Kembali ke tab sebelumnya"} className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint">
            <ArrowLeft size={20} aria-hidden />
          </Link>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-bold leading-tight text-ink">{title}</p>
            {subtitle && <p className="truncate text-[12px] text-ink3">{subtitle}</p>}
          </div>
          {right}
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Muat ulang"
              className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint disabled:opacity-50">
              <RefreshCw size={19} className={refreshing ? "animate-spin" : ""} aria-hidden />
            </button>
          )}
          <ThemeToggle />
        </div>
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 bg-orange px-3 py-1.5 text-[12.5px] font-semibold text-white">
            <WifiOff size={14} aria-hidden /> Offline — isian tersimpan di HP ini, kirim saat sinyal kembali
          </div>
        )}
      </header>
      <main className={`mx-auto px-3 pb-24 pt-3 ${wide ? "max-w-none" : "max-w-[640px]"}`} style={{ paddingBottom: "calc(6rem + env(safe-area-inset-bottom))" }}>
        {children}
      </main>
    </div>
  );
}
