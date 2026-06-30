import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "./Avatar.jsx";
import { formatTanggalWaktu } from "../utils/format.js";
import { api } from "../api.js";

export default function RecentConversations() {
  const [list, setList] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.getRecentConversations().then(setList).catch(() => {});
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="card recent-conv-card">
      <div className="section-header">
        <span className="section-title">Percakapan Terbaru</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => navigate("/inbox")}
        >
          Lihat semua
        </button>
      </div>
      <div className="conv-list-simple">
        {list.map((c) => {
          const name = c.customer?.name || c.customer?.phone || "Pelanggan";
          const lastMsg = c.messages?.[0];
          const channelClass = c.channel?.toLowerCase();
          const channelLabel = c.channel === "WHATSAPP" ? "WA" : "IG";
          return (
            <div
              key={c.id}
              className="conv-simple-item"
              onClick={() => navigate("/inbox")}
            >
              <Avatar name={name} size="md" />
              <div className="conv-simple-body">
                <div className="conv-simple-name">{name}</div>
                <div className="conv-simple-preview">
                  {lastMsg?.content || "Belum ada pesan"}
                </div>
              </div>
              <div className="conv-simple-meta">
                <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
                <span className="conv-simple-time">
                  {formatTanggalWaktu(c.lastMessageAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
