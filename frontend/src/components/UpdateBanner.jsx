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
// ⚠️ AUTO-RELOAD SAAT APP DI-BACKGROUND (ditambahkan 6 Sep 2026). Masalah nyata
// yang berulang: fix sudah dide­ploy, tapi user PWA di HP masih lihat versi lama
// karena tab PWA yang sudah terbuka TIDAK pernah reload sendiri — `autoUpdate`
// vite-plugin-pwa cuma meng-ACTIVATE SW baru (skipWaiting/clientsClaim), bukan
// me-reload halaman. Dua kali dalam satu sesi sebuah perbaikan "kelihatan tidak
// jalan" di HP owner semata-mata karena ini. Sekarang: kalau update terdeteksi
// SEMENTARA app sedang tidak dilihat (`visibilityState === "hidden"` — user
// pindah app / kunci layar), langsung reload diam-diam di situ juga, jadi begitu
// dibuka lagi sudah versi baru. TIDAK PERNAH auto-reload saat app terlihat/aktif
// (itu bisa buang draft chat yang belum terkirim) — di kondisi itu tetap pakai
// banner manual seperti sebelumnya.
//
// virtual:pwa-register/react adalah virtual module dari vite-plugin-pwa.
// Di production: jalan normal. Di dev mode: no-op (needRefresh selalu false).

import React, { useEffect, useRef } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";

// Turun dari 60 menit → 20 menit. Trade-off-nya cuma 3 HEAD request /jam per tab
// (registration.update() tidak menarik ulang bundle, cuma cek sw.js) — murah,
// dan memangkas jendela "masih versi lama" dari maks 1 jam jadi maks 20 menit.
const UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000;

export default function UpdateBanner() {
  const registrationRef = useRef(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;
      registrationRef.current = registration;

      // Tanpa ini, SW cuma dicek ulang browser saat navigasi/reload halaman —
      // sales/admin yang biasa buka CRM ini di 1 tab terus-menerus SEHARIAN
      // tanpa pernah reload manual TIDAK AKAN pernah lihat banner update
      // sampai mereka kebetulan reload sendiri.
      setInterval(() => {
        registration.update().catch(() => {});
      }, UPDATE_CHECK_INTERVAL_MS);
    },
  });

  // Begitu app kembali TERLIHAT, paksa cek SW baru sekali (jangan nunggu tick
  // interval berikutnya) — momen paling sering user "baru buka lagi setelah
  // deploy". Kalau ternyata ada update, `needRefresh` akan flip dan efek di
  // bawah yang menanganinya.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        registrationRef.current?.update().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Auto-reload HANYA saat app tidak dilihat. Kalau update sudah pending dan
  // user memindahkan app ke background (atau sudah di background saat update
  // terdeteksi), reload di situ — tidak ada yang hilang karena tidak ada
  // interaksi aktif, dan buka berikutnya langsung versi baru.
  useEffect(() => {
    if (!needRefresh) return;

    if (document.visibilityState === "hidden") {
      updateServiceWorker(true);
      return;
    }
    function onHide() {
      if (document.visibilityState === "hidden") updateServiceWorker(true);
    }
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [needRefresh, updateServiceWorker]);

  // Tidak perlu tampilkan apapun kalau tidak ada update
  if (!needRefresh) return null;

  return (
    <div style={{
      position:   "fixed",
      bottom:     "max(20px, env(safe-area-inset-bottom))",
      left:       "50%",
      transform:  "translateX(-50%)",
      zIndex:     9999,
      background: "var(--color-primary, #2563EB)",
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
          color:        "var(--color-primary, #2563EB)",
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
