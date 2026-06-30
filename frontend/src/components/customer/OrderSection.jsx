import React, { useState } from "react";
import { api } from "../../api.js";
import { formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES } from "../../utils/format.js";

const JENIS_LAYANAN = [
  "Upgrade Lapisan Matras Sehat",
  "Upgrade Fondasi Matras Sehat",
  "Full Upgrade Lapisan dan Fondasi Matras Sehat",
  "Full Upgrade All In",
  "Full Service",
  "Ganti Kain",
  "Lainnya",
];

export default function OrderSection({ customer, onUpdate }) {
  const [draft, setDraft] = useState({ value: "", quantity: 1, notes: "" });

  const totalValue = customer.orders.reduce((sum, o) => sum + o.value, 0);

  async function handleAdd(e) {
    e.preventDefault();
    if (!draft.value) return;
    try {
      const order = await api.addOrder(customer.id, {
        value: draft.value,
        quantity: draft.quantity,
        notes: draft.notes || null,
      });
      onUpdate({ ...customer, orders: [order, ...customer.orders] });
      setDraft({ value: "", quantity: 1, notes: "" });
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleStatusChange(orderId, status) {
    try {
      const updated = await api.updateCustomerOrder(customer.id, orderId, { status });
      onUpdate({
        ...customer,
        orders: customer.orders.map((o) => (o.id === orderId ? updated : o)),
      });
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleLayananChange(orderId, notes) {
    try {
      const updated = await api.updateCustomerOrder(customer.id, orderId, { notes });
      onUpdate({
        ...customer,
        orders: customer.orders.map((o) => (o.id === orderId ? updated : o)),
      });
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <p className="text-muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
        {customer.orders.length} order · Total {formatRupiah(totalValue)}
      </p>

      {/* Form tambah order */}
      <form onSubmit={handleAdd} style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <select
          value={draft.notes}
          onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
          style={{ fontSize: 13, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-primary)", color: "var(--text-primary)" }}
        >
          <option value="">— Pilih Jenis Layanan —</option>
          {JENIS_LAYANAN.map((j) => (
            <option key={j} value={j}>{j}</option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            type="number"
            placeholder="Nilai order (Rp)"
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
            required
            style={{ flex: 1 }}
          />
          <input
            type="number"
            placeholder="Qty"
            value={draft.quantity}
            min="1"
            onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
            style={{ width: 60 }}
          />
          <button type="submit" className="btn btn-primary btn-sm">+ Order</button>
        </div>
      </form>

      {/* Daftar order */}
      <div className="order-list">
        {customer.orders.map((o) => (
          <div key={o.id} className="order-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            {/* Jenis layanan */}
            <select
              value={o.notes || ""}
              onChange={(e) => handleLayananChange(o.id, e.target.value)}
              style={{ fontSize: 12, padding: "4px 6px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)", width: "100%" }}
            >
              <option value="">— Jenis Layanan —</option>
              {JENIS_LAYANAN.map((j) => (
                <option key={j} value={j}>{j}</option>
              ))}
            </select>

            {/* Nilai + status */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div className="order-item-info">
                <span className="order-item-value">{formatRupiah(o.value)}</span>
                <span className="order-item-qty">{o.quantity}x unit</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className={`order-badge order-${o.status.toLowerCase()}`}>
                  {ORDER_STATUS_LABELS[o.status] || o.status}
                </span>
                <select
                  value={o.status}
                  onChange={(e) => handleStatusChange(o.id, e.target.value)}
                  style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4 }}
                >
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
        {customer.orders.length === 0 && (
          <p className="text-small">Belum ada order.</p>
        )}
      </div>
    </div>
  );
}
