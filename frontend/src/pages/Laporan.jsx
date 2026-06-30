import React from "react";
import { BarChart3 } from "lucide-react";

export default function Laporan() {
  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", textAlign: "center" }}>
      <BarChart3 size={48} color="#d1d5db" style={{ marginBottom: 16 }} />
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-main)" }}>Laporan</h2>
      <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
        Halaman ini sedang dalam pengembangan dan akan segera tersedia.
      </p>
    </div>
  );
}
