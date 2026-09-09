import React, { useState, useEffect, useMemo } from "react";
import { BrowserRouter } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { disconnectSocket } from "./lib/socket.js";
import { PAGES } from "./routes/pageRegistry.jsx";
import { TabsProvider } from "./lib/TabsContext.jsx";

// D-143 (9 September 2026) — daftar halaman (lazy import + path) dipindah ke
// routes/pageRegistry.jsx (satu sumber kebenaran, dipakai juga oleh sistem
// tab dalam-app). Path/props/perilaku TIDAK berubah, cuma sumbernya.
//
// D-144 — <Routes>/<Suspense>/<ChunkErrorBoundary> yang dulu ada LANGSUNG di
// sini SEKARANG per-tab, dipindah ke components/TabbedContent.jsx (dirender
// di dalam Layout) — supaya beberapa tab bisa tetap mounted bersamaan
// (keep-alive). App.jsx sekarang cuma menyalakan TabsProvider dengan PAGES +
// ctx (user, onUserUpdate), tidak lagi merender <Routes> sendiri.

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });
  const [sessionExpired, setSessionExpired] = useState(false);

  function handleLogin(u) {
    localStorage.setItem("user", JSON.stringify(u));
    setUser(u);
    setSessionExpired(false);
  }

  // Update SEBAGIAN data user yang sedang login (mis. avatarUrl setelah
  // ganti foto profil) — beda dari handleLogin yang mengganti seluruh objek
  // user saat login. Tanpa ini, halaman yang menyimpan foto baru (mis.
  // Pengaturan.jsx) tidak punya jalan mengabarkan App.jsx supaya sidebar
  // (yang baca `user` dari state di sini, bukan localStorage langsung)
  // langsung ikut berubah tanpa perlu reload halaman.
  function handleUserUpdate(patch) {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("user", JSON.stringify(next));
      return next;
    });
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    disconnectSocket();
    setUser(null);
    setSessionExpired(false);
  }

  // Tangkap event 401 dari api.js — tampilkan modal tanpa hard reload
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener("auth-error", handler);
    return () => window.removeEventListener("auth-error", handler);
  }, []);

  // BUG FIX — tombol "Login Kembali" SEBELUMNYA cuma setSessionExpired(false),
  // yang cuma menyembunyikan modal (Login sudah tampil di baliknya via
  // `!user`, jadi SECARA VISUAL kelihatan "tidak melakukan apa-apa"). Kalau
  // browser sedang menjalankan bundle JS BASI dari service worker (Bug 1
  // utama — SW gagal update), tombol ini jadi satu-satunya jalan keluar user
  // dari versi lama itu. Sekarang: bersihkan semua state SISI KLIEN + PAKSA
  // reload penuh dari network (bukan SPA navigate) — supaya user pasti dapat
  // bundle TERBARU, bukan terus jalan di versi lama yang sama.
  async function handleForceRelogin() {
    try {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
    } catch {}

    // Unregister SW + hapus cache — best-effort, JANGAN sampai gagal disini
    // membuat redirect di bawah tidak jalan (makanya di-wrap try/catch
    // terpisah dari redirect, bukan di-chain .then yang bisa reject diam-diam).
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {}
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    // Hard redirect (BUKAN setSessionExpired/SPA state) — paksa browser
    // fetch index.html + bundle baru dari network dari nol.
    window.location.href = "/login";
  }

  // Refresh SSE dan data saat app kembali ke foreground (relevan untuk APK Capacitor / tab kembali aktif)
  useEffect(() => {
    if (!user) return;
    const handler = () => {
      if (document.visibilityState === "visible") {
        // Kirim custom event ke komponen yang perlu refresh — komponen listen sendiri kalau mau
        window.dispatchEvent(new CustomEvent("app-visible"));
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [user]);

  // Dimemo supaya identitas objek stabil antar render App yang tidak
  // mengubah user — TabsProvider taruh `ctx` di dependency array useMemo-nya,
  // objek baru tiap render App akan bikin context tab ikut render ulang
  // sia-sia setiap kali (mis. tiap tick usePolling di halaman lain).
  const tabsCtx = useMemo(() => ({ user, onUserUpdate: handleUserUpdate }), [user]);

  if (!user || sessionExpired) {
    return (
      <>
        <Login onLogin={handleLogin} />
        {/* Modal sesi berakhir — sekarang lewat primitive Modal (aksesibel).
            Tidak bisa ditutup selain lewat "Login Kembali" (onOpenChange no-op,
            showClose false), sama seperti perilaku sebelumnya. Aksi tetap
            handleForceRelogin (unregister SW + clear cache + hard reload). */}
        <Modal
          open={sessionExpired}
          onOpenChange={() => {}}
          showClose={false}
          className="w-[340px] text-center"
        >
          <div className="mb-3 text-[40px]">⏰</div>
          <h3 className="mb-2 text-[17px] font-bold text-ink">Sesi Berakhir</h3>
          <p className="mb-5 text-sm text-ink2">
            Login Anda sudah kadaluarsa. Silakan login kembali untuk melanjutkan.
          </p>
          <Button className="w-full" onClick={handleForceRelogin}>
            Login Kembali
          </Button>
        </Modal>
      </>
    );
  }

  return (
    <BrowserRouter>
      <InstallPrompt />
      <UpdateBanner />
      {/* Floating "Tanya Sano" (CoPilotFloat) DIHAPUS — sudah ada akses lewat
          sidebar (AI & OTOMASI > Tanya Sano), FAB ini jadi redundan. */}
      <TabsProvider pages={PAGES} ctx={tabsCtx}>
        <Layout user={user} onLogout={handleLogout} />
      </TabsProvider>
    </BrowserRouter>
  );
}
