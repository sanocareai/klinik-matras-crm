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
const ArmadaJobs        = lazy(() => import("./pages/armada/ArmadaJobs.jsx"));
const ArmadaRoutes      = lazy(() => import("./pages/armada/ArmadaRoutes.jsx"));
const ArmadaResources   = lazy(() => import("./pages/armada/ArmadaResources.jsx"));
const ArmadaPod         = lazy(() => import("./pages/armada/ArmadaPod.jsx"));
const ArmadaTracking    = lazy(() => import("./pages/armada/ArmadaTracking.jsx"));
const ArmadaIssues      = lazy(() => import("./pages/armada/ArmadaIssues.jsx"));
const ArmadaReturns     = lazy(() => import("./pages/armada/ArmadaReturns.jsx"));
const ArmadaDeliveryReport = lazy(() => import("./pages/armada/ArmadaDeliveryReport.jsx"));
const ArmadaPlaceholder = lazy(() => import("./pages/armada/ArmadaPlaceholder.jsx"));
const Kendali        = lazy(() => import("./pages/Kendali.jsx"));
const Gudang         = lazy(() => import("./pages/Gudang.jsx"));
const WarehouseDashboard   = lazy(() => import("./pages/warehouse/WarehouseDashboard.jsx"));
const WarehouseInventory   = lazy(() => import("./pages/warehouse/WarehouseInventory.jsx"));
const WarehousePlaceholder = lazy(() => import("./pages/warehouse/WarehousePlaceholder.jsx"));

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
            {/* Tahap 2: halaman Jadwal & Penugasan membungkus <Armada /> —
                mode "Papan" di dalamnya merender halaman lama APA ADANYA
                (tempat job dibuat & driver ditugaskan, semuanya sudah jalan
                dengan backend nyata), mode "Daftar" adalah tabel berfilter
                yang baru. Menambah cara melihat, bukan mengganti cara kerja. */}
            <Route path="/armada/jobs"      element={<ArmadaJobs />} />
            {/* Tahap 3: Vehicle & Route sudah ada di database (migrasi
                20260802120000). Data NYATA — tidak ada badge "Contoh". */}
            <Route path="/armada/routes" element={<ArmadaRoutes />} />
            {/* SIMULASI, ditegaskan ketentuan — lihat catatan panjang di
                features/armada/data/trackingMock.js. Bukan "belum sempat
                dibuat nyata": driver belum pernah mengirim GPS sungguhan. */}
            <Route path="/armada/tracking" element={<ArmadaTracking />} />
            {/* Tab Armada: data nyata. Tab Driver: tipis, lihat catatan
                di ArmadaResources.jsx soal field yang belum ada di User. */}
            <Route path="/armada/resources" element={<ArmadaResources />} />
            {/* Sisi verifikasi atas foto/tanda tangan yang SUDAH diunggah
                driver sejak Phase 2 — data nyata, lihat ArmadaPod.jsx. */}
            <Route path="/armada/pod" element={<ArmadaPod />} />
            {/* Tahap 5: job GAGAL (failureReason + failurePhotoUrls sudah
                direkam driver sejak Phase 2) sekarang bisa dijadwalkan ulang
                lewat sini — sebelumnya jalan buntu. Data nyata, tidak ada
                badge "Contoh". Category/Priority/Reported By dari spesifikasi
                sengaja tidak dibangun, lihat catatan di ArmadaIssues.jsx. */}
            <Route path="/armada/issues" element={<ArmadaIssues />} />
            {/* Tahap 6: "Retur" BUKAN refund/replace/reject seperti asumsi
                spesifikasi awal — dikonfirmasi langsung ke Gilang. Kasur yang
                sudah diantar tapi teksturnya kurang pas (trial 7/30 hari)
                atau kena klaim garansi (10/20 tahun) dibawa kembali, direvisi,
                diantar ulang, diulang sampai customer bilang "yes". Model
                UnitRevision baru, lihat catatan panjang di schema.prisma. */}
            <Route path="/armada/returns" element={<ArmadaReturns />} />
            {/* Tahap 7: data nyata, bukan placeholder — tapi jobs MASIH KOSONG
                di production saat ini, jadi tiap chart akan tampil kosong
                sampai dispatcher benar-benar memakai modul ini. Lihat catatan
                panjang di ArmadaDeliveryReport.jsx. "Ketepatan waktu" dari
                spesifikasi TIDAK dibangun — timeWindow cuma teks bebas, tidak
                ada kolom target waktu terstruktur untuk dibandingkan. */}
            <Route path="/armada/reports" element={<ArmadaDeliveryReport />} />
            <Route path="/kendali"     element={<Kendali />} />
            {/* ── WAREHOUSE (Tahap 1, 2 Agustus 2026) ──────────────────────
                /gudang TIDAK di-redirect dan TIDAK diubah: ia satu-satunya
                halaman Warehouse berdata NYATA (ledger stock_movements) dan
                tetap dipakai sampai Tahap 2 menyambungkan struktur baru ke
                backend yang sama. Sidebar tetap benar di /gudang karena
                divisionFromPath() memetakan KEDUA prefiks ke "warehouse".
                Menu sidebar sekarang menunjuk /warehouse/*; /gudang dijangkau
                lewat tombol "Buka data nyata" di WarehouseInventory. */}
            <Route path="/gudang"      element={<Gudang />} />
            <Route path="/warehouse"   element={<Navigate to="/warehouse/dashboard" replace />} />
            <Route path="/warehouse/dashboard" element={<WarehouseDashboard />} />
            {/* Data CONTOH — lihat catatan di WarehouseInventory.jsx. Angka
                stok tetap TURUNAN (available = on hand − reserved), menjaga
                disiplin PRD §8.1 supaya Tahap 2 tinggal menukar sumber data. */}
            <Route path="/warehouse/inventory" element={<WarehouseInventory />} />
            <Route
              path="/warehouse/goods-receipt"
              element={
                <WarehousePlaceholder
                  title="Goods Receipt"
                  subtitle="Penerimaan barang dari supplier, produksi, atau retur."
                  phase={2}
                  description="Backend sudah punya pencatatan penerimaan (POST /inventory/movements/receipt) — Phase 2 membungkusnya jadi alur inspection & putaway."
                />
              }
            />
            <Route
              path="/warehouse/material-issue"
              element={
                <WarehousePlaceholder
                  title="Material Issue"
                  subtitle="Pengeluaran material untuk kebutuhan produksi."
                  phase={3}
                  description="Backend sudah bisa mengeluarkan material ke unit (POST /inventory/movements/issue) — Phase 3 menambah approval, picking, dan reservasi stok."
                />
              }
            />
            <Route
              path="/warehouse/transfers"
              element={
                <WarehousePlaceholder
                  title="Stock Transfer"
                  subtitle="Mutasi barang antar lokasi, rak, atau gudang."
                  phase={4}
                  description="Butuh entitas lokasi (Warehouse → Zone → Rack → Bin) lebih dulu; hari ini lokasi masih teks bebas di ledger."
                />
              }
            />
            <Route
              path="/warehouse/stock-count"
              element={
                <WarehousePlaceholder
                  title="Cycle Count & Stock Opname"
                  subtitle="Penghitungan stok berkala dan rekonsiliasi selisih."
                  phase={4}
                  description="Backend sudah mencatat hasil opname sebagai satu baris ADJUSTMENT (POST /inventory/movements/adjustment) — Phase 4 menambah penjadwalan, blind count, dan review selisih."
                />
              }
            />
            <Route
              path="/warehouse/replenishment"
              element={
                <WarehousePlaceholder
                  title="Replenishment"
                  subtitle="Saran restok berdasarkan minimum stock dan reorder point."
                  phase={5}
                  description="Material sudah punya reorderPoint & reorderQty di database — Phase 5 mengubahnya jadi saran restok yang bisa disetujui."
                />
              }
            />
            <Route
              path="/warehouse/adjustments"
              element={
                <WarehousePlaceholder
                  title="Damaged, Return & Adjustment"
                  subtitle="Barang rusak, retur, dan penyesuaian stok."
                  phase={5}
                  description="Backend sudah punya movement WASTE, RETURN, dan ADJUSTMENT — Phase 5 menyatukannya jadi satu alur dengan alasan wajib dan approval."
                />
              }
            />
            <Route
              path="/warehouse/reports"
              element={
                <WarehousePlaceholder
                  title="Warehouse Reports"
                  subtitle="Nilai inventory, akurasi stok, dan pergerakan material."
                  phase={6}
                  description="Menunggu data operasional nyata terkumpul — tabel materials & stock_movements masih kosong di production."
                />
              }
            />
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
