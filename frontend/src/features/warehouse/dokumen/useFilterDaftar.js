import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTabs } from "@/lib/TabsContext.jsx";

/**
 * Saringan daftar Gudang (tahap, kata kunci, dst.) yang disimpan di path TAB AKTIF (?tahap=…&q=…) lewat `replaceActivePath`, supaya bertahan saat muat ulang, bisa dibagikan, dan kembali utuh
 * setelah jendela detail ditutup. State lokal berlaku langsung. JANGAN memakai `setSearchParams` (lokasi tab virtual — lihat useTahapFilter). `pathDasar` = path daftar (tanpa /:id) sehingga
 * perubahan saringan tidak pernah menulis ulang path detail.
 * @param pathDasar  mis. "/warehouse/goods-receipt"
 * @param kunci      nama parameter yang dikelola, mis. ["tahap", "q"]
 */
export function useFilterDaftar(pathDasar, kunci) {
  const [sp] = useSearchParams(); const { replaceActivePath } = useTabs();
  const [nilai, setNilai] = useState(() => Object.fromEntries(kunci.map((k) => [k, sp.get(k) ?? ""])));
  const terbaru = useRef(nilai); terbaru.current = nilai;
  const ubahBanyak = useCallback((perubahan) => {
    const baru = { ...terbaru.current, ...perubahan }; terbaru.current = baru; setNilai(baru);
    const qs = kunci.filter((x) => baru[x]).map((x) => `${x}=${encodeURIComponent(baru[x])}`).join("&");
    replaceActivePath(qs ? `${pathDasar}?${qs}` : pathDasar);
  }, [pathDasar, kunci, replaceActivePath]); // eslint-disable-line react-hooks/exhaustive-deps -- `kunci` konstan per pemanggil
  const ubah = useCallback((k, v) => ubahBanyak({ [k]: v }), [ubahBanyak]);
  return [nilai, ubah, ubahBanyak];
}

/** Query saringan saat ini → string "?a=b" untuk dilampirkan ke path detail (agar saringan ikut tersimpan di URL jendela). */
export const querySaringan = (nilai, kunci) => { const qs = kunci.filter((k) => nilai[k]).map((k) => `${k}=${encodeURIComponent(nilai[k])}`).join("&"); return qs ? `?${qs}` : ""; };
