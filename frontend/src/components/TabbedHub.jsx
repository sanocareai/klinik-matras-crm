import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { pickTab, withTabParam } from "@/lib/hubTabs.js";

// P12B.2 — kerangka hub bertab yang dipakai Order Produksi, KPI & Laporan, Biaya Produksi, Komplain & Revisi, dan Pengaturan.
// Murni navigasi/tata letak: setiap panel merender halaman/komponen yang SUDAH ADA dengan endpoint-nya sendiri (tidak ada API/data baru).
// Panel di-mount saat pertama dikunjungi lalu DIPERTAHANKAN (disembunyikan CSS) supaya filter/scroll tidak hilang saat pindah subtab;
// `keepAlive: false` = hanya dirender saat aktif (data dimuat ulang setiap dibuka — dipakai bila dua tab memakai sumber data yang sama).
// Tab terpilih = ?tab= di path tab aktif (bertahan saat muat ulang / pindah tab dalam-app); klik memakai replace (tanpa riwayat Back).
function useOptionalTabs() { try { return useTabs(); } catch { return null; } }

export default function TabbedHub({ tabs, defaultTab, label, className = "" }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const urlKey = params.get("tab");
  const [active, setActive] = useState(() => pickTab(tabs, urlKey, defaultTab));
  const mounted = useRef(new Set());
  // Sinkron dari URL (deep-link, tombol Back, redirect rute lama) — tetapi tab yang disembunyikan (tak punya izin) tak pernah terpilih.
  useEffect(() => { setActive(pickTab(tabs, urlKey, defaultTab)); }, [urlKey, tabs, defaultTab]);
  mounted.current.add(active);

  const visible = useMemo(() => tabs.filter((t) => !t.hidden), [tabs]);
  const choose = (key) => {
    setActive(key);
    if (tabsCtx?.replaceActivePath) tabsCtx.replaceActivePath(withTabParam(location.pathname + location.search, key));
    else setParams((p) => { const n = new URLSearchParams(p); n.set("tab", key); return n; }, { replace: true });
  };

  return (
    <div className={className} data-testid="tabbed-hub" data-active-tab={active}>
      <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line px-4 pt-4 md:px-8 md:pt-6">
        {visible.map((t) => (
          <button key={t.key} type="button" role="tab" id={`hub-tab-${t.key}`} aria-selected={active === t.key} aria-controls={`hub-panel-${t.key}`} data-testid={`hub-tab-${t.key}`}
            onClick={() => choose(t.key)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold ${active === t.key ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink2"}`}>
            {t.label}
          </button>
        ))}
      </div>
      {visible.map((t) => (
        <div key={t.key} role="tabpanel" id={`hub-panel-${t.key}`} aria-labelledby={`hub-tab-${t.key}`} className={active === t.key ? "" : "hidden"}>
          {(t.keepAlive === false ? active === t.key : mounted.current.has(t.key)) ? t.render() : null}
        </div>
      ))}
    </div>
  );
}
