import React from "react";
import { Settings, Lock } from "lucide-react";

export default function Pengaturan({ user }) {
  if (user?.role !== "ADMIN") {
    return (
      <div className="page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
        <Lock size={48} color="#d1d5db" style={{ marginBottom: 16 }} />
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-main)" }}>Akses Ditolak</h2>
        <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
          Hanya Admin yang dapat mengakses halaman ini.
        </p>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
      <Settings size={48} color="#d1d5db" style={{ marginBottom: 16 }} />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-main)" }}>Pengaturan</h2>
      <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
        Halaman ini sedang dalam pengembangan dan akan segera tersedia.
      </p>
    </div>
  );
}
