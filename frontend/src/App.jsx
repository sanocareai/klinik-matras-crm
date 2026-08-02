import React, { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";
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
const Orders        = lazy(() => import("./pages/Orders.jsx"));
const Broadcast     = lazy(() => import("./pages/Broadcast.jsx"));
const Automation    = lazy(() => import("./pages/Automation.jsx"));
const Laporan       = lazy(() => import("./pages/Laporan.jsx"));
const Pengaturan    = lazy(() => import("./pages/Pengaturan.jsx"));
const Pengguna      = lazy(() => import("./pages/Pengguna.jsx"));
const Products      = lazy(() => import("./pages/Products.jsx"));
const TrackingLinks = lazy(() => import("./pages/TrackingLinks.jsx"));
const CoPilot       = lazy(() => import("./pages/CoPilot.jsx"));
const Portal        = lazy(() => import("./pages/Portal.jsx"));
const DivisionPage  = lazy(() => import("./pages/DivisionPage.jsx"));
const Notifications = lazy(() => import("./pages/Notifications.jsx"));
const Bengkel       = lazy(() => import("./pages/Bengkel.jsx"));
const Armada        = lazy(() => import("./pages/Armada.jsx"));
const ArmadaDashboard   = lazy(() => import("./pages/armada/ArmadaDashboard.jsx"));
const ArmadaPlaceholder = lazy(() => import("./pages/armada/ArmadaPlaceholder.jsx"));
const Kendali        = lazy(() => import("./pages/Kendali.jsx"));
const Gudang         = lazy(() => import("./pages/Gudang.jsx"));

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
      <Layout user={user} onLogout={handleLogout}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Landing sekarang /portal (Gilang, 31 Juli 2026) — Bengkel punya
                isi nyata (Papan Produksi Harian). AMAN untuk 5 sales existing:
                role tunggal auto-skip ke satu-satunya portalnya (Growth =
                /dashboard) tanpa melihat layar pemilih — lihat Portal.jsx. */}
            <Route path="/"            element={<Navigate to="/portal" replace />} />
            <Route path="/portal"      element={<Portal />} />
            {/* Command center per divisi (1 Agustus 2026) — perhentian ANTARA
                kartu Portal dan halaman kerja asli. Role tunggal (5 sales)
                TIDAK PERNAH lewat sini — Portal.jsx auto-skip langsung ke
                portals[0].path untuk mereka, PRD §4. */}
            <Route path="/portal/:key" element={<DivisionPage user={user} />} />
            <Route path="/bengkel"     element={<Bengkel />} />
            {/* ── DELIVERY & FULFILLMENT (Tahap 1) ─────────────────────────
                /armada TETAP HIDUP sebagai redirect — masih dirujuk PORTALS di
                backend (constants/permissions.js) dan divisionContent.js;
                menghapusnya akan memutus kartu Portal & command center.

                /armada/jobs memakai <Armada /> APA ADANYA. Halaman itu sudah
                tersambung ke 19 endpoint NYATA (siklus job, upload foto bukti,
                urutan rute, pencatatan pembayaran, antrean offline driver).
                Tahap 1 TIDAK menyentuhnya — menggantinya dengan data dummy
                akan jadi REGRESI fungsional, bukan penambahan.

                Tujuh route sisanya memakai placeholder yang menyebut tahap
                keberapa halamannya datang. Sidebar menampilkan sembilan menu
                sekaligus, jadi menu yang menghasilkan 404 akan terbaca sebagai
                sistem rusak. */}
            <Route path="/armada"           element={<Navigate to="/armada/dashboard" replace />} />
            <Route path="/armada/dashboard" element={<ArmadaDashboard />} />
            <Route path="/armada/jobs"      element={<Armada />} />
            <Route
              path="/armada/routes"
              element={
                <ArmadaPlaceholder
                  title="Route Planner"
                  subtitle="Kelompokkan job ke dalam rute, atur urutan stop, dan tetapkan driver."
                  stage={3}
                  description="Perencanaan rute bergantung pada entitas Vehicle & Route yang belum ada di database — lihat risiko R3 pada laporan audit."
                />
              }
            />
            <Route
              path="/armada/tracking"
              element={
                <ArmadaPlaceholder
                  title="Live Tracking"
                  subtitle="Pantau posisi armada dan status perjalanan secara langsung."
                  stage={4}
                  description="Peta dan panel job aktif dibangun setelah Route Planner siap."
                />
              }
            />
            <Route
              path="/armada/resources"
              element={
                <ArmadaPlaceholder
                  title="Driver & Armada"
                  subtitle="Kelola data driver, kendaraan, dan ketersediaannya."
                  stage={3}
                  description="Tab Armada membutuhkan entitas Vehicle di database, yang belum ada."
                />
              }
            />
            <Route
              path="/armada/pod"
              element={
                <ArmadaPlaceholder
                  title="Proof of Delivery"
                  subtitle="Verifikasi foto, tanda tangan, dan checklist penyelesaian job."
                  stage={4}
                  description="Pengambilan foto & tanda tangan SUDAH berjalan di aplikasi driver. Halaman ini menjadi sisi verifikasinya, bukan sumber data baru."
                />
              }
            />
            <Route
              path="/armada/issues"
              element={
                <ArmadaPlaceholder
                  title="Kendala & Reschedule"
                  subtitle="Tangani job bermasalah, jadwalkan ulang, dan eskalasi."
                  stage={5}
                  description="Job gagal beserta alasan dan fotonya sudah direkam backend hari ini."
                />
              }
            />
            <Route
              path="/armada/returns"
              element={
                <ArmadaPlaceholder
                  title="Retur"
                  subtitle="Kelola pengambilan kembali produk dan pemeriksaan di gudang."
                  stage={5}
                  description="Alur retur menyambung ke modul Warehouse."
                />
              }
            />
            <Route
              path="/armada/reports"
              element={
                <ArmadaPlaceholder
                  title="Laporan Delivery"
                  subtitle="Performa pengiriman, ketepatan waktu, dan produktivitas armada."
                  stage={6}
                  description="Laporan menunggu data operasional nyata terkumpul lebih dulu."
                />
              }
            />
            <Route path="/kendali"     element={<Kendali />} />
            <Route path="/gudang"      element={<Gudang />} />
            <Route path="/dashboard"   element={<Dashboard user={user} />} />
            <Route path="/inbox"       element={<Inbox user={user} />} />
            <Route path="/customers"   element={<Customers />} />
            <Route path="/pipeline"    element={<Pipeline />} />
            <Route path="/orders"      element={<Orders />} />
            <Route path="/broadcast"   element={<Broadcast />} />
            <Route path="/automation"  element={<Automation />} />
            <Route path="/laporan"     element={<Laporan />} />
            <Route path="/pengaturan"  element={<Pengaturan user={user} />} />
            <Route path="/pengguna"    element={<Pengguna user={user} />} />
            <Route path="/products"    element={<Products />} />
            <Route path="/tracking"    element={<TrackingLinks />} />
            <Route path="/copilot"     element={<CoPilot />} />
            {/* Notification Center — kejadian LINTAS workspace. Sengaja BUKAN
                di bawah /inbox: Inbox khusus percakapan pelanggan (#26/#27). */}
            <Route path="/notifications" element={<Notifications />} />
            <Route path="*"            element={<Navigate to="/portal" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
