import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
import InstallPrompt from "./components/InstallPrompt.jsx";
import UpdateBanner from "./components/UpdateBanner.jsx";
import CoPilotFloat from "./components/CoPilotFloat.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Inbox from "./pages/Inbox.jsx";
import Customers from "./pages/Customers.jsx";
import Pipeline from "./pages/Pipeline.jsx";
import Broadcast from "./pages/Broadcast.jsx";
import Automation from "./pages/Automation.jsx";
import Laporan from "./pages/Laporan.jsx";
import Pengaturan from "./pages/Pengaturan.jsx";
import Pengguna from "./pages/Pengguna.jsx";
import Products from "./pages/Products.jsx";
import TrackingLinks from "./pages/TrackingLinks.jsx";
import CoPilot from "./pages/CoPilot.jsx";

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
    setUser(null);
    setSessionExpired(false);
  }

  // Tangkap event 401 dari api.js — tampilkan modal tanpa hard reload
  useEffect(() => {
    const handler = () => setSessionExpired(true);
    window.addEventListener("auth-error", handler);
    return () => window.removeEventListener("auth-error", handler);
  }, []);

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
        {sessionExpired && (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 9999,
          }}>
            <div style={{
              background: "var(--card-bg)", borderRadius: 12, padding: "32px 28px",
              maxWidth: 340, width: "90%", textAlign: "center",
              boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
            }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>⏰</div>
              <h3 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700 }}>
                Sesi Berakhir
              </h3>
              <p style={{ margin: "0 0 20px", color: "var(--text-secondary)", fontSize: 14 }}>
                Login Anda sudah kadaluarsa. Silakan login kembali untuk melanjutkan.
              </p>
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => setSessionExpired(false)}
              >
                Login Kembali
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <BrowserRouter>
      <InstallPrompt />
      <UpdateBanner />
      <CoPilotFloat />
      <Layout user={user} onLogout={handleLogout}>
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
      </Layout>
    </BrowserRouter>
  );
}
