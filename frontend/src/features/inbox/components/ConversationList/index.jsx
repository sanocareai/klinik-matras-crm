import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import { MessageSquarePlus } from "lucide-react";
import FilterTabs from "./FilterTabs.jsx";
import SearchBar from "./SearchBar.jsx";
import ChatBaruDialog from "./ChatBaruDialog.jsx";
import ConversationItem from "./ConversationItem.jsx";
import { ConversationListSkeleton } from "../Skeletons.jsx";
import { useConversations } from "../../hooks/useConversations.js";
import {
  useOrderedIds, useFilter, useConvSearchQuery, useConversationStore,
} from "../../stores/conversationStore.js";

// Cocokkan 1 conversation dengan filter + search AKTIF SEKARANG. Perlu
// re-filter di client (bukan cuma andalkan param API) karena store bersifat
// global/akumulatif — conversation yang pernah ke-load di bawah filter lain
// tetap ada di cache, jadi list yang tampil harus selalu disaring ulang di
// sini supaya konsisten dengan filter yang sedang aktif.
function matches(c, filter, userId, query) {
  if (!c) return false;
  if (filter === "MINE" && c.assignedToId !== userId) return false;
  if (filter === "OPEN" && c.status !== "OPEN") return false;
  if (filter === "PENDING" && c.status !== "PENDING") return false;
  if (filter === "CLOSED" && c.status !== "RESOLVED") return false;
  if (query) {
    const hay = [c.customer?.name, c.customer?.phone, c.customer?.instagramHandle, c.groupName]
      .filter(Boolean).join(" ").toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

export default function ConversationList({ userId }) {
  const navigate = useNavigate();
  const [chatBaruOpen, setChatBaruOpen] = useState(false);
  const filter = useFilter();
  const search = useConvSearchQuery();
  const orderedIds = useOrderedIds();
  const conversationsById = useConversationStore((s) => s.conversationsById);

  const { isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useConversations({ filter, search, userId });

  const visibleIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedIds.filter((id) => matches(conversationsById[id], filter, userId, q));
  }, [orderedIds, conversationsById, filter, userId, search]);

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

      <div style={{ display: "flex", gap: 8, padding: "8px 10px 0", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}><SearchBar /></div>
        <button
          onClick={() => setChatBaruOpen(true)}
          title="Chat baru — ketik nomor langsung, seperti di WhatsApp"
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            width: 34, height: 34, borderRadius: 8, cursor: "pointer",
            border: "1px solid var(--border)", background: "var(--bg-card, #fff)",
            color: "var(--primary, #2563eb)",
          }}
        >
          <MessageSquarePlus size={17} />
        </button>
      </div>
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
            itemContent={(_, id) => <ConversationItem id={id} />}
          />
        )}
      </div>
    </div>
  );
}
