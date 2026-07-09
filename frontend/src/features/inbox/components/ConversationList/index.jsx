import React, { useMemo } from "react";
import { Virtuoso } from "react-virtuoso";
import FilterTabs from "./FilterTabs.jsx";
import SearchBar from "./SearchBar.jsx";
import ConversationItem from "./ConversationItem.jsx";
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
      <SearchBar />
      <FilterTabs />
      <div className="conv-virtuoso-wrap">
        {isLoading && visibleIds.length === 0 && (
          <p className="empty">Memuat percakapan...</p>
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
