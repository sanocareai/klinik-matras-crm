import React, { useState } from "react";
import { api } from "../../api.js";
import { formatTanggalWaktu } from "../../utils/format.js";

export default function NotesSection({ customer, onUpdate }) {
  const [draft, setDraft] = useState("");

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
        {(customer.notes || []).map((n) => (
          <div key={n.id} className="note-item">
            <p>{n.content}</p>
            <span className="note-meta">
              {n.author?.name}
              {n.createdAt && <> · {formatTanggalWaktu(n.createdAt)}</>}
            </span>
          </div>
        ))}
        {(!customer.notes || customer.notes.length === 0) && (
          <p className="text-small">Belum ada catatan.</p>
        )}
      </div>
    </div>
  );
}
