import React, { useEffect, useState } from "react";
import { api } from "@/api.js";

// FOTO NOTA TERLINDUNGI.
//
// /media/finance-receipts/* tidak lagi publik: browser tidak bisa mengirim
// header Authorization lewat <img src>/<a href>, jadi sebelum ditampilkan URL
// foto ditukar dengan URL bertanda-tangan berumur ±10 menit lewat
// POST /api/finance/media/sign. Permintaan digabung (satu panggilan untuk
// semua foto di layar) dan hasilnya di-cache sampai mendekati kedaluwarsa.
// URL yang BUKAN foto nota finance (mis. bukti pembayaran lama) dipakai apa adanya.

const PREFIX = "/media/finance-receipts/";
const cache = new Map(); // url → { url, thumbUrl, expMs }
const antre = new Map(); // url → [resolve, ...]
let jadwal = null;

export function adalahFotoNotaFinance(url) {
  return typeof url === "string" && url.startsWith(PREFIX);
}

async function kirimAntrean() {
  jadwal = null;
  const ambil = new Map(antre);
  antre.clear();
  const daftar = [...ambil.keys()];
  let hasil = {};
  try {
    hasil = (await api.signFinanceMedia(daftar)).signed || {};
  } catch {
    hasil = {};
  }
  for (const [url, resolvers] of ambil) {
    const s = hasil[url] || null;
    if (s) cache.set(url, { url: s.url, thumbUrl: s.thumbUrl, expMs: new Date(s.expiresAt).getTime() });
    resolvers.forEach((r) => r(s ? { url: s.url, thumbUrl: s.thumbUrl } : null));
  }
}

/** Kembalikan { url, thumbUrl } bertanda-tangan, atau null bila tak berhak/gagal. */
export function ambilUrlBertanda(url) {
  if (!adalahFotoNotaFinance(url)) return Promise.resolve({ url, thumbUrl: url.replace(/\.jpg$/, "_t.jpg") });
  const c = cache.get(url);
  if (c && c.expMs - Date.now() > 60_000) return Promise.resolve({ url: c.url, thumbUrl: c.thumbUrl });
  return new Promise((resolve) => {
    const list = antre.get(url) || [];
    list.push(resolve);
    antre.set(url, list);
    if (!jadwal) jadwal = setTimeout(kirimAntrean, 30);
  });
}

/** Hook: URL bertanda-tangan untuk satu foto (null selama dimuat / bila ditolak). */
export function useUrlBukti(url) {
  const [hasil, setHasil] = useState(() => {
    if (!url) return null;
    if (!adalahFotoNotaFinance(url)) return { url, thumbUrl: url.replace(/\.jpg$/, "_t.jpg") };
    const c = cache.get(url);
    return c && c.expMs - Date.now() > 60_000 ? { url: c.url, thumbUrl: c.thumbUrl } : null;
  });
  useEffect(() => {
    let batal = false;
    if (!url) { setHasil(null); return undefined; }
    ambilUrlBertanda(url).then((h) => { if (!batal) setHasil(h); });
    return () => { batal = true; };
  }, [url]);
  return hasil;
}

/** Tautan ke foto penuh (tab baru). Menunggu URL bertanda-tangan siap. */
export function LinkBukti({ url, className, children }) {
  const h = useUrlBukti(url);
  if (!h) return <span className={className}>{children}</span>;
  return <a href={h.url} target="_blank" rel="noreferrer" className={className}>{children}</a>;
}
