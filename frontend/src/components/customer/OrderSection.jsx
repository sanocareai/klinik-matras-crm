import React, { useState } from "react";
import { api } from "../../api.js";
import { formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES } from "../../utils/format.js";

export default function OrderSection({ customer, onUpdate }) {
  const [draft, setDraft] = useState({ value: "", quantity: 1 });

  const totalValue = customer.orders.reduce((sum, o) => sum + o.value, 0);

  async function handleAdd(e) {
    e.preventDefault();
    if (!draft.value) return;
    try {
      const order = await api.addOrder(customer.id, draft);
      onUpdate({ ...customer, orders: [order, ...customer.orders] });
      setDraft({ value: "", quantity: 1 });
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleStatusChange(orderId, status) {
    try {
      const updated = await api.updateOrder(orderId, { status });
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

      <form onSubmit={handleAdd} className="order-form">
        <input
          type="number"
          placeholder="Nilai order (Rp)"
          value={draft.value}
          onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
          required
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
      </form>

      <div className="order-list">
        {customer.orders.map((o) => (
          <div key={o.id} className="order-item">
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
        ))}
        {customer.orders.length === 0 && (
          <p className="text-small">Belum ada order.</p>
        )}
      </div>
    </div>
  );
}
