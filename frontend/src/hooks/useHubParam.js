import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { pickParam, withParam } from "@/lib/hubTabs.js";

// P12B.3 — satu parameter URL (mis. ?tab=aktif) yang bertahan di path TAB AKTIF (muat ulang / pindah tab dalam-app), dipakai halaman yang
// butuh filter ringan TANPA bilah tab terpisah. Klik memakai replace (tanpa riwayat Back). Nilai tak dikenal jatuh ke default.
function useOptionalTabs() { try { return useTabs(); } catch { return null; } }

// Beberapa hook menulis kunci URL BERBEDA dalam satu tick (mis. "Hapus filter" mereset periode lalu jenis masalah). Tiap penulisan berangkat dari location.search yang SAMA (belum diperbarui),
// sehingga yang kedua akan menimpa yang pertama. Query yang sedang tertunda dicatat per-tick supaya penulisan berikutnya melanjutkan dari hasil sebelumnya; dibuang di microtask berikutnya.
const tertunda = { dari: null, search: null };
const basisSearch = (loc) => (tertunda.dari === loc.pathname + loc.search && tertunda.search !== null ? tertunda.search : loc.search);
const catatTertunda = (loc, qs) => { tertunda.dari = loc.pathname + loc.search; tertunda.search = qs; Promise.resolve().then(() => { tertunda.dari = null; tertunda.search = null; }); };

export function useHubParam(param, validKeys, defaultKey) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const fromUrl = pickParam(validKeys, params.get(param), defaultKey);
  const [value, setValue] = useState(fromUrl);
  useEffect(() => { setValue(fromUrl); }, [fromUrl]);
  const set = (next) => {
    setValue(next);
    const path = withParam(location.pathname + location.search, param, next, defaultKey);
    if (tabsCtx?.replaceActivePath) tabsCtx.replaceActivePath(path);
    else setParams((p) => { const n = new URLSearchParams(p); if (next === defaultKey && param !== "tab") n.delete(param); else n.set(param, next); return n; }, { replace: true });
  };
  return [value, set];
}

// Periode (DateRangePicker standar app) di URL: beberapa kunci (?preset=&dari=&sampai=&n=) ditulis SEKALIGUS lewat path tab aktif, jadi bertahan saat muat ulang dan pindah tab dalam-app.
// `baca(params)` -> DateRange, `tulis(params, range)` -> URLSearchParams (kunci lain, mis. ?tab= dan ?unit=, dipertahankan). Perubahan memakai replace (tanpa riwayat Back).
export function useHubRange(baca, tulis) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const dariUrl = baca(params);
  const kunci = `${dariUrl.preset}|${dariUrl.from}|${dariUrl.to}|${dariUrl.n}`;
  const [value, setValue] = useState(dariUrl);
  useEffect(() => { setValue(dariUrl); }, [kunci]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next) => {
    setValue(next);
    if (tabsCtx?.replaceActivePath) {
      const qs = tulis(new URLSearchParams(basisSearch(location)), next).toString();
      catatTertunda(location, qs ? `?${qs}` : "");
      tabsCtx.replaceActivePath(qs ? `${location.pathname}?${qs}` : location.pathname);
    } else setParams((p) => tulis(p, next), { replace: true });
  };
  return [value, set];
}

// Jenis masalah Kelengkapan (Order Produksi) di URL (?masalah=semua | ?masalah=catatan,periksa): bertahan saat muat ulang dan pindah tab dalam-app; kunci URL lain dipertahankan.
// `baca(params)` -> array kunci kelengkapan, `tulis(params, kunci[])` -> URLSearchParams. Perubahan memakai replace (tanpa riwayat Back).
export function useHubMasalah(baca, tulis) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const dariUrl = baca(params);
  const kunci = dariUrl.join(",");
  const [value, setValue] = useState(dariUrl);
  useEffect(() => { setValue(dariUrl); }, [kunci]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next) => {
    setValue(next);
    if (tabsCtx?.replaceActivePath) {
      const qs = tulis(new URLSearchParams(basisSearch(location)), next).toString();
      catatTertunda(location, qs ? `?${qs}` : "");
      tabsCtx.replaceActivePath(qs ? `${location.pathname}?${qs}` : location.pathname);
    } else setParams((p) => tulis(p, next), { replace: true });
  };
  return [value, set];
}

// P12B.4 — parameter bebas (mis. ?unit=<id>) untuk panel/drawer yang terbuka: null = tertutup (parameter dibuang dari URL). Berbagi mekanisme path-tab-aktif
// dengan useHubParam sehingga tersimpan di tab, bertahan saat muat ulang, dan klik membuka drawer di tab yang sama (replace, tanpa tab baru).
export function useOpenParam(param) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const fromUrl = params.get(param) || null;
  const [value, setValue] = useState(fromUrl);
  useEffect(() => { setValue(fromUrl); }, [fromUrl]);
  const set = (next) => {
    setValue(next || null);
    const path = withParam(location.pathname + location.search, param, next || null, null);
    if (tabsCtx?.replaceActivePath) tabsCtx.replaceActivePath(path);
    else setParams((p) => { const n = new URLSearchParams(p); if (next) n.set(param, next); else n.delete(param); return n; }, { replace: true });
  };
  return [value, set];
}
