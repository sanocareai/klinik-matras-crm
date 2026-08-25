import React, { useEffect, useState } from "react";
import { Reorder } from "framer-motion";
import { UserCheck, UserX, Timer, Megaphone, MailWarning, MessageCircleWarning } from "lucide-react";
import { useFilter, useConversationStore } from "../../stores/conversationStore.js";

const TAB_DEFS = {
  MINE:      { label: "Milik Saya" },
  // Percakapan assignedToId masih kosong — belum ada satu pun sales yang
  // klaim. Ditambahkan 25 Agustus 2026 setelah Laporan Sales menunjukkan
  // ada ratusan percakapan begini (`unassignedInPeriod` di
  // routes/analytics.js /sales-report) tapi sebelumnya tidak ada cara
  // melihat DAFTARNYA dari Inbox, cuma angkanya di laporan. Tombol "Ambil
  // Percakapan" di ChatWindow.jsx SUDAH otomatis berfungsi untuk baris di
  // tab ini (canTakeOver selalu true kalau assignedToId kosong) — filter
  // ini cuma bikin baris-barisnya kelihatan, bukan fitur baru.
  UNASSIGNED: { label: "Belum Diambil" },
  // LEBIH KETAT dari UNANSWERED di bawah: SUDAH ada sales yang pegang, tapi
  // pesan terakhir customer sudah >60 menit tanpa balasan — definisi sama
  // persis dengan "Menggantung Sekarang" di Laporan Sales (stalledNow) dan
  // badge "Ambil Alih (belum dibalas 1j+)". Ditambahkan bersamaan dengan
  // UNASSIGNED (25 Agustus 2026) — dua jenis "belum ditangani" yang beda.
  STALLED:    { label: "Menggantung" },
  ALL:       { label: "Semua" },
  // Belum Dibaca = sales belum BUKA chat-nya sama sekali. Belum Dibalas =
  // pesan TERAKHIR dari CUSTOMER (arah INBOUND), sales sudah baca tapi
  // belum sempat balas — definisi sama persis dengan badge "Ambil Alih
  // (belum dibalas 1j+)" yang sudah ada di sini, dan dengan tab mobile
  // (D-031, mobile/src/screens/ChatListScreen.js). Sebelumnya CUMA ada di
  // mobile — backend (?unread=/?unanswered=true) sudah lama mendukung.
  UNREAD:     { label: "Belum Dibaca" },
  UNANSWERED: { label: "Belum Dibalas" },
  OPEN:      { label: "Terbuka" },
  PENDING:   { label: "Pending" },
  CLOSED:    { label: "Selesai" },
  // Penerima broadcast — supaya sales bisa fokus menggarap orang yang baru
  // saja dikirimi pesan kampanye sebagai satu antrean tersendiri.
  BROADCAST: { label: "Broadcast" },
};

// "Milik Saya" di depan (permintaan eksplisit: filter yang paling sering
// dipakai sales sendiri tidak seharusnya di ujung, mengharuskan scroll tab).
//
// Catatan: menambah key baru di sini otomatis membuat urutan tersimpan di
// localStorage pengguna lama dianggap tidak valid (jumlah key beda), dan
// bacaUrutan() jatuh ke DEFAULT_ORDER ini — yaitu justru perilaku yang
// diinginkan: semua orang langsung melihat tab baru.
const DEFAULT_ORDER = ["MINE", "UNASSIGNED", "STALLED", "ALL", "UNREAD", "UNANSWERED", "OPEN", "PENDING", "CLOSED", "BROADCAST"];

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
          {key === "UNASSIGNED" && <UserX size={12} style={{ marginRight: 3 }} />}
          {key === "STALLED" && <Timer size={12} style={{ marginRight: 3 }} />}
          {key === "UNREAD" && <MailWarning size={12} style={{ marginRight: 3 }} />}
          {key === "UNANSWERED" && <MessageCircleWarning size={12} style={{ marginRight: 3 }} />}
          {key === "BROADCAST" && <Megaphone size={12} style={{ marginRight: 3 }} />}
          {TAB_DEFS[key].label}
        </Reorder.Item>
      ))}
    </Reorder.Group>
  );
}
