import React from "react";
import { UserCheck } from "lucide-react";
import { useFilter, useConversationStore } from "../../stores/conversationStore.js";

const TABS = [
  { key: "ALL",     label: "Semua" },
  { key: "OPEN",    label: "Terbuka" },
  { key: "PENDING", label: "Pending" },
  { key: "CLOSED",  label: "Selesai" },
  { key: "MINE",    label: "Milik Saya" },
];

export default function FilterTabs() {
  const filter = useFilter();

  return (
    <div className="conv-tabs">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => useConversationStore.getState().setFilter(t.key)}
          className={`conv-tab${filter === t.key ? " active" : ""}`}
        >
          {t.key === "MINE" && <UserCheck size={12} style={{ marginRight: 3 }} />}
          {t.label}
        </button>
      ))}
    </div>
  );
}
