import React from "react";
import { RefreshCw } from "lucide-react";

// Error boundary PER KOLOM — 1 kolom Inbox (list/chat/panel) crash TIDAK
// menjatuhkan kolom lain. React error boundary harus class component (belum
// ada hook equivalent). "Muat Ulang Bagian Ini" me-remount children lewat
// key di Fragment (bukan bungkus <div> baru — hindari ganggu CSS grid 3 kolom).
export default class ColumnErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, resetKey: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(`[ColumnErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`, error, info);
  }

  handleReload = () => {
    this.setState((s) => ({ hasError: false, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="column-error-boundary">
          <p className="column-error-title">Terjadi kesalahan di bagian ini.</p>
          <p className="column-error-sub">Kolom lain tetap berfungsi normal.</p>
          <button className="btn btn-secondary btn-sm" onClick={this.handleReload}>
            <RefreshCw size={13} /> Muat Ulang Bagian Ini
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
