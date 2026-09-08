// Service worker CUSTOM (8 September 2026) — sebelumnya vite-plugin-pwa
// generateSW (Workbox auto-generate, TIDAK bisa disisipi event listener
// custom). Diganti ke strategi injectManifest supaya bisa tambah
// self.addEventListener("push", ...) untuk notifikasi driver (referensi
// Lalamove/Gojek, permintaan owner) — TETAP PWA, bukan app native.
//
// ⚠️ WAJIB reproduksi PERSIS 3 runtimeCaching rule yang SEBELUMNYA ada di
// vite.config.js (generateSW mode) — itu perbaikan bug NYATA (Bug 1a/1c,
// lihat catatan panjang lama di vite.config.js): NetworkFirst utk navigasi
// halaman (supaya user TIDAK terjebak index.html basi), NetworkOnly utk
// /api/ (data harus selalu fresh), CacheFirst utk static assets. Kalau ada
// yang berubah di sini, WAJIB ditest ulang (hard refresh + offline mode)
// sebelum deploy — regresi di sini pernah jadi sumber bug "UI dark lama"
// yang susah dilacak.
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, NetworkOnly, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

self.skipWaiting();
self.addEventListener("activate", () => self.clients.claim());
cleanupOutdatedCaches();

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({ cacheName: "html-shell", networkTimeoutSeconds: 3 })
);

registerRoute(/\/api\//, new NetworkOnly());

registerRoute(
  /\.(?:js|css|png|jpg|jpeg|svg|woff2?)$/,
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// ─── Push notification (8 September 2026) ──────────────────────────────────
// Payload dikirim backend sebagai JSON {title, body, url} — lihat
// services/pushNotifications.js. Best-effort parse: kalau payload bukan
// JSON (seharusnya tidak pernah terjadi, tapi jangan sampai SW crash kalau
// suatu hari ada pengirim push lain yang formatnya beda), fallback ke teks
// polos supaya notifikasi TETAP muncul, bukan diam-diam gagal total.
self.addEventListener("push", (event) => {
  let data = { title: "Klinik Matras", body: "Ada pembaruan job", url: "/armada/jobs" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/pwa-192x192.png",
      badge: "/pwa-192x192.png",
      data: { url: data.url },
    })
  );
});

// Klik notifikasi -> fokus tab yang sudah terbuka kalau ada (dan navigasi ke
// job terkait), atau buka tab baru kalau belum ada tab terbuka sama sekali.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/armada/jobs";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
