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
const RELOAD_FLAG = "sanss-chunk-reload-attempted";

function isChunkLoadError(error) {
  const msg = String(error?.message || error || "");
  return /dynamically imported module|failed to fetch|loading chunk|chunkloaderror/i.test(msg);
}

export default class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  // Boundary ini dipasang SEKALI di root (bukan di-remount tiap navigasi) —
  // mount pertama menandakan shell App.jsx sendiri berhasil dimuat dari
  // network, jadi flag lama boleh dibersihkan supaya deploy BERIKUTNYA (di
  // sesi browser yang sama) tetap dapat 1 kesempatan auto-reload lagi.
  componentDidMount() {
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch {}
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, chunk: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    if (isChunkLoadError(error)) {
      let alreadyTried = false;
      try { alreadyTried = sessionStorage.getItem(RELOAD_FLAG) === "1"; } catch {}
      if (!alreadyTried) {
        try { sessionStorage.setItem(RELOAD_FLAG, "1"); } catch {}
        window.location.reload();
        return;
      }
    }
    console.error("[ChunkErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "64px 16px", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            {this.state.chunk ? "Memuat versi terbaru…" : "Terjadi kesalahan saat memuat halaman ini."}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", maxWidth: 360 }}>
            {this.state.chunk
              ? "Ada pembaruan aplikasi — sedang memuat ulang otomatis."
              : "Coba refresh browser. Data Anda aman."}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
