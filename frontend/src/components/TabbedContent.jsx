import React, { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import { useTabs, TabIdProvider } from "@/lib/TabsContext.jsx";
import { RouteFallback } from "@/routes/pageRegistry.jsx";
import { splitPathQuery } from "@/lib/splitPathQuery.js";
import ChunkErrorBoundary from "./ChunkErrorBoundary.jsx";
import { buatPenyimpanScroll, terapkanScroll } from "@/lib/posisiScrollTab.js";

// D-144 — SEMUA tab yang terbuka dirender SEKALIGUS di sini (bukan cuma
// tab aktif); tab yang tidak aktif disembunyikan lewat atribut `hidden`
// (display:none bawaan browser), BUKAN di-unmount — itu yang membuat
// pindah tab instan & scroll/input yang belum disimpan tidak hilang
// (keputusan owner, lihat TabsContext.jsx).
//
// Tiap tab dibungkus <Routes location={...}> SENDIRI-SENDIRI (fitur resmi
// react-router v6, bukan hack) — path yang dicocokkan jadi path VIRTUAL
// milik tab itu, BUKAN URL asli browser. Ini kenapa useParams()/
// useLocation() di dalam halaman (mis. ProductionUnitDetail baca :id)
// tetap benar per-tab walau banyak tab dengan path dinamis terbuka
// bersamaan — kalau semua tab berbagi SATU <Routes> yang sama, params
// tab yang tidak aktif akan salah baca dari URL tab yang sedang aktif.
//
// `useNavigate()` di dalam halaman TETAP mengarah ke router sungguhan
// (satu-satunya BrowserRouter di app) — TabsContext.jsx yang menyerap efek
// itu lewat sinkronisasi lokasi (lihat catatan "batasan yang disadari" di
// sana untuk kasus tepi yang belum ditangani).
// POSISI SCROLL (8 Nov 2026): tab yang disembunyikan tetap hidup, tetapi scroll-nya tidak — penggulir utama (.page-body) dipakai bersama semua tab dan elemen display:none
// kehilangan scrollTop. Di sini posisi tiap tab dicatat saat ditinggalkan dan dikembalikan saat aktif lagi (lib/posisiScrollTab.js). Penggulir utama dicatat pada fase render,
// SEBELUM DOM berganti tab (nilainya masih milik tab lama); panel gulir di dalam halaman dicatat lewat event scroll (fase capture) selama tab itu aktif.
export default function TabbedContent() {
  const { tabs, activeTabId, pages, ctx } = useTabs();
  const jangkar = useRef(null);
  const aktifRef = useRef(activeTabId);
  const simpan = useRef(null);
  if (!simpan.current) simpan.current = buatPenyimpanScroll();
  const penggulir = () => jangkar.current?.closest(".page-body") ?? null;

  if (aktifRef.current !== activeTabId) {
    const sc = penggulir();
    if (sc) simpan.current.catatUtama(aktifRef.current, sc.scrollTop);
  }
  useLayoutEffect(() => {
    if (aktifRef.current === activeTabId) return;
    aktifRef.current = activeTabId;
    terapkanScroll(simpan.current.ambil(activeTabId), penggulir());
  }, [activeTabId]);
  useEffect(() => { simpan.current.sisakan(tabs.map((t) => t.id)); }, [tabs]);
  const catatDalam = (idTab) => (e) => {
    const el = e.target;
    if (idTab !== aktifRef.current || !(el instanceof Element)) return;
    if (el.closest(".page-body") === el) return; // penggulir utama ditangani di atas
    simpan.current.catatDalam(idTab, el, el.scrollTop);
  };

  return (
    <>
      <span ref={jangkar} hidden aria-hidden="true" />
      {tabs.map((tab) => {
        // P8.1 (UI & Navigation Consolidation) — tab.path BOLEH memuat query
        // string ("?tab=...", dipakai menu "Riwayat" Order Produksi).
        // `{ pathname: tab.path }` SEBELUMNYA menaruh "?..." itu MENTAH di
        // dalam field pathname tanpa pernah dipecah ke `search` — halaman di
        // dalam <Routes> ini cocok (matcher toleran), tapi useSearchParams()/
        // useLocation().search di dalamnya selalu kosong (bug nyata,
        // ditemukan saat QA visual "Riwayat"). Dipecah di sini dengan helper
        // yang SAMA dipakai resolveEntryPath (pageRegistry.jsx).
        const { base, search } = splitPathQuery(tab.path);
        return (
          <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full" onScrollCapture={catatDalam(tab.id)}>
            <TabIdProvider id={tab.id}>
              <ChunkErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes location={{ pathname: base, search }}>
                    {pages.map((p) => (
                      <Route key={p.path} path={p.path} element={p.render(ctx)} />
                    ))}
                  </Routes>
                </Suspense>
              </ChunkErrorBoundary>
            </TabIdProvider>
          </div>
        );
      })}
    </>
  );
}
