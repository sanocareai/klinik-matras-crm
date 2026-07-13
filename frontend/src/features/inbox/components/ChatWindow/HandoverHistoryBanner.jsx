// Riwayat LENGKAP siapa saja yang pernah menangani percakapan ini —
// menggantikan rencana lama "Context Banner" yang cuma akan tampilkan 1
// handoverNote terakhir (field itu masih ada, dipertahankan buat
// kompatibilitas, tapi TIDAK PERNAH ada UI yang menampilkannya — lihat
// backend/src/routes/conversations.js). Banner ini pakai HandoverEvent
// (tabel baru, log SETIAP takeover/transfer), jadi langsung tampilkan
// timeline penuh, bukan cuma catatan terakhir.
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { api } from "../../../../api.js";

function formatEventTime(iso) {
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function HandoverHistoryBanner({ conversationId }) {
  const [events, setEvents] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setEvents(null);
    setExpanded(false);
    if (!conversationId) return;
    api.getHandoverHistory(conversationId).then(setEvents).catch(() => setEvents([]));
  }, [conversationId]);

  if (!events || events.length === 0) return null;

  return (
    <div className="handover-history-banner">
      <button className="handover-history-toggle" onClick={() => setExpanded((v) => !v)}>
        <History size={13} />
        <span>Riwayat Penanganan ({events.length})</span>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {expanded && (
        <div className="handover-history-list">
          {events.map((e) => (
            <div key={e.id} className="handover-history-item">
              <span className="handover-history-text">
                {e.fromUser
                  ? <>Diambil alih dari <strong>{e.fromUser.name}</strong> oleh <strong>{e.toUser.name}</strong></>
                  : <><strong>{e.toUser.name}</strong> mengambil percakapan ini</>}
                {e.reason === "transfer" && " (transfer admin)"}
              </span>
              <span className="handover-history-time">{formatEventTime(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
