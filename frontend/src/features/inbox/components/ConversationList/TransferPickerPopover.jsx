// Popover transfer lead ke sales tertentu — ADMIN ONLY, dipicu tap badge
// status (OPEN/PENDING/RESOLVED) di ConversationItem.jsx. Web sebelumnya
// cuma punya "Ambil Alih" (ambil ke diri sendiri, lihat ChatWindow/index.jsx),
// tidak ada cara admin assign lead ke sales SPESIFIK tanpa buka chat dulu —
// pola & endpoint SAMA dengan mobile/src/components/TransferModal.js
// (PATCH /conversations/:id { assignedToId }), diadaptasi jadi popover kecil
// di posisi klik alih-alih bottom sheet (konsisten dgn conv-context-menu
// yang sudah ada di ConversationItem.jsx utk "Sematkan").
import React, { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { api } from "../../../../api.js";

export default function TransferPickerPopover({ x, y, conversationId, currentAssignedId, onClose, onTransferred }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    api.getUsers().then(setUsers).catch(() => setUsers([])).finally(() => setLoading(false));
  }, []);

  async function handleTransfer(userId) {
    if (transferring || userId === currentAssignedId) return;
    setTransferring(true);
    try {
      const updated = await api.updateConversation(conversationId, { assignedToId: userId });
      onTransferred?.(updated);
      onClose();
    } catch (err) {
      alert(err.message);
      setTransferring(false);
    }
  }

  const safeX = Math.min(x, window.innerWidth - 220);
  const safeY = Math.min(y, window.innerHeight - 300);

  return (
    <>
      <div className="conv-context-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="conv-context-menu transfer-picker-menu" style={{ left: safeX, top: safeY }}>
        <div className="transfer-picker-header">
          <UserCog size={13} style={{ color: "var(--primary)" }} />
          <span>Transfer ke Sales</span>
        </div>
        {loading ? (
          <div className="transfer-picker-empty">Memuat...</div>
        ) : users.length === 0 ? (
          <div className="transfer-picker-empty">Tidak ada user lain</div>
        ) : (
          users.map((u) => (
            <button
              key={u.id}
              className="transfer-picker-row"
              disabled={transferring || u.id === currentAssignedId}
              onClick={(e) => { e.stopPropagation(); handleTransfer(u.id); }}
            >
              <span className="transfer-picker-name">{u.name}</span>
              <span className="transfer-picker-role">
                {u.id === currentAssignedId ? "Sekarang" : (u.role === "ADMIN" ? "Admin" : "Sales")}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
