import React, { useEffect, useState } from "react";
import { Reorder } from "framer-motion";
import { UserCheck } from "lucide-react";
import { useFilter, useConversationStore } from "../../stores/conversationStore.js";

const TAB_DEFS = {
  MINE:    { label: "Milik Saya" },
  ALL:     { label: "Semua" },
  OPEN:    { label: "Terbuka" },
  PENDING: { label: "Pending" },
  CLOSED:  { label: "Selesai" },
};

// "Milik Saya" di depan (permintaan eksplisit: filter yang paling sering
// dipakai sales sendiri tidak seharusnya di ujung, mengharuskan scroll tab).
const DEFAULT_ORDER = ["MINE", "ALL", "OPEN", "PENDING", "CLOSED"];

const STORAGE_KEY = "sano-inbox-filter-order";

function bacaUrutan() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ORDER;
    const parsed = JSON.parse(raw);
    // Validasi: harus persis set key yang sama (skema tab pernah berubah di
    // versi lama tidak boleh bikin urutan tersimpan jadi rusak/hilang tab).
    if (Array.isArray(parsed)
      && parsed.length === DEFAULT_ORDER.length
      && parsed.every((k) => TAB_DEFS[k])
      && new Set(parsed).size === DEFAULT_ORDER.length) {
      return parsed;
    }
    return DEFAULT_ORDER;
  } catch {
    return DEFAULT_ORDER; // localStorage bisa diblokir (mode privat) — jangan crash
  }
}

// Filter tab BISA DIGESER (drag & drop, mouse maupun sentuh — pakai
// framer-motion Reorder, bukan HTML5 native drag yang tidak jalan di
// browser mobile) sesuai kebutuhan masing-masing sales/admin. Urutan
// tersimpan per-perangkat di localStorage (pola sama dengan preferensi
// tema di ThemeProvider.jsx) — BUKAN per-akun, jadi tidak ikut sinkron
// antar HP/laptop yang sama.
export default function FilterTabs() {
  const filter = useFilter();
  const [order, setOrder] = useState(bacaUrutan);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)); } catch { /* mode privat — abaikan */ }
  }, [order]);

  return (
    <Reorder.Group
      as="div"
      axis="x"
      values={order}
      onReorder={setOrder}
      className="conv-tabs"
    >
      {order.map((key) => (
        <Reorder.Item
          key={key}
          value={key}
          as="button"
          onClick={() => useConversationStore.getState().setFilter(key)}
          className={`conv-tab${filter === key ? " active" : ""}`}
          // whileDrag: tab yang sedang digeser terangkat sedikit supaya
          // kelihatan aktif dipindah, bukan cuma menempel diam di kursor/jari.
          whileDrag={{ scale: 1.06, boxShadow: "0 4px 14px rgba(0,0,0,0.16)", zIndex: 1 }}
        >
          {key === "MINE" && <UserCheck size={12} style={{ marginRight: 3 }} />}
          {TAB_DEFS[key].label}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
