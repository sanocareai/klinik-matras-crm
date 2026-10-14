// Apakah gerbang konfirmasi muat DITEGAKKAN untuk perangkat ini? Dibaca dari server (GET /armada/unit-load/config) dan di-cache supaya tetap tahu saat offline.
// Default false (tidak mewajibkan di layar) bila belum pernah berhasil dibaca — server tetap penentu; bila menolak, item antrean diblokir dengan pesan yang jelas.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../api";

const KUNCI = "unit-load-gate:v1";

export function useUnitLoadGate() {
  const [aktif, setAktif] = useState(false);
  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const cache = await AsyncStorage.getItem(KUNCI);
        if (cache && !batal) setAktif(cache === "1");
      } catch { /* abaikan */ }
      try {
        const cfg = await api.getUnitLoadConfig();
        const nilai = Boolean(cfg?.ditegakkanUntukKlienIni);
        if (!batal) setAktif(nilai);
        await AsyncStorage.setItem(KUNCI, nilai ? "1" : "0");
      } catch { /* offline: pakai cache */ }
    })();
    return () => { batal = true; };
  }, []);
  return aktif;
}
