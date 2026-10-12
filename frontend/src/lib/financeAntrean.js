// Antrean pekerjaan Finance untuk badge navigasi — memakai angka yang SUDAH disediakan server (GET /finance/dashboard → antrean).
// Tidak ada hitungan baru di klien: modul ini hanya memuat sekali (cache bersama + penyegaran berkala) dan membagikannya ke sidebar & bilah hub.
// Gagal (mis. 403 untuk peran tanpa finance:read) = tanpa badge, bukan galat di layar.
import { useEffect, useState } from "react";
import { api } from "@/api.js";

const TTL_MS = 60_000;
const SEGARKAN_MS = 180_000;
let cache = { antrean: null, at: 0, inflight: null };
const pelanggan = new Set();

export async function muatAntreanFinance({ paksa = false } = {}) {
  const baru = Date.now() - cache.at < TTL_MS;
  if (!paksa && baru && cache.antrean) return cache.antrean;
  if (cache.inflight) return cache.inflight;
  cache.inflight = (async () => {
    try {
      const d = await api.getFinanceDashboard();
      cache = { antrean: d?.antrean ?? null, at: Date.now(), inflight: null };
    } catch {
      cache = { ...cache, at: Date.now(), inflight: null }; // tanpa badge; coba lagi pada interval berikutnya
    }
    pelanggan.forEach((fn) => fn(cache.antrean));
    return cache.antrean;
  })();
  return cache.inflight;
}

/** Antrean server (objek `antrean` dashboard) atau null. `aktif=false` = tidak memuat apa pun. */
export function useAntreanFinance(aktif = true) {
  const [antrean, setAntrean] = useState(cache.antrean);
  useEffect(() => {
    if (!aktif) return undefined;
    pelanggan.add(setAntrean);
    muatAntreanFinance();
    const id = setInterval(() => muatAntreanFinance({ paksa: true }), SEGARKAN_MS);
    return () => { pelanggan.delete(setAntrean); clearInterval(id); };
  }, [aktif]);
  return antrean;
}
