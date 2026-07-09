import React from "react";
import OrderSection from "../../../../components/customer/OrderSection.jsx";

// Reuse komponen order editor yang sudah ada (dipakai juga di CustomerDrawer,
// jadi satu sumber kebenaran untuk logika order — kategori LAYANAN/BARU/SEWA,
// OrderItem, berat badan, komplain, dll — tidak perlu ditulis ulang).
export default function OrdersSection({ customer, onUpdate }) {
  return (
    <div className="panel-section">
      <span className="panel-section-label">Order</span>
      <OrderSection customer={customer} onUpdate={onUpdate} />
    </div>
  );
}
