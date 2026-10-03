import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { pickParam, withParam } from "@/lib/hubTabs.js";

// P12B.3 — satu parameter URL (mis. ?tab=aktif) yang bertahan di path TAB AKTIF (muat ulang / pindah tab dalam-app), dipakai halaman yang
// butuh filter ringan TANPA bilah tab terpisah. Klik memakai replace (tanpa riwayat Back). Nilai tak dikenal jatuh ke default.
function useOptionalTabs() { try { return useTabs(); } catch { return null; } }

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
