import React, { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";
import CoPilotFloat from "./components/CoPilotFloat.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { disconnectSocket } from "./lib/socket.js";

// Fase G — code splitting: tiap halaman jadi chunk terpisah, cuma di-load
// saat route-nya benar-benar dibuka (bukan semua halaman ikut initial bundle
// login/Dashboard). Ini leverage terbesar untuk turunkan ukuran bundle awal —
// CRM ini punya 12 halaman fitur penuh (termasuk chart library recharts/
// framer-motion di Dashboard, react-virtuoso/emoji-mart/lightbox di Inbox),
// tidak mungkin semua "gratis" masuk initial load kalau mau di bawah 350KB gzip.
const Dashboard     = lazy(() => import("./pages/Dashboard.jsx"));
const Inbox         = lazy(() => import("./pages/Inbox.jsx"));
const Customers     = lazy(() => import("./pages/Customers.jsx"));
const Pipeline      = lazy(() => import("./pages/Pipeline.jsx"));
const Broadcast     = lazy(() => import("./pages/Broadcast.jsx"));
const Automation    = lazy(() => import("./pages/Automation.jsx"));
const Laporan       = lazy(() => import("./pages/Laporan.jsx"));
const Pengaturan    = lazy(() => import("./pages/Pengaturan.jsx"));
const Pengguna      = lazy(() => import("./pages/Pengguna.jsx"));
const Products      = lazy(() => import("./pages/Products.jsx"));
const TrackingLinks = lazy(() => import("./pages/TrackingLinks.jsx"));
const CoPilot       = lazy(() => import("./pages/CoPilot.jsx"));

// Fallback ringan saat chunk halaman sedang di-download — konsisten dengan
// pola skeleton yang sudah dipakai di seluruh app.
function RouteFallback() {
  return (
    <div className="page-loading">
      <div className="skeleton skeleton-card" style={{ maxWidth: 400, margin: "0 auto" }} />
    </div>
  );
}

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
          <h3 className="mb-2 text-[17px] font-bold text-slate-900">Sesi Berakhir</h3>
          <p className="mb-5 text-sm text-slate-500">
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
      <CoPilotFloat />
      <Layout user={user} onLogout={handleLogout}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/"            element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"   element={<Dashboard user={user} />} />
            <Route path="/inbox"       element={<Inbox user={user} />} />
            <Route path="/customers"   element={<Customers />} />
            <Route path="/pipeline"    element={<Pipeline />} />
            <Route path="/broadcast"   element={<Broadcast />} />
            <Route path="/automation"  element={<Automation />} />
            <Route path="/laporan"     element={<Laporan />} />
            <Route path="/pengaturan"  element={<Pengaturan user={user} />} />
            <Route path="/pengguna"    element={<Pengguna user={user} />} />
            <Route path="/products"    element={<Products />} />
            <Route path="/tracking"    element={<TrackingLinks />} />
            <Route path="/copilot"     element={<CoPilot />} />
            <Route path="*"            element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
