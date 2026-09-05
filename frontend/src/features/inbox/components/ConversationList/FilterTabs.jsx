import React from "react";
import { UserCheck, UserX, MailWarning, MessageCircleWarning } from "lucide-react";
import { useFilter, useConversationStore } from "../../stores/conversationStore.js";

// Wave 11 (redesign Inbox, plan starry-humming-knuth) — 5 tab TETAP
// (keputusan owner: ganti total, drag-urut-ulang DIPENSIUNKAN). Sisa 5
// filter yang sebelumnya ada di sini (Menggantung/Terbuka/Pending/Selesai/
// Broadcast) pindah ke FilterPopover.jsx, dipasang di sebelah tab ini oleh
// ConversationList/index.jsx.
//
// "Menunggu Customer" (UNANSWERED) — SENGAJA cuma ganti LABEL, bukan filter
// baru: dulu "Belum Dibalas" (pesan terakhir dari customer, sales ngutang
// balasan). Nama lama tetap valid untuk data/logic-nya (matches() di
// ConversationList/index.jsx TIDAK berubah).
const TAB_DEFS = {
  MINE:       { label: "Milik Saya",        Icon: UserCheck },
  UNASSIGNED: { label: "Belum Diambil",     Icon: UserX },
  UNANSWERED: { label: "Menunggu Customer", Icon: MessageCircleWarning },
  UNREAD:     { label: "Belum Dibaca",      Icon: MailWarning },
  ALL:        { label: "Semua",             Icon: null },
};

const ORDER = ["MINE", "UNASSIGNED", "UNANSWERED", "UNREAD", "ALL"];

export default function FilterTabs() {
  const filter = useFilter();

  return (
    <div className="conv-tabs">
      {ORDER.map((key) => {
        const { label, Icon } = TAB_DEFS[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => useConversationStore.getState().setFilter(key)}
            className={`conv-tab${filter === key ? " active" : ""}`}
          >
            {Icon && <Icon size={12} style={{ marginRight: 3 }} />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
