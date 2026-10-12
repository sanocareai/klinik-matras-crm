import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";
import { pickTab, withTabParam } from "@/lib/hubTabs.js";

// Tab INTERNAL halaman yang terikat ke ?tab= di URL — supaya deep-link dari hub Finance (mis. /finance/cash?tab=mutasi), refresh, dan
// tombol Back/Forward membuka tab yang benar. Perilaku mengikuti TabbedHub: state lokal (instan) + sinkron dari URL + tulis ke path tab aktif.
// Tanpa ?tab= (atau nilai tak dikenal) = tab bawaan; URL bersih tetap berfungsi seperti sebelumnya.
function useOptionalTabs() { try { return useTabs(); } catch { return null; } }

export function useUrlTab(kunciValid, tabBawaan) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const tabsCtx = useOptionalTabs();
  const diminta = params.get("tab");
  const daftar = kunciValid.map((key) => ({ key }));
  const [tab, setTabState] = useState(() => pickTab(daftar, diminta, tabBawaan));
  useEffect(() => { setTabState(pickTab(kunciValid.map((key) => ({ key })), diminta, tabBawaan)); }, [diminta]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = useCallback((key) => {
    setTabState(key);
    if (tabsCtx?.replaceActivePath) tabsCtx.replaceActivePath(withTabParam(location.pathname + location.search, key));
    else setParams((p) => { const n = new URLSearchParams(p); n.set("tab", key); return n; }, { replace: true });
  }, [tabsCtx, location.pathname, location.search, setParams]);
  return [tab, setTab];
}
