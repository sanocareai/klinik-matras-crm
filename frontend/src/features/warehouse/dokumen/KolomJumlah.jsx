import React from "react";

/** Isian jumlah per item (angka desimal, sentuh ≥44px di HP). */
export default function KolomJumlah({ nilai, onUbah, label, testid, maks }) {
  return (
    <input type="text" inputMode="decimal" value={nilai ?? ""} onChange={(e) => onUbah(e.target.value)} aria-label={label} data-testid={testid} max={maks}
      className="w-28 rounded-btn border border-border bg-surface px-2 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-accent max-sm:min-h-11 max-sm:w-full" />
  );
}
