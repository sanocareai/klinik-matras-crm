import React from "react";
import Customer360 from "./customer360/Customer360.jsx";

// Wave 3A: CustomerDrawer jadi SHELL TIPIS — mekanik overlay + panel (slide-in,
// dari index.css) dipertahankan, isinya dirender oleh Customer360. Props PUBLIK
// (customerId / onClose / onUpdated) TIDAK berubah → Customers.jsx tidak disentuh.
// Panel dilebarkan (min(880px,96vw)) agar layout 2 kolom 360 muat; di mobile
// tetap full-width (aturan `.drawer-panel { width:100vw !important }` menang).
export default function CustomerDrawer({ customerId, onClose, onUpdated }) {
  if (!customerId) return null;
  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div
        className="drawer-panel"
        style={{ width: "min(880px, 96vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Customer360 customerId={customerId} onClose={onClose} onUpdated={onUpdated} />
      </div>
    </div>
  );
}
