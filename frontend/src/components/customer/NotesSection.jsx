import React, { useState } from "react";
import { api } from "../../api.js";
import { formatTanggalWaktu } from "../../utils/format.js";

// Decode JWT dari localStorage untuk tahu userId yang sedang login
function getCurrentUser() {
  try {
    const token = localStorage.getItem("token");
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1]));
    return { id: payload.id, role: payload.role };
  } catch { return null; }
}

export default function NotesSection({ customer, onUpdate }) {
  const [draft, setDraft]         = useState("");
  const [editId, setEditId]       = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [loading, setLoading]     = useState(false);

  const me = getCurrentUser();

  async function handleAdd(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      const note = await api.addNote(customer.id, draft);
      onUpdate({ ...customer, notes: [note, ...(customer.notes || [])] });
      setDraft("");
    } catch (err) {
      alert(err.message);
    }
  }

  function startEdit(note) {
    setEditId(note.id);
    setEditDraft(note.content);
  }

  function cancelEdit() {
    setEditId(null);
    setEditDraft("");
  }

  async function handleSaveEdit(note) {
    if (!editDraft.trim()) return;
    setLoading(true);
    try {
      const updated = await api.updateNote(note.id, editDraft);
      onUpdate({
        ...customer,
        notes: (customer.notes || []).map((n) => (n.id === note.id ? updated : n)),
      });
      setEditId(null);
      setEditDraft("");
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(note) {
    if (!window.confirm("Hapus catatan ini?")) return;
    try {
      await api.deleteNote(note.id);
      onUpdate({
        ...customer,
        notes: (customer.notes || []).filter((n) => n.id !== note.id),
      });
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <form onSubmit={handleAdd} className="note-form" style={{ marginBottom: 12 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tulis catatan tentang pelanggan ini..."
          rows={3}
        />
        <button type="submit" className="btn btn-secondary btn-sm">Simpan catatan</button>
      </form>

      <div className="note-list">
        {(customer.notes || []).map((n) => {
          const canEdit = me && (me.id === n.authorId || me.role === "ADMIN");
          const isEditing = editId === n.id;

          return (
            <div key={n.id} className="note-item">
              {isEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={3}
                    autoFocus
                    style={{ fontSize: 13, padding: 8, borderRadius: 6, border: "1px solid var(--border)", resize: "vertical", width: "100%" }}
                  />
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleSaveEdit(n)}
                      disabled={loading || !editDraft.trim()}
                    >
                      Simpan
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>Batal</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ margin: "0 0 4px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.content}</p>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span className="note-meta">
                      {n.author?.name}
                      {n.createdAt && <> · {formatTanggalWaktu(n.createdAt)}</>}
                    </span>
                    {canEdit && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => startEdit(n)}
                          title="Edit catatan"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 13, padding: "2px 4px", lineHeight: 1 }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(n)}
                          title="Hapus catatan"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 13, padding: "2px 4px", lineHeight: 1 }}
                        >
                          🗑️
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {(!customer.notes || customer.notes.length === 0) && (
          <p className="text-small">Belum ada catatan.</p>
        )}
      </div>
    </div>
  );
}
