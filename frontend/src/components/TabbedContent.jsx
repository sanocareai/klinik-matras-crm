import React, { Suspense, useEffect, useLayoutEffect, useRef } from "react";
import { Routes, Route } from "react-router-dom";
import { useTabs, TabIdProvider } from "@/lib/TabsContext.jsx";
import { RouteFallback } from "@/routes/pageRegistry.jsx";
import { splitPathQuery } from "@/lib/splitPathQuery.js";
import ChunkErrorBoundary from "./ChunkErrorBoundary.jsx";
import { buatPenyimpanScroll, terapkanScroll } from "@/lib/posisiScrollTab.js";
import { urutanTabHidup } from "@/lib/tabHidup.js";

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
//
// OPTIMASI (13 Nov 2026, audit lag): D-144 di atas DIPERSEMPIT, bukan dibatalkan.
// Terukur di produksi: 5 tab tersimpan di localStorage → buka /inbox memicu
// 187 request, ±10 MB JSON, 80.757 node DOM, /api/conversations tertahan 5 dtk.
//   1. Tab yang DIPULIHKAN saat reload baru di-mount ketika pertama kali dibuka
//      (sebelum itu cuma judulnya di bar tab) — state-nya memang sudah hilang
//      karena reload, jadi tidak ada yang dikorbankan.
//   2. Maksimal MAKS_TAB_HIDUP tab tetap hidup di background; yang paling lama
//      tidak dibuka di-unmount (dibuka lagi = dimuat ulang). Posisi scroll
//      tetap dipulihkan (penyimpan scroll di bawah tidak ikut dibuang).
//   3. Isi tab di-memo (PanelTab) — pindah tab tidak lagi me-render ulang
//      SEMUA halaman yang hidup, cuma atribut `hidden` yang berubah.
// Batas & urutan: lib/tabHidup.js (murni, dites).

const PanelTab = React.memo(function PanelTab({ id, path, pages, ctx }) {
  // P8.1 (UI & Navigation Consolidation) — tab.path BOLEH memuat query
  // string ("?tab=...", dipakai menu "Riwayat" Order Produksi).
  // `{ pathname: tab.path }` SEBELUMNYA menaruh "?..." itu MENTAH di
  // dalam field pathname tanpa pernah dipecah ke `search` — halaman di
  // dalam <Routes> ini cocok (matcher toleran), tapi useSearchParams()/
  // useLocation().search di dalamnya selalu kosong (bug nyata,
  // ditemukan saat QA visual "Riwayat"). Dipecah di sini dengan helper
  // yang SAMA dipakai resolveEntryPath (pageRegistry.jsx).
  const { base, search } = splitPathQuery(path);
  return (
    <TabIdProvider id={id}>
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
  );
});

export default function TabbedContent() {
  const { tabs, activeTabId, pages, ctx } = useTabs();
  // Dihitung saat render (bukan efek) supaya tab yang baru dibuka langsung tampil tanpa satu frame kosong.
  const hidupRef = useRef([]);
  hidupRef.current = urutanTabHidup(hidupRef.current, activeTabId, tabs.map((t) => t.id));
  const hidup = new Set(hidupRef.current);
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
      {tabs.filter((tab) => hidup.has(tab.id)).map((tab) => (
        <div key={tab.id} hidden={tab.id !== activeTabId} className="h-full" onScrollCapture={catatDalam(tab.id)}>
          <PanelTab id={tab.id} path={tab.path} pages={pages} ctx={ctx} />
        </div>
      ))}
    </>
  );
}
