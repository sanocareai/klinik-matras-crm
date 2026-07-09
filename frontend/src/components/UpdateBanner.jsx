// Banner "Versi baru tersedia" — muncul saat service worker sudah download update
// dan siap dipakai, tapi halaman belum di-reload untuk pakai versi baru.
//
// Alur:
//   1. Deploy baru → SW baru didownload di background (skipWaiting otomatis aktifkan)
//   2. needRefresh = true → banner muncul di bawah layar
//   3. User klik "Muat Ulang" → updateServiceWorker(true) → window.location.reload()
//   4. User klik × → banner tutup sampai app dibuka ulang
//
// Ini TIDAK mengganggu workflow — user tetap bisa kerja, banner tidak modal/blocking.
//
// virtual:pwa-register/react adalah virtual module dari vite-plugin-pwa.
// Di production: jalan normal. Di dev mode: no-op (needRefresh selalu false).

import React from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

export default function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // Tidak perlu tampilkan apapun kalau tidak ada update
  if (!needRefresh) return null;

  return (
    <div style={{
      position:   "fixed",
      bottom:     20,
      left:       "50%",
      transform:  "translateX(-50%)",
      zIndex:     9999,
      background: "#2563EB",
      color:      "#fff",
      borderRadius: 12,
      padding:    "10px 14px",
      display:    "flex",
      alignItems: "center",
      gap:        10,
      boxShadow:  "0 4px 24px rgba(15,23,42,0.25)",
      fontSize:   14,
      maxWidth:   "calc(100vw - 32px)",
      whiteSpace: "nowrap",
    }}>
      <RefreshCw size={15} style={{ flexShrink: 0, color: "#fff" }} />
      <span style={{ fontWeight: 500 }}>Versi baru tersedia</span>
      <button
        onClick={() => updateServiceWorker(true)}
        style={{
          background:   "#fff",
          color:        "#2563EB",
          border:       "none",
          borderRadius: 7,
          padding:      "5px 12px",
          cursor:       "pointer",
          fontWeight:   700,
          fontSize:     13,
          flexShrink:   0,
        }}
      >
        Muat Ulang
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        style={{
          background: "transparent",
          color:      "rgba(255,255,255,0.75)",
          border:     "none",
          cursor:     "pointer",
          padding:    "2px 4px",
          flexShrink: 0,
          display:    "flex",
          alignItems: "center",
        }}
        title="Tutup (muncul lagi saat buka app berikutnya)"
      >
        <X size={14} />
      </button>
    </div>
  );
}
