import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";

/**
 * Filter tahap daftar Gudang: state lokal (langsung berlaku) yang juga disimpan di path TAB AKTIF (?tahap=…) lewat `replaceActivePath`, supaya bertahan saat muat ulang / pindah tab.
 * JANGAN memakai `setSearchParams` untuk ini: tiap tab workspace dirender dengan lokasi VIRTUAL (TabbedContent), jadi perubahan query-saja di router asli tidak sampai ke halaman (filter tampak mati).
 */
export function useTahapFilter(pathDasar) {
  const [sp] = useSearchParams(); const { pathname } = useLocation(); const { replaceActivePath } = useTabs();
  const [tahap, setTahap] = useState(sp.get("tahap") ?? "");
  const pilih = (k) => { setTahap(k); replaceActivePath(k ? `${pathDasar ?? pathname}?tahap=${k}` : (pathDasar ?? pathname)); };
  return [tahap, pilih];
}
