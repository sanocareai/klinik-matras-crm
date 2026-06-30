import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import ConversationList from "../components/ConversationList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import CustomerPanel from "../components/CustomerPanel.jsx";

export default function Inbox() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive]               = useState(null);
  const [filterStatus, setFilterStatus]   = useState("");
  const [search, setSearch]               = useState("");

  useEffect(() => {
    async function load() {
      const data = await api.getConversations(filterStatus || undefined);
      setConversations(data);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [filterStatus]);

  // Filter client-side by search
  const filtered = conversations.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.customer?.name?.toLowerCase().includes(q) ||
      c.customer?.phone?.includes(q) ||
      c.customer?.instagramHandle?.toLowerCase().includes(q)
    );
  });

  function handleConversationUpdated(updated) {
    setConversations((prev) =>
      prev.map((c) => c.id === updated.id ? { ...c, ...updated } : c)
    );
    if (active?.id === updated.id) setActive((prev) => ({ ...prev, ...updated }));
  }

  return (
    <div className="inbox-body">
      <ConversationList
        conversations={filtered}
        activeId={active?.id}
        onSelect={setActive}
        filterStatus={filterStatus}
        onFilterStatus={setFilterStatus}
        search={search}
        onSearch={setSearch}
      />
      <ChatWindow
        conversation={active}
        onConversationUpdated={handleConversationUpdated}
      />
      <CustomerPanel customerId={active?.customer?.id} />
    </div>
  );
}
