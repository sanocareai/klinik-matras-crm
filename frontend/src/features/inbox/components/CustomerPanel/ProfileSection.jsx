import React, { useState } from "react";
import { Copy, Check, Pencil } from "lucide-react";
import Avatar from "../../../../components/Avatar.jsx";
import { api } from "../../../../api.js";
import { formatPhoneDisplay } from "../../../../utils/format.js";

// Avatar besar + nama (inline edit) + nomor WA + salin nomor + badge sesi CS.
// ⚠️ Badge CS-1/CS-2: field sessionId belum ada di schema Conversation
// (lihat CLAUDE.md §"Multi-session WAHA") — badge otomatis tidak muncul
// sampai backend menambahkannya, kode di bawah sudah siap pakai.
export default function ProfileSection({ customer, conversation, onUpdate }) {
  const [editing, setEditing]   = useState(false);
  const [nameDraft, setNameDraft] = useState(customer.name || "");
  const [saving, setSaving]     = useState(false);
  const [copied, setCopied]     = useState(false);

  const displayName = customer.name || (customer.phone ? formatPhoneDisplay(customer.phone) : null) || customer.instagramHandle || "Pelanggan";
  const sessionLabel = conversation?.sessionId === "CS-1" || conversation?.sessionId === "CS-2" ? conversation.sessionId : null;

  async function saveName() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await api.updateCustomer(customer.id, { name: nameDraft.trim() || null });
      onUpdate((c) => ({ ...c, ...updated }));
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  function copyPhone() {
    if (!customer.phone) return;
    navigator.clipboard?.writeText(customer.phone).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="profile-section">
      <Avatar name={displayName} src={customer.profilePictureUrl} size="xl" />

      {editing ? (
        <div className="profile-name-edit">
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            placeholder="Nama pelanggan..."
          />
          <button className="btn btn-secondary btn-sm" onClick={saveName} disabled={saving}>{saving ? "..." : "Simpan"}</button>
        </div>
      ) : (
        <div className="profile-name-row">
          <p className="panel-name">{displayName}</p>
          <button className="panel-edit-btn" onClick={() => { setNameDraft(customer.name || ""); setEditing(true); }} title="Ubah nama">
            <Pencil size={13} />
          </button>
        </div>
      )}

      <div className="profile-phone-row">
        <p className="panel-contact">{formatPhoneDisplay(customer.phone) || customer.instagramHandle || "—"}</p>
        {customer.phone && (
          <button className="profile-copy-btn" onClick={copyPhone} title="Salin nomor WhatsApp">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
      </div>

      {sessionLabel && <span className="session-badge" style={{ marginTop: 6 }}>{sessionLabel}</span>}
    </div>
  );
}
