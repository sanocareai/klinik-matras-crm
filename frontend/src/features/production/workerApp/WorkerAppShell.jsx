import React from "react";
import { Activity, ArrowLeft, Briefcase, Package, RefreshCw, User, WifiOff } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle.jsx";
import { useOnline } from "@/components/StandaloneShell.jsx";
import { NAV_TABS } from "./workerAppModel.js";
import "./worker-app.css";

// Kerangka aplikasi lantai (mobile-first): header ringkas + bottom navigation (maks. 4). TANPA sidebar desktop. Halaman tetap memakai sesi & tema aplikasi.
const ICONS = { Briefcase, Package, Activity, User };

export default function WorkerAppShell({ title, subtitle, tab, onTab, badges = {}, onRefresh, refreshing = false, onBack = null, children, hideNav = false, actionPad = false }) {
  const online = useOnline();
  return (
    <div className="wa" data-testid="worker-app">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="mx-auto flex max-w-[1200px] items-center gap-2 px-3 py-2 md:px-6">
          {onBack ? (
            <button type="button" onClick={onBack} aria-label="Kembali ke daftar pekerjaan" data-testid="worker-back" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint"><ArrowLeft size={21} aria-hidden /></button>
          ) : (
            <span aria-hidden className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[#0B2454] text-[15px] font-extrabold text-white">S</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[16px] font-bold leading-tight text-ink">{title}</p>
            {subtitle && <p className="m-0 truncate text-[12px] text-ink3">{subtitle}</p>}
          </div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing} aria-label="Muat ulang" className="flex h-11 w-11 items-center justify-center rounded-btn text-ink2 hover:bg-hovertint disabled:opacity-50">
              <RefreshCw size={19} className={refreshing ? "animate-spin" : ""} aria-hidden />
            </button>
          )}
          <ThemeToggle />
        </div>
        {!online && (
          <div role="status" data-testid="offline-banner" className="flex items-center justify-center gap-2 bg-orange px-3 py-1.5 text-[12.5px] font-semibold text-white">
            <WifiOff size={14} aria-hidden /> Offline — data terakhir ditampilkan; aksi dikirim hanya saat sinyal kembali
          </div>
        )}
      </header>
      <main className={`wa-main ${actionPad ? "wa-main-action" : ""}`}>{children}</main>
      {!hideNav && (
        <nav className="wa-nav" aria-label="Navigasi aplikasi" data-testid="worker-nav">
          <div className="wa-nav-inner">
            {NAV_TABS.map((t) => {
              const Icon = ICONS[t.icon];
              const count = badges[t.key];
              return (
                <button key={t.key} type="button" className="wa-nav-btn" data-testid={`nav-${t.key}`} aria-current={tab === t.key ? "page" : undefined} onClick={() => onTab(t.key)}>
                  <Icon size={22} aria-hidden />
                  <span>{t.label}</span>
                  {count > 0 && <span className="wa-badge" aria-label={`${count} perlu perhatian`}>{count > 99 ? "99+" : count}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
