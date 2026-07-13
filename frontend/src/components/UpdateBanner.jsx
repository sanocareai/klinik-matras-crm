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

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 jam

export default function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // Tanpa ini, SW cuma dicek ulang browser saat navigasi/reload halaman —
    // sales/admin yang biasa buka CRM ini di 1 tab terus-menerus SEHARIAN
    // tanpa pernah reload manual TIDAK AKAN pernah lihat banner update
    // sampai mereka kebetulan reload sendiri, padahal tujuan autoUpdate
    // justru supaya tidak perlu itu. Polling registration.update() tiap
    // jam selama tab terbuka memastikan SW baru terdeteksi & banner ini
    // muncul walau tab tidak pernah ditutup/direfresh.
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      setInterval(() => {
        registration.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

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
