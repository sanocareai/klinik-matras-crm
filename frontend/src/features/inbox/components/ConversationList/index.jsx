import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import { MessageSquarePlus, PanelLeftClose, X, Pin, PinOff, Check, Circle } from "lucide-react";
import FilterTabs from "./FilterTabs.jsx";
import SearchBar from "./SearchBar.jsx";
import ChatBaruDialog from "./ChatBaruDialog.jsx";
import ConversationItem from "./ConversationItem.jsx";
import { ConversationListSkeleton } from "../Skeletons.jsx";
import { useConversations } from "../../hooks/useConversations.js";
import { api } from "../../../../api.js";
import {
  useOrderedIds, useFilter, useConvSearchQuery, useConversationStore,
} from "../../stores/conversationStore.js";

// Cocokkan 1 conversation dengan filter + search AKTIF SEKARANG. Perlu
// re-filter di client (bukan cuma andalkan param API) karena store bersifat
// global/akumulatif — conversation yang pernah ke-load di bawah filter lain
// tetap ada di cache, jadi list yang tampil harus selalu disaring ulang di
// sini supaya konsisten dengan filter yang sedang aktif.
//
// BUG YANG DIPERBAIKI (25 Agustus 2026): `query` SEBELUMNYA dicocokkan ulang
// di sini dari field lokal (nama/nomor/IG/nama grup) — itu MEMBUANG hasil
// yang server sudah benar temukan lewat ISI PESAN (backend/src/routes/
// conversations.js `search` param sudah cocok ke Message.content sejak 28
// Juli 2026), karena field itu tidak pernah tersimpan di conversationsById
// (cuma metadata percakapan). Efeknya: cari kata yang cuma ada di isi pesan
// (bukan di nama/nomor pelanggan) diam-diam mengembalikan 0 hasil di web,
// walau backend & mobile (yang sudah diperbaiki lebih dulu, lihat
// mobile/src/screens/ChatListScreen.js#matches) sudah benar. Sekarang pakai
// `searchMatchedIds` (id yang dikonfirmasi SERVER), sama seperti mobile.
function matches(c, filter, userId, query, searchMatchedIds) {
  if (!c) return false;
  if (filter === "MINE" && c.assignedToId !== userId) return false;
  // "Belum Diambil" (30 Agustus 2026, revisi) — SEBELUMNYA cuma cek
  // assignedToId kosong, tapi percakapan yang PERNAH dibalas seseorang
  // (firstResponderId terisi — mis. Novi, sang leader, sempat menjawab
  // lalu lepas lagi) tetap lolos dan tampil dengan badge "1st: Novi" di
  // tab ini. Owner: kalau SUDAH pernah "diambil" (siapa pun, bukan cuma
  // Novi), jangan masuk sini lagi — tab ini harus benar-benar cuma yang
  // BELUM PERNAH disentuh SIAPA PUN, tanpa badge sales/leader apa pun.
  if (filter === "UNASSIGNED" && (c.assignedToId || c.firstResponder)) return false;
  // "Menggantung" — assigned, pesan terakhir INBOUND, >60 menit. `isUnanswered`/
  // `unansweredMinutes` datang dari backend (GET /conversations), sama field yang
  // dipakai badge "Ambil Alih (belum dibalas 1j+)" di ChatWindow.jsx.
  if (filter === "STALLED" && !(c.assignedToId && c.isUnanswered && (c.unansweredMinutes ?? 0) >= 60 && c.status !== "RESOLVED")) return false;
  if (filter === "OPEN" && c.status !== "OPEN") return false;
  if (filter === "PENDING" && c.status !== "PENDING") return false;
  if (filter === "CLOSED" && c.status !== "RESOLVED") return false;
  // `isUnanswered` datang dari backend (GET /conversations) — pesan
  // TERAKHIR arahnya INBOUND (sales sudah baca, belum sempat balas).
  if (filter === "UNANSWERED" && !c.isUnanswered) return false;
  // `unread` boolean = sumber kebenaran (BUKAN unreadCount ?? unread —
  // lihat catatan bug di mobile/src/screens/ChatListScreen.js#matches:
  // unreadCount bisa 0 padahal unread=true dari toggle manual "Tandai
  // Belum Dibaca", `??` tidak fallback untuk 0).
  if (filter === "UNREAD" && !(c.unread || (c.unreadCount ?? 0) > 0)) return false;
  if (query && !searchMatchedIds?.has(c.id)) return false;
  return true;
}

// Multi-select massal (port dari mobile ChatListScreen.js) — SENGAJA
// dibatasi ke aksi yang sudah ada endpoint per-item aman (pin, tandai
// dibaca), TIDAK menambah kapabilitas baru (mis. hapus percakapan) yang
// butuh diskusi produk sendiri soal retensi data CRM.
export default function ConversationList({ userId, onCollapse }) {
  const navigate = useNavigate();
  const [chatBaruOpen, setChatBaruOpen] = useState(false);
  const filter = useFilter();
  const search = useConvSearchQuery();
  const orderedIds = useOrderedIds();
  const conversationsById = useConversationStore((s) => s.conversationsById);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const enterSelection = useCallback((id) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }, []);
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);
  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  async function bulkAction(patchFn) {
    const ids = [...selectedIds];
    const results = await Promise.allSettled(ids.map((id) => patchFn(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) alert(`${failed} dari ${ids.length} percakapan gagal diproses.`);
    exitSelection();
  }
  function bulkPin() {
    bulkAction((id) => api.updateConversation(id, { pinned: true }).then(() =>
      useConversationStore.getState().upsertConversation({ id, pinned: true, pinnedAt: new Date().toISOString() })
    ));
  }
  function bulkUnpin() {
    bulkAction((id) => api.updateConversation(id, { pinned: false }).then(() =>
      useConversationStore.getState().upsertConversation({ id, pinned: false, pinnedAt: null })
    ));
  }
  function bulkMarkRead() {
    bulkAction((id) => api.markConversationRead(id).then(() =>
      useConversationStore.getState().upsertConversation({ id, unread: false, unreadCount: 0, isRead: true })
    ));
  }
  function bulkMarkUnread() {
    bulkAction((id) => api.updateConversation(id, { unread: true, isRead: false }).then(() =>
      useConversationStore.getState().upsertConversation({ id, unread: true, isRead: false })
    ));
  }
  const selectedConvs = [...selectedIds].map((id) => conversationsById[id]).filter(Boolean);
  const allSelectedPinned = selectedConvs.length > 0 && selectedConvs.every((c) => c.pinned);

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useConversations({ filter, search, userId });

  // Id percakapan yang cocok `search` MENURUT SERVER (termasuk isi pesan) —
  // lihat catatan panjang di matches() kenapa ini tidak dihitung ulang dari
  // field lokal. `data` di sini selalu hasil query untuk `search` yang
  // SEDANG aktif (queryKey ikut berubah tiap search berubah), jadi tidak
  // perlu filter tambahan by staleness. Pola sama persis dengan
  // mobile/src/screens/ChatListScreen.js.
  const searchMatchedIds = useMemo(() => {
    if (!search.trim()) return null;
    return new Set((data?.pages ?? []).flatMap((p) => p?.data ?? []).map((c) => c.id));
  }, [data, search]);

  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedIds.filter((id) => matches(conversationsById[id], filter, userId, q, searchMatchedIds));
  }, [orderedIds, conversationsById, filter, userId, search, searchMatchedIds]);

  function handleEndReached() {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }

  return (
    <div className="conversation-list">
      {/* Dibuka lewat tombol di bawah; percakapan yang jadi langsung dibuka
          lewat deep-link ?conv= (pola sama dengan klik baris di Pelanggan). */}
      <ChatBaruDialog
        open={chatBaruOpen}
        onClose={() => setChatBaruOpen(false)}
        onJadi={(hasil) => navigate(`/inbox?conv=${hasil.conversationId}`)}
      />

      {selectionMode ? (
        <div className="conv-selection-toolbar">
          <button className="btn-icon" onClick={exitSelection} title="Batal"><X size={18} /></button>
          <span className="conv-selection-count">{selectedIds.size} dipilih</span>
          <div style={{ flex: 1 }} />
          <button className="btn-icon" onClick={allSelectedPinned ? bulkUnpin : bulkPin} title={allSelectedPinned ? "Lepas Sematan" : "Sematkan"}>
            {allSelectedPinned ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
          <button className="btn-icon" onClick={bulkMarkRead} title="Tandai Sudah Dibaca"><Check size={18} /></button>
          <button className="btn-icon" onClick={bulkMarkUnread} title="Tandai Belum Dibaca"><Circle size={18} /></button>
        </div>
      ) : (
        <div className="conv-list-toprow">
          <div style={{ flex: 1, minWidth: 0 }}><SearchBar /></div>
          <button
            onClick={() => setChatBaruOpen(true)}
            title="Chat baru — ketik nomor langsung, seperti di WhatsApp"
            className="conv-list-icon-btn"
          >
            <MessageSquarePlus size={17} />
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              title="Sembunyikan daftar percakapan"
              aria-label="Sembunyikan daftar percakapan"
              className="conv-list-icon-btn"
            >
              <PanelLeftClose size={17} />
            </button>
          )}
        </div>
      )}
      <FilterTabs />
      <div className="conv-virtuoso-wrap">
        {isLoading && visibleIds.length === 0 && (
          <ConversationListSkeleton count={8} />
        )}
        {!isLoading && visibleIds.length === 0 && (
          <p className="empty">Belum ada percakapan</p>
        )}
        {visibleIds.length > 0 && (
          <Virtuoso
            style={{ height: "100%" }}
            data={visibleIds}
            endReached={handleEndReached}
            computeItemKey={(_, id) => id}
            itemContent={(_, id) => (
              <ConversationItem
                id={id}
                selectionMode={selectionMode}
                selected={selectedIds.has(id)}
                onToggleSelect={toggleSelect}
                onEnterSelection={enterSelection}
              />
            )}
          />
        )}
      </div>
    </div>
  );
}
