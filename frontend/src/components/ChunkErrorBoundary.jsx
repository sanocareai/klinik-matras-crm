import React from "react";

// Bug yang diperbaiki (20 Agt 2026): tiap deploy frontend mengganti nama file
// chunk per halaman (Customers-leQT-YtC.js → Customers-BRi1t8F1.js, dst — lihat
// catatan "frontend/dist bind mount" di CLAUDE.md §12). Tab yang SUDAH terbuka
// sebelum deploy masih pegang referensi chunk LAMA di memori — begitu user
// klik halaman lazy-load (App.jsx, semua page via React.lazy) yang belum
// pernah dibuka di tab itu, import() 404 karena file lama sudah tidak ada di
// server. Sebelum ini TIDAK ADA boundary yang menangkap error itu, jadi React
// unmount SELURUH tree sampai ke root — hasilnya "blank hitam" (body kosong,
// --bg-base gelap saat dark mode). Fix: tangkap khusus error chunk-load, lalu
// PAKSA reload penuh (bukan retry render biasa — retry render akan gagal
// identik karena chunk lama memang sudah tidak ada).
//
// ⚠️ DIPERBAIKI LAGI 14 September 2026 (laporan owner: "buka tracking delivery
// glitch seperti ini dan memuat versi baru terus", juga di Route Planner).
// Penjagaan anti-loop versi pertama (flag sessionStorage yang DIHAPUS di
// componentDidMount) TERNYATA BISA DIKALAHKAN: boundary ini mount dengan
// SUKSES di tiap load (shell App.jsx sendiri memang selalu berhasil dimuat),
// jadi flag-nya selalu bersih lagi — padahal sistem tab dalam-app (D-144)
// MENGEMBALIKAN tab yang tadi terbuka (mis. "Tracking") begitu halaman
// selesai load, yang LANGSUNG memicu import chunk gagal yang sama. Hasilnya:
// gagal → reload → tab dipulihkan → gagal → reload … tanpa henti.
//
// Dua perubahan supaya loop jadi MUSTAHIL, bukan cuma "jarang":
// 1. Penjagaan berbasis WAKTU (bukan flag yang bisa dibersihkan) — auto-reload
//    paling cepat sekali per COOLDOWN_MS. Deploy berikutnya tetap dapat
//    auto-reload gratis karena cap waktunya sudah kedaluwarsa sendiri.
// 2. Sebelum reload, cache & service worker DIBERSIHKAN dulu. Reload polos
//    TIDAK menolong kalau shell index.html-nya sendiri yang basi (dilayani
//    dari precache service worker) — yang terjadi justru memuat ulang
//    index.html basi yang sama, menunjuk chunk lama yang sama. Ini alasan
//    sebenarnya kenapa layar "Memuat versi terbaru…" bisa muncul terus.
const RELOAD_AT = "sanss-chunk-reload-at";
const COOLDOWN_MS = 30_000;

function isChunkLoadError(error) {
  const msg = String(error?.message || error || "");
  // "expected a javascript module script" = kasus shell basi menunjuk chunk
  // yang sudah tidak ada, DAN server lama membalasnya dengan index.html
  // (text/html) alih-alih 404 — sisi server sudah diperbaiki juga, tapi pola
  // ini tetap dikenali supaya klien yang terlanjur basi ikut tertolong.
  return /dynamically imported module|failed to fetch|loading chunk|chunkloaderror|expected a javascript module script|module script failed/i.test(msg);
}

function bacaWaktuReloadTerakhir() {
  try {
    return Number(sessionStorage.getItem(RELOAD_AT)) || 0;
  } catch {
    return 0;
  }
}

// Buang SEMUA cache (precache Workbox + runtime) lalu lepas service worker,
// baru reload. Tanpa ini, reload cuma mengambil shell basi yang sama dari
// service worker lama. SW akan mendaftar ulang sendiri di load berikutnya —
// jadi PWA/offline TIDAK hilang permanen, cuma di-reset sekali untuk pulih.
async function bersihkanLaluReload() {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {}
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.unregister()));
  } catch {}
  window.location.reload();
}

export default class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, chunk: false, menyerah: false };
  }

  static getDerivedStateFromError(error) {
    const chunk = isChunkLoadError(error);
    // `menyerah` = sudah pernah auto-reload barusan tapi MASIH gagal. Jangan
    // reload lagi — tampilkan jalan keluar manual, jangan kurung user di
    // layar yang berkedip terus.
    const menyerah = chunk && Date.now() - bacaWaktuReloadTerakhir() < COOLDOWN_MS;
    return { hasError: true, chunk, menyerah };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error) && !this.state.menyerah) {
      try { sessionStorage.setItem(RELOAD_AT, String(Date.now())); } catch {}
      bersihkanLaluReload();
      return;
    }
    console.error("[ChunkErrorBoundary]", error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const { chunk, menyerah } = this.state;
    const judul = !chunk
      ? "Terjadi kesalahan saat memuat halaman ini."
      : menyerah
        ? "Gagal memuat versi terbaru."
        : "Memuat versi terbaru…";
    const keterangan = !chunk
      ? "Coba refresh browser. Data Anda aman."
      : menyerah
        ? "Halaman ini masih memakai file versi lama yang sudah tidak ada di server. Tekan tombol di bawah untuk memuat ulang bersih. Data Anda aman."
        : "Ada pembaruan aplikasi — sedang memuat ulang otomatis.";

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "64px 16px", textAlign: "center" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{judul}</p>
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", maxWidth: 360 }}>{keterangan}</p>
        {chunk && menyerah && (
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem(RELOAD_AT); } catch {}
              bersihkanLaluReload();
            }}
            style={{
              marginTop: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600,
              color: "#fff", background: "var(--primary, #2563eb)",
              border: "none", borderRadius: 8, cursor: "pointer",
            }}
          >
            Muat ulang bersih
          </button>
        )}
      </div>
    );
  }
}
