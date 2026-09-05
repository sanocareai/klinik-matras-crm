import { useEffect } from "react";
import { api } from "../../../api.js";
import { useConversationStore } from "../stores/conversationStore.js";

// Wave 12 (redesign Inbox, plan starry-humming-knuth) — lapisan keyboard
// GLOBAL untuk Inbox, dipasang SEKALI di Inbox.jsx (bukan di ChatWindow/
// ConversationList — supaya satu listener saja, tidak dobel per komponen).
//
//   J / ArrowDown = percakapan berikutnya    K / ArrowUp = sebelumnya
//   E = tandai selesai (kalau belum selesai)  A = ambil/ambil alih percakapan
//   F = Focus Mode                            I = buka/tutup panel pelanggan
//
// SENGAJA TIDAK mem-bind Cmd/Ctrl+K — itu sudah dipakai
// components/ui/command-palette.jsx; membind ulang di sini bikin 2 handler
// berebut event yang sama. Cmd/Ctrl+Enter (kirim pesan) TETAP scoped di
// Composer.jsx, tidak perlu (dan tidak boleh) jadi global — mengirim pesan
// itu aksi yang HARUS jelas konteksnya (percakapan mana yang aktif DI
// KOMPOSER, bukan "yang sedang di-highlight di daftar").
//
// Modifier apa pun (Ctrl/Cmd/Alt) DIABAIKAN total di sini — daripada
// menebak kombinasi mana yang aman, lebih aman biarkan SEMUA shortcut
// ber-modifier lewat tanpa disentuh (browser, command-palette, atau apa
// pun lain yang mungkin sudah memakainya).
function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Radix (Menu/Dialog) menandai elemen terbuka dengan `data-state="open"` +
// role — ditambah 4 popover HAND-ROLLED (bukan Radix) yang juga ada di
// Inbox: menu konteks bubble pesan, menu konteks baris percakapan, peek
// preview, popover transfer lead. Kalau salah satu SEDANG terbuka, huruf
// tunggal di bawah nyaris pasti dimaksudkan untuk popover itu (atau cuma
// kebetulan tertekan saat interaksi mouse), bukan shortcut global ini.
function isOverlayOpen() {
  return !!document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], ' +
    ".msg-context-menu, .conv-context-menu, .peek-popup, .transfer-picker-menu"
  );
}

function currentUserId() {
  try { return JSON.parse(localStorage.getItem("user") || "null")?.id || null; } catch { return null; }
}

export function useInboxHotkeys({ onToggleFocusMode, onTogglePanel } = {}) {
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (isOverlayOpen()) return;

      const key = e.key.toLowerCase();
      if (!["j", "k", "e", "a", "f", "i", "arrowdown", "arrowup"].includes(key)) return;

      const store = useConversationStore.getState();

      if (key === "j" || key === "arrowdown") {
        e.preventDefault();
        navigateBy(1, store);
      } else if (key === "k" || key === "arrowup") {
        e.preventDefault();
        navigateBy(-1, store);
      } else if (key === "e") {
        resolveActive(store);
      } else if (key === "a") {
        takeoverActive(store);
      } else if (key === "f") {
        onToggleFocusMode?.();
      } else if (key === "i") {
        onTogglePanel?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleFocusMode, onTogglePanel]);
}

function navigateBy(direction, store) {
  const ids = store.visibleIds;
  if (!ids || ids.length === 0) return;
  const idx = ids.indexOf(store.activeConversationId);
  const nextIdx = idx === -1 ? 0 : Math.min(Math.max(idx + direction, 0), ids.length - 1);
  if (ids[nextIdx] !== store.activeConversationId) store.setActive(ids[nextIdx]);
}

// Mirror handleResolve di ChatWindow/index.jsx — sengaja duplikasi kecil
// (bukan prop-drill callback dari ChatWindow) karena hook ini dipasang di
// Inbox.jsx, di luar ChatWindow, dan aksinya cuma 2 baris (updateConversation
// + upsertConversation), keduanya SUDAH fungsi murni yang aman dipanggil
// dari mana saja lewat store.getState()/api langsung.
async function resolveActive(store) {
  const id = store.activeConversationId;
  const c = id ? store.conversationsById[id] : null;
  if (!c || c.type === "GROUP" || c.status === "RESOLVED") return;
  try {
    const updated = await api.updateConversation(id, { status: "RESOLVED" });
    store.upsertConversation(updated);
  } catch { /* senyap — bukan aksi kritis, sales masih bisa lewat menu "More" */ }
}

// Mirror handleTakeover di ChatWindow/index.jsx, termasuk confirm() yang
// sama (aksi ini mengubah pemegang lead — tetap butuh konfirmasi eksplisit,
// shortcut tidak boleh membuatnya lebih "murah" dari klik tombolnya).
async function takeoverActive(store) {
  const id = store.activeConversationId;
  const c = id ? store.conversationsById[id] : null;
  if (!c || c.type === "GROUP") return;
  const isMine = c.assignedToId && c.assignedToId === currentUserId();
  if (isMine) return;
  if (c.assignedToId && !c.canTakeOver) return;
  if (!confirm("Ambil alih percakapan ini sebagai lead kamu?")) return;
  try {
    const updated = await api.takeoverConversation(id);
    store.upsertConversation(updated);
  } catch (err) { alert(err.message); }
}
