// Web Push subscribe (8 September 2026) — permintaan owner: driver dapat
// notifikasi begitu ditugaskan job baru (referensi Lalamove/Gojek, TETAP
// PWA). Dipakai HANYA oleh DriverJobs.jsx — sama semangatnya dengan
// useDriverTracking.js: TIDAK PERNAH minta izin apa pun kalau browser tidak
// dukung Push API (Safari iOS lama, dsb), silent-fail, jangan blokir halaman
// buat driver yang HP-nya kebetulan tidak dukung.
import { useEffect } from "react";
import { api } from "../api.js";

// Konversi base64url (format VAPID public key) -> Uint8Array — Push API
// (`applicationServerKey`) butuh ArrayBuffer/Uint8Array, bukan string.
// Fungsi standar dari dokumentasi web-push, tidak ada library resmi untuk
// ini (terlalu kecil untuk butuh dependency baru).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function usePushSubscription() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return; // browser tidak dukung — diam-diam skip

    let cancelled = false;
    async function subscribe() {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted" || cancelled) return;

        const registration = await navigator.serviceWorker.ready;
        let sub = await registration.pushManager.getSubscription();
        if (!sub) {
          const { publicKey } = await api.getVapidPublicKey();
          sub = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        if (cancelled) return;
        await api.subscribePush(sub.toJSON());
      } catch (err) {
        // Best-effort murni — driver tetap bisa kerja tanpa push, cuma tidak
        // dapat alert. Jangan ganggu halaman dengan error di sini.
        console.error("[usePushSubscription] Gagal subscribe:", err.message);
      }
    }
    subscribe();
    return () => { cancelled = true; };
  }, []);
}
