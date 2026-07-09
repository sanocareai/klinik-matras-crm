import React from "react";
import NotesSectionOld from "../../../../components/customer/NotesSection.jsx";

// Reuse komponen catatan yang sudah ada (add/edit/delete + cek penulis lewat
// JWT) — sama seperti OrdersSection, satu sumber kebenaran.
export default function NotesSection({ customer, onUpdate }) {
  return (
    <div className="panel-section">
      <span className="panel-section-label">Catatan</span>
      <NotesSectionOld customer={customer} onUpdate={onUpdate} />
    </div>
  );
}
