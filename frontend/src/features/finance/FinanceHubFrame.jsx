import React, { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { rolesOf } from "@/lib/roles.js";
import { cariItemHub, hubTerlihat, badgeItem } from "@/lib/financeHubs.js";
import { useAntreanFinance } from "@/lib/financeAntrean.js";
import { splitPathQuery } from "@/lib/splitPathQuery.js";

// KERANGKA HUB FINANCE — bilah tab di atas halaman Finance yang termasuk sebuah hub. Murni navigasi: tiap tab = RUTE LAMA (path + ?tab=), jadi deep-link,
// refresh, Back/Forward, dan tab dalam-app tidak berubah. Lokasi dibaca dari <Routes location> milik tab ini (virtual per tab), bukan URL aktif — tab yang
// sedang disembunyikan tetap menyorot hub-nya sendiri.
function useOptionalTabs() { try { return useTabs(); } catch { return null; } }

function peranSaya() {
  try { return rolesOf(JSON.parse(localStorage.getItem("user") || "null")); } catch { return []; }
}

export default function FinanceHubFrame({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tabsCtx = useOptionalTabs();
  const cocok = cariItemHub(location.pathname, location.search);
  const antrean = useAntreanFinance(Boolean(cocok));
  const hub = useMemo(() => {
    if (!cocok) return null;
    return hubTerlihat(peranSaya()).find((h) => h.key === cocok.hub.key) ?? null;
  }, [cocok?.hub.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cocok || !hub || hub.items.length < 2) return children;

  function buka(e, to) {
    e.preventDefault();
    const sama = splitPathQuery(to).base === location.pathname;
    // Path sama (hanya ?tab= berubah): ganti path tab aktif (replace) — efek sinkron lokasi tidak jalan untuk perubahan query saja.
    if (sama && tabsCtx?.replaceActivePath) tabsCtx.replaceActivePath(to);
    else navigate(to);
  }

  return (
    <>
      <nav aria-label={`Hub ${hub.label}`} className="fin-hub-bar mx-auto w-full px-4 pt-4 md:px-8 md:pt-6" data-testid="finance-hub-bar" data-hub={hub.key}>
        <p className="m-0 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink3">{hub.label}</p>
        <div role="tablist" aria-label={hub.label} className="flex gap-1 overflow-x-auto border-b border-line">
          {hub.items.map((it) => {
            const aktif = it.key === cocok.item.key;
            const n = badgeItem(it, antrean);
            return (
              <a
                key={it.key} href={it.to} role="tab" aria-selected={aktif} aria-current={aktif ? "page" : undefined} data-testid={`hub-tab-${it.key}`}
                onClick={(e) => buka(e, it.to)}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-semibold no-underline max-sm:min-h-11 ${aktif ? "border-accent text-accent" : "border-transparent text-ink3 hover:text-ink"}`}
              >
                {it.label}
                {n != null && <span className="rounded-full bg-orangebg px-1.5 text-[10.5px] font-bold tabular-nums text-orange" title={`${n} menunggu tindakan`} data-testid={`hub-badge-${it.key}`}>{n}</span>}
              </a>
            );
          })}
        </div>
      </nav>
      {children}
    </>
  );
}
