import React from "react";
import { RefreshCw } from "lucide-react";

// Error boundary level HALAMAN — pola sama dengan ColumnErrorBoundary.jsx
// (Inbox), digeneralisasi supaya bisa dipakai di halaman manapun (Orders,
// Pipeline, dst). Kalau render sebuah halaman gagal (uncaught error) di
// tengah interaksi (mis. refetch setelah ubah status order), React akan
// unmount seluruh pohon komponen sampai boundary terdekat — TANPA boundary
// di sini, itu berarti sampai ke root App.jsx, yang bisa terasa seperti
// "halaman tiba-tiba pindah ke Dashboard" kalau route fallback ikut ke-trigger
// setelahnya. Boundary di level halaman menahan errornya DI SINI saja.
export default class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: 0 };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error(`[PageErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info);
  }
  handleReload = () => {
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  };
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: "64px 16px", textAlign: "center" }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            Terjadi kesalahan saat memuat halaman ini.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", maxWidth: 360 }}>
            Data Anda aman — coba muat ulang bagian ini. Kalau terus terjadi, refresh browser.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={this.handleReload}>
            <RefreshCw size={13} /> Muat Ulang Halaman Ini
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
