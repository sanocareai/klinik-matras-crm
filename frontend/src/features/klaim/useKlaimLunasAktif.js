import { useEffect, useState } from "react";
import { api } from "@/api.js";

// Sakelar rollout gerbang Klaim Lunas (server: fin_settings klaim_lunas_gate_aktif, default MATI). MATI → UI lama persis; NYALA → klaim berbukti.
// Dibaca SEKALI per sesi halaman (cache modul). Gagal membaca = dianggap MATI (UI lama tetap bekerja; server tetap penegak sebenarnya).
let cache = null;
let inflight = null;

export function muatUlangKlaimLunasAktif() { cache = null; inflight = null; }

/** true | false | null (masih memuat). */
export function useKlaimLunasAktif() {
  const [v, setV] = useState(cache);
  useEffect(() => {
    if (cache !== null) { setV(cache); return undefined; }
    let batal = false;
    if (!inflight) inflight = api.getKlaimLunasStatus().then((r) => !!r?.aktif).catch(() => false).then((x) => { cache = x; return x; });
    inflight.then((x) => { if (!batal) setV(x); });
    return () => { batal = true; };
  }, []);
  return v;
}
