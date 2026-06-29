import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import ConversationList from "../components/ConversationList.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import CustomerPanel from "../components/CustomerPanel.jsx";

export default function Inbox() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    async function load() {
      const data = await api.getConversations();
      setConversations(data);
    }
    load();
    const interval = setInterval(load, 5000); // polling sederhana untuk Phase 1
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="inbox-body">
      <ConversationList
        conversations={conversations}
        activeId={active?.id}
        onSelect={setActive}
      />
      <ChatWindow conversation={active} />
      <CustomerPanel customerId={active?.customer?.id} />
    </div>
  );
}
