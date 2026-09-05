import React from "react";
import { ListFilter, Timer, Megaphone } from "lucide-react";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu.jsx";
import { useFilter, useConversationStore } from "../../stores/conversationStore.js";

// Wave 11 (redesign Inbox, plan starry-humming-knuth) — 5 filter yang lebih
// jarang dipakai (dulu ikut deretan tab utama, bikin header padat) pindah
// ke sini. conversationStore.filter TETAP nilai TUNGGAL seperti sebelumnya
// (satu filter aktif sekaligus) — popover ini cuma memindahkan TEMPATNYA,
// bukan mengubah jadi filter gabungan/multi-pilih. "Menggantung" DIPAKAI
// sebagai penanda "butuh perhatian SLA" yang sudah ada (assigned + belum
// dibalas >=60 menit, sama ambang dengan badge Ambil Alih) — sengaja
// TIDAK menambah filter SLA terpisah yang akan tumpang-tindih artinya.
const SECONDARY_FILTERS = [
  { key: "STALLED",   label: "Menggantung", Icon: Timer },
  { key: "OPEN",      label: "Terbuka",     Icon: null },
  { key: "PENDING",   label: "Pending",     Icon: null },
  { key: "CLOSED",    label: "Selesai",     Icon: null },
  { key: "BROADCAST", label: "Broadcast",   Icon: Megaphone },
];

export default function FilterPopover() {
  const filter = useFilter();
  const activeSecondary = SECONDARY_FILTERS.find((f) => f.key === filter);

  return (
    <Menu
      trigger={
        <button
          type="button"
          className={`conv-list-icon-btn conv-filter-btn${activeSecondary ? " active" : ""}`}
          title={activeSecondary ? `Filter: ${activeSecondary.label}` : "Filter lainnya"}
        >
          <ListFilter size={17} />
          {activeSecondary && <span className="conv-filter-dot" aria-hidden="true" />}
        </button>
      }
      align="start"
    >
      <MenuLabel>Filter Lainnya</MenuLabel>
      {SECONDARY_FILTERS.map(({ key, label, Icon }) => (
        <MenuItem key={key} icon={Icon} onSelect={() => useConversationStore.getState().setFilter(key)}>
          {label}
        </MenuItem>
      ))}
    </Menu>
  );
}
