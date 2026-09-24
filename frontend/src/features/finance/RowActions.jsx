import React, { useState } from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button.jsx";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu.jsx";
import { cn } from "@/lib/utils.js";

// AKSI PER BARIS (D-XXX, 22 Sep 2026) — dulu tiap halaman menaruh 2-4 tombol
// teks berjejer langsung di kolom Aksi ("Setujui" "Tolak", atau "Edit"
// "Potong dari Gaji" "Riwayat" "Batalkan"). Di lebar kolom yang realistis
// (kolom Aksi TIDAK boleh melebar tak terbatas — itu jatah kolom Keterangan/
// Nama) itu MEMBUAT TOMBOL BERTUMPUK/TERPOTONG, bukan cuma "agak sempit".
//
// Polanya sekarang: SATU aksi paling relevan tetap tombol biasa (paling
// sering diklik — "Setujui" untuk yang menunggu persetujuan, "Bayar" untuk
// yang sudah disetujui, dst — beda per status, ditentukan pemanggil lewat
// prop `primary`), sisanya masuk menu titik-tiga (`items`). Kolom Aksi jadi
// lebar TETAP kecil (lihat `AKSI_COL_WIDTH`) terlepas dari berapa banyak
// aksi yang tersedia untuk baris itu — tidak pernah melebar/menyempit per
// baris, jadi header & isi selalu sejajar.
//
// `items` boleh berisi `{ separator: true }` untuk pemisah, atau
// `{ label, icon, onClick, destructive, disabled, confirmText, hidden }`.
// `confirmText` dijalankan lewat `window.confirm` SEBELUM `onClick` — sama
// seperti `TombolAksi` (features/finance/shared.jsx), sengaja tidak dipakai
// ulang komponennya di sini karena `TombolAksi` merender `<button>` utuh
// (dengan spinner sendiri) yang tidak cocok dibungkus di dalam item menu
// Radix (Item Radix sendiri yang jadi elemen interaktifnya, lewat `onSelect`).

/** Lebar tetap kolom Aksi — cukup untuk SATU tombol teks pendek + tombol titik-tiga, tanpa berubah per baris. */
export const AKSI_COL_WIDTH = 148;
/** Lebar kolom Aksi kalau HANYA ada menu titik-tiga (tidak ada aksi utama untuk baris manapun di tabel ini). */
export const AKSI_COL_WIDTH_MENU_ONLY = 64;

export function RowActions({ primary, items = [], align = "end" }) {
  const [sibuk, setSibuk] = useState(false);
  const visible = items.filter((it) => it && !it.hidden);

  async function jalankanPrimary(e) {
    if (sibuk) return;
    if (primary.confirmText && !window.confirm(primary.confirmText)) return;
    setSibuk(true);
    try {
      await primary.onClick?.(e);
    } finally {
      setSibuk(false);
    }
  }

  async function jalankanItem(it) {
    if (sibuk) return;
    if (it.confirmText && !window.confirm(it.confirmText)) return;
    setSibuk(true);
    try {
      await it.onClick?.();
    } finally {
      setSibuk(false);
    }
  }

  const adaPrimary = primary && !primary.hidden;
  if (!adaPrimary && visible.length === 0) return null;

  return (
    <div className="flex items-center justify-end gap-1">
      {adaPrimary && (
        <Button
          size="sm"
          variant={primary.variant || "secondary"}
          disabled={sibuk || primary.disabled}
          onClick={jalankanPrimary}
          title={primary.title}
          className={cn("shrink-0 whitespace-nowrap max-sm:min-h-11 max-sm:px-4", primary.className)}
        >
          {sibuk ? <Loader2 size={13} className="animate-spin" /> : primary.icon && <primary.icon size={13} />}
          {primary.label}
        </Button>
      )}
      {visible.length > 0 && (
        <Menu
          align={align}
          trigger={
            <Button
              size="icon" variant="neutral"
              className="h-8 w-8 shrink-0"
              aria-label="Aksi lain"
              disabled={sibuk && !adaPrimary}
            >
              {sibuk && !adaPrimary ? <Loader2 size={14} className="animate-spin" /> : <MoreHorizontal size={16} />}
            </Button>
          }
        >
          {visible.map((it, i) =>
            it.separator ? (
              <MenuSeparator key={`sep-${i}`} />
            ) : (
              <MenuItem
                key={it.key ?? it.label ?? i}
                icon={it.icon}
                destructive={it.destructive}
                disabled={it.disabled}
                hint={it.disabled ? it.alasan : it.hint}
                title={it.disabled ? it.alasan : undefined}
                data-alasan={it.disabled ? "1" : undefined}
                onSelect={() => jalankanItem(it)}
              >
                {it.label}
              </MenuItem>
            )
          )}
        </Menu>
      )}
    </div>
  );
}
