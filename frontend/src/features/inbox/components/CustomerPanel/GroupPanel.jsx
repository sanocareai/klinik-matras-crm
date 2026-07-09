import React from "react";
import { Users } from "lucide-react";
import MediaGallery from "./MediaGallery.jsx";

// TODO(backend): daftar member grup (nama+nomor) BELUM BISA ditampilkan —
// wahaClient.js tidak pernah memanggil endpoint WAHA group participants
// (grep "participant" di backend/src: nol hasil), dan Conversation tidak
// punya field jumlah member. groupName/groupJid yang ada sekarang cuma
// metadata pasif dari payload webhook pesan masuk, bukan dari API grup WAHA
// yang sesungguhnya. Untuk nampilkan member, perlu kerja backend baru:
// endpoint yang manggil GET /api/{session}/groups/{groupId}/participants
// di WAHA lalu di-serve ke frontend — di luar scope Fase E (frontend-only).
// Sampai itu ada, panel grup cuma nama grup + galeri media.
export default function GroupPanel({ conversation }) {
  const name = conversation?.groupName || conversation?.groupJid?.split("@")[0] || "Grup";

  return (
    <div className="customer-panel">
      <div className="panel-header">
        <div className="conv-group-avatar" style={{ width: 52, height: 52 }}>
          <Users size={26} />
        </div>
        <div className="panel-header-info">
          <p className="panel-name">{name}</p>
          <p className="panel-contact">Percakapan Grup WhatsApp</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="panel-section">
          <span className="panel-section-label">Media</span>
          <MediaGallery conversationId={conversation?.id} />
        </div>
      </div>
    </div>
  );
}
