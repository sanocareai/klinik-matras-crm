import React, { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";

// Toolbar seleksi massal — muncul begitu ada baris tercentang di CustomersTable.
// Aksi pertama: assign sales ke banyak pelanggan sekaligus (item #3 dari analisa
// halaman Pelanggan, 27 Jul 2026). Lewat panggilan api.updateCustomer per id
// (endpoint yang sudah ada), bukan endpoint bulk baru — jumlah baris yang wajar
// dipilih sekaligus (puluhan, bukan ribuan) membuat ini cukup murah.
//
// REVISI 5 Agustus 2026 — skenario nyata: sales resign dengan 190 pelanggan
// tertaut ke namanya, jauh lebih banyak dari yang kelihatan di 1 halaman
// (25/halaman). Centang manual lintas ~8 halaman terlalu lambat & rawan
// salah. `canSelectAllMatching` memicu tawaran "pilih SEMUA yang cocok
// filter ini" — begitu diklik, aksi selanjutnya lewat POST /customers/
// bulk-reassign (1 query DB), bukan lagi loop per-id.
export default function BulkActionBar({
  count, salesUsers, busy, onAssign, onClear,
  selectAllMatching = false, canSelectAllMatching = false, totalMatching = 0, onSelectAllMatching,
}) {
  const [salesId, setSalesId] = useState("");

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accentbg px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">
          {count} pelanggan dipilih{selectAllMatching ? " (semua yang cocok filter)" : ""}
        </span>

        <select
          className="h-8 rounded-lg bg-surface px-2 text-[13px] text-ink2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          value={salesId}
          onChange={(e) => setSalesId(e.target.value)}
          aria-label="Pilih sales person untuk assign massal"
        >
          <option value="">Pilih Sales Person…</option>
          {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <Button
          size="sm" disabled={!salesId || busy}
          onClick={() => {
            if (selectAllMatching && !confirm(`Pindahkan SEMUA ${totalMatching} pelanggan yang cocok filter ini ke sales terpilih?`)) return;
            onAssign(salesId);
          }}
        >
          {busy ? "Memproses…" : "Assign Sales"}
        </Button>

        <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
          <X size={14} /> Batal
        </Button>
      </div>

      {canSelectAllMatching && (
        <button
          type="button"
          onClick={onSelectAllMatching}
          className="w-fit text-[12px] font-semibold text-accent underline-offset-2 hover:underline"
        >
          {count} pelanggan di halaman ini dipilih — pilih semua {totalMatching} yang cocok filter ini →
        </button>
      )}
    </div>
  );
}
