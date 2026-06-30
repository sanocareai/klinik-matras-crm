import React from "react";
import { formatRupiah } from "../utils/format.js";

export default function ProgressBar({ current, target }) {
  const pct = Math.min(100, Math.round((current / target) * 100));

  return (
    <div className="card card-padding progress-card">
      <div className="progress-header">
        <span className="progress-title">Target Penjualan Bulan Ini</span>
        <span className="progress-pct">{pct}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-labels">
        <span>{formatRupiah(current)}</span>
        <span>Target: {formatRupiah(target)}</span>
      </div>
    </div>
  );
}
