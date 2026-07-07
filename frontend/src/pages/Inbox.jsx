import React, { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../components/ConversationList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import CustomerPanel from "../components/CustomerPanel.jsx";

export default function Inbox({ user }) {
  const [conversations, setConversations] = useState([]);
  const [active, setActive]               = useState(null);
  const [filterStatus, setFilterStatus]   = useState("");
  const [filterMine, setFilterMine]       = useState(false);
  const [search, setSearch]               = useState("");
  // Mobile: 'list' | 'chat'
  const [mobileView, setMobileView]       = useState("list");
  const [searchParams, setSearchParams]   = useSearchParams();
  const autoOpenDone = useRef(false);
  const loadRef      = useRef(null); // selalu pegang versi load() terbaru

  // SSE: refresh daftar percakapan saat ada pesan masuk (real-time, tanpa polling agresif)
  useSSE("new_message", () => { loadRef.current?.(); });

  async function handleSelect(conv) {
    setActive(conv);
    setMobileView("chat");
    if (conv.unread) {
      api.updateConversation(conv.id, { unread: false }).catch(() => {});
      setConversations((prev) =>
        prev.map((c) => c.id === conv.id ? { ...c, unread: false } : c)
      );
    }
  }

  useEffect(() => {
    async function load() {
      const data = await api.getConversations(filterStatus || undefined);
      setConversations(data);

      // Buka konversasi secara otomatis jika ada ?conv=ID di URL (dari klik toast)
      const convId = searchParams.get("conv");
      if (convId && !autoOpenDone.current) {
        const target = data.find((c) => c.id === convId);
        if (target) {
          autoOpenDone.current = true;
          handleSelect(target);
          setSearchParams({}, { replace: true }); // hapus query param dari URL
        }
      }
    }
    loadRef.current = load; // update ref supaya SSE callback pakai versi terbaru
    load();
    // SSE sebagai trigger utama — polling 60s hanya sebagai fallback
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [filterStatus]);

  const filtered = conversations.filter((c) => {
    if (filterMine && c.assignedToId !== user?.id) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.customer?.name?.toLowerCase().includes(q) ||
      c.customer?.phone?.includes(q) ||
      c.customer?.instagramHandle?.toLowerCase().includes(q) ||
      c.groupName?.toLowerCase().includes(q)
    );
  });

  function handleConversationUpdated(updated) {
    setConversations((prev) =>
      prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c)
    );
    if (active?.id === updated.id) setActive((prev) => ({ ...prev, ...updated }));
  }

  async function handlePin(convId, pinned) {
    try {
      await api.updateConversation(convId, { pinned });
      setConversations((prev) => {
        const updated = prev.map((c) =>
          c.id === convId ? { ...c, pinned, pinnedAt: pinned ? new Date().toISOString() : null } : c
        );
        // Sortir ulang secara optimistik: yang disematkan naik ke atas
        return updated.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.lastMessageAt) - new Date(a.lastMessageAt);
        });
      });
    } catch (err) {
      alert("Gagal: " + err.message);
    }
  }

  return (
    <div className={`inbox-body${mobileView === "chat" ? " mobile-chat-active" : ""}`}>
      <ConversationList
        conversations={filtered}
        activeId={active?.id}
        onSelect={handleSelect}
        filterStatus={filterStatus}
        onFilterStatus={(s) => { setFilterStatus(s); setFilterMine(false); }}
        filterMine={filterMine}
        onFilterMine={() => { setFilterMine((v) => !v); setFilterStatus(""); }}
        search={search}
        onSearch={setSearch}
        user={user}
        onPin={handlePin}
      />
      <ChatWindow
        conversation={active}
        user={user}
        onConversationUpdated={handleConversationUpdated}
        onBack={() => setMobileView("list")}
      />
      <CustomerPanel customerId={active?.customer?.id} conversation={active} />
    </div>
  );
}
