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
import { isAdminUser, rolesOf } from "@/lib/roles.js";
import { formatRupiah } from "@/utils/format.js";
import { pilihanAwal, validasiKeputusan, buatPayloadTransfer, ringkasanKeputusan } from "../../kreditTransferLogic.js";

// Hanya Sales/Admin AKTIF yang boleh menerima transfer (sama dengan server, utils/perpindahanPercakapan.js).
const bolehMenerimaTransfer = (u) => u?.active !== false && rolesOf(u).some((r) => r === "SALES" || r === "ADMIN");

export default function TransferPickerPopover({ x, y, conversationId, currentAssignedId, onClose, onTransferred }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [transferring, setTransferring] = useState(false);
  // Langkah 2 (kredit closing): muncul bila ada order atas nama pemegang lama. null = masih memilih orang.
  const [keputusan, setKeputusan] = useState(null); // { user, dari, penerimaSales, orders, pilihan, alasan }

  useEffect(() => {
    api.getUsers().then((list) => setUsers((list || []).filter(bolehMenerimaTransfer))).catch(() => setUsers([])).finally(() => setLoading(false));
  }, []);

  async function kirimTransfer(data) {
    setTransferring(true);
    try {
      const updated = await api.updateConversation(conversationId, data);
      onTransferred?.(updated);
      onClose();
    } catch (err) {
      alert(err.message);
      setTransferring(false);
    }
  }

  async function handleTransfer(user) {
    if (transferring || user.id === currentAssignedId) return;
    setTransferring(true);
    let info;
    try {
      info = await api.getOrderTerdampakTransfer(conversationId, user.id);
    } catch (err) {
      alert(err.message);
      setTransferring(false);
      return;
    }
    if (!info.orders?.length) { await kirimTransfer({ assignedToId: user.id }); return; }
    setKeputusan({ user, dari: info.dari, penerimaSales: !!info.penerimaSales, orders: info.orders, pilihan: pilihanAwal(info.orders, info.penerimaSales), alasan: "" });
    setTransferring(false);
  }

  if (keputusan) {
    const { user, dari, penerimaSales, orders, pilihan, alasan } = keputusan;
    const galat = validasiKeputusan({ pilihan, alasan, penerimaSales });
    const safeX2 = Math.min(x, window.innerWidth - 400);
    const safeY2 = Math.min(y, Math.max(8, window.innerHeight - 460));
    return (
      <>
        <div className="conv-context-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }} />
        <div className="conv-context-menu transfer-picker-menu" style={{ left: safeX2, top: safeY2, width: 380, maxHeight: 440 }} onClick={(e) => e.stopPropagation()} data-testid="dialog-kredit-transfer">
          <div className="transfer-picker-header">
            <UserCog size={13} style={{ color: "var(--primary)" }} />
            <span>Transfer ke {user.name}</span>
          </div>
          <div style={{ padding: "8px 14px", fontSize: 12.5, lineHeight: 1.45, color: "var(--text-secondary, #475569)" }}>
            {orders.length} order masih atas nama <b>{dari?.name || "pemegang lama"}</b>. Tentukan kreditnya
            {penerimaSales ? <> — <b>ikut</b> ke {user.name} atau <b>tetap</b> di {dari?.name || "pemegang lama"}.</> : <>. {user.name} bukan Sales, jadi semua order <b>tetap</b> di {dari?.name || "pemegang lama"}.</>}
          </div>
          <div style={{ padding: "0 14px", maxHeight: 220, overflowY: "auto" }}>
            {orders.map((o) => (
              <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid #f1f5f9", cursor: penerimaSales ? "pointer" : "default", opacity: penerimaSales ? 1 : 0.65 }}>
                <input
                  type="checkbox" disabled={!penerimaSales || transferring} checked={!!pilihan[o.id]}
                  onChange={(e) => setKeputusan({ ...keputusan, pilihan: { ...pilihan, [o.id]: e.target.checked } })}
                  data-testid={`ikut-${o.orderNumber}`}
                />
                <span style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                  <b>{o.orderNumber}</b> · {formatRupiah(o.value)}<br />
                  <span style={{ color: "var(--text-muted, #64748b)" }}>
                    {o.paymentStatus === "LUNAS" ? "Sudah lunas — komisi sudah terhitung" : o.paymentStatus === "DP" ? "DP" : "Belum bayar"}
                    {o.sumber === "PEMILIK_ORDER" ? " · pemilik order tercatat" : " · mengikuti pemegang chat"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {penerimaSales && Object.values(pilihan).some(Boolean) && (
            <div style={{ padding: "8px 14px 0" }}>
              <input
                type="text" value={alasan} maxLength={300} placeholder="Alasan memindahkan kredit (wajib)"
                onChange={(e) => setKeputusan({ ...keputusan, alasan: e.target.value })}
                style={{ width: "100%", fontSize: 13, padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6 }}
                data-testid="alasan-kredit"
              />
            </div>
          )}
          <div style={{ padding: "8px 14px 0", fontSize: 12, color: "var(--text-muted, #64748b)" }}>
            {ringkasanKeputusan({ orders, pilihan, penerimaSales, namaPenerima: user.name })}
          </div>
          {galat && <div style={{ padding: "4px 14px 0", fontSize: 12, color: "#dc2626" }}>{galat}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 14px 12px" }}>
            <button type="button" onClick={onClose} disabled={transferring} style={{ padding: "6px 12px", fontSize: 13 }}>Batal</button>
            <button
              type="button" disabled={transferring || !!galat} data-testid="kirim-transfer"
              onClick={() => kirimTransfer(buatPayloadTransfer({ userId: user.id, orders, pilihan, alasan, penerimaSales }))}
              style={{ padding: "6px 12px", fontSize: 13, fontWeight: 700, background: "var(--primary, #2563eb)", color: "#fff", borderRadius: 6, opacity: galat ? 0.5 : 1 }}
            >
              {transferring ? "Memproses…" : "Transfer"}
            </button>
          </div>
        </div>
      </>
    );
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
              onClick={(e) => { e.stopPropagation(); handleTransfer(u); }}
            >
              <span className="transfer-picker-name">{u.name}</span>
              <span className="transfer-picker-role">
                {u.id === currentAssignedId ? "Sekarang" : (isAdminUser(u) ? "Admin" : "Sales")}
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
