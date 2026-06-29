import React, { useEffect, useState } from "react";
import { api } from "../api.js";

const STAGES = ["LEAD", "QUALIFIED", "QUOTED", "WON", "LOST"];
const ORDER_STATUSES = ["PENDING", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];

function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

export default function CustomerPanel({ customerId }) {
  const [customer, setCustomer] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [orderDraft, setOrderDraft] = useState({ value: "", quantity: 1 });
  const [cityDraft, setCityDraft] = useState("");

  useEffect(() => {
    if (!customerId) return;
    api.getCustomer(customerId).then((c) => {
      setCustomer(c);
      setCityDraft(c.city || "");
    });
  }, [customerId]);

  async function updateStage(pipelineStage) {
    const updated = await api.updateCustomer(customerId, { pipelineStage });
    setCustomer((c) => ({ ...c, ...updated }));
  }

  async function saveCity() {
    const updated = await api.updateCustomer(customerId, { city: cityDraft });
    setCustomer((c) => ({ ...c, ...updated }));
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!noteDraft.trim()) return;
    const note = await api.addNote(customerId, noteDraft);
    setCustomer((c) => ({ ...c, notes: [note, ...c.notes] }));
    setNoteDraft("");
  }

  async function handleAddOrder(e) {
    e.preventDefault();
    if (!orderDraft.value) return;
    const order = await api.addOrder(customerId, orderDraft);
    setCustomer((c) => ({ ...c, orders: [order, ...c.orders] }));
    setOrderDraft({ value: "", quantity: 1 });
  }

  async function updateOrderStatus(orderId, status) {
    const updated = await api.updateOrder(orderId, { status });
    setCustomer((c) => ({
      ...c,
      orders: c.orders.map((o) => (o.id === orderId ? updated : o)),
    }));
  }

  if (!customer) return <div className="customer-panel empty-state">—</div>;

  const totalOrderValue = customer.orders.reduce((sum, o) => sum + o.value, 0);

  return (
    <div className="customer-panel">
      <h3>{customer.name || "Pelanggan baru"}</h3>
      <p className="muted">{customer.phone || customer.instagramHandle}</p>

      <label>Kota</label>
      <div className="inline-field">
        <input value={cityDraft} onChange={(e) => setCityDraft(e.target.value)} placeholder="Kota" />
        <button onClick={saveCity}>Simpan</button>
      </div>

      <label>Tahap pipeline</label>
      <select value={customer.pipelineStage} onChange={(e) => updateStage(e.target.value)}>
        {STAGES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <label>Order ({customer.orders.length}) · Total {formatRupiah(totalOrderValue)}</label>
      <form onSubmit={handleAddOrder} className="order-form">
        <input
          type="number"
          placeholder="Nilai order (Rp)"
          value={orderDraft.value}
          onChange={(e) => setOrderDraft((d) => ({ ...d, value: e.target.value }))}
        />
        <input
          type="number"
          placeholder="Qty"
          value={orderDraft.quantity}
          onChange={(e) => setOrderDraft((d) => ({ ...d, quantity: e.target.value }))}
        />
        <button type="submit">+ Order</button>
      </form>
      <div className="order-list">
        {customer.orders.map((o) => (
          <div key={o.id} className="order-item">
            <span>{formatRupiah(o.value)} · {o.quantity}x</span>
            <select value={o.status} onChange={(e) => updateOrderStatus(o.id, e.target.value)}>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <label>Catatan</label>
      <form onSubmit={handleAddNote} className="note-form">
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Tambah catatan tentang pelanggan ini..."
        />
        <button type="submit">Simpan catatan</button>
      </form>

      <div className="note-list">
        {customer.notes?.map((n) => (
          <div key={n.id} className="note-item">
            <p>{n.content}</p>
            <span className="muted">{n.author?.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
