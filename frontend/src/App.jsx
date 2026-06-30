import React, { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Layout from "./components/Layout.jsx";
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

export default function App() {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("user");
    return saved ? JSON.parse(saved) : null;
  });

  function handleLogin(u) {
    localStorage.setItem("user", JSON.stringify(u));
    setUser(u);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
  }

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <BrowserRouter>
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
          <Route path="*"            element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
