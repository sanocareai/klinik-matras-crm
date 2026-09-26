import { useEffect, useState } from "react";
import { api } from "@/api.js";

// Apakah fitur Resi Gabungan (Fase 1) aktif? Sumber kebenaran = server (RESI_INPUT_AKTIF); ini HANYA untuk menampilkan/menyembunyikan UI —
// POST /api/resi tetap menolak 403 bila mati. Gagal membaca = dianggap MATI (UI tidak muncul).
let cache = null;
export function useResiAktif() {
  const [aktif, setAktif] = useState(cache ?? false);
  useEffect(() => {
    let batal = false;
    if (cache !== null) return undefined;
    api.getResiStatus().then((r) => { cache = !!r?.aktif; if (!batal) setAktif(cache); }).catch(() => { if (!batal) setAktif(false); });
    return () => { batal = true; };
  }, []);
  return aktif;
}
