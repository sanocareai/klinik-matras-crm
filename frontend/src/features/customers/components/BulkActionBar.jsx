import React, { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";

// Toolbar seleksi massal — muncul begitu ada baris tercentang di CustomersTable.
// Aksi pertama: assign sales ke banyak pelanggan sekaligus (item #3 dari analisa
// halaman Pelanggan, 27 Jul 2026). Lewat panggilan api.updateCustomer per id
// (endpoint yang sudah ada), bukan endpoint bulk baru — jumlah baris yang wajar
// dipilih sekaligus (puluhan, bukan ribuan) membuat ini cukup murah.
export default function BulkActionBar({ count, salesUsers, busy, onAssign, onClear }) {
  const [salesId, setSalesId] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accentbg px-3 py-2">
      <span className="text-[13px] font-semibold text-ink">{count} pelanggan dipilih</span>

      <select
        className="h-8 rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        value={salesId}
        onChange={(e) => setSalesId(e.target.value)}
        aria-label="Pilih sales person untuk assign massal"
      >
        <option value="">Pilih Sales Person…</option>
        {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>

      <Button size="sm" disabled={!salesId || busy} onClick={() => onAssign(salesId)}>
        {busy ? "Memproses…" : "Assign Sales"}
      </Button>

      <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
        <X size={14} /> Batal
      </Button>
    </div>
  );
}
