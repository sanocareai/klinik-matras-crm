import React, { useState } from "react";
import { api } from "../../api.js";
import { formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES, UKURAN_KASUR, MERK_KASUR } from "../../utils/format.js";

const JENIS_LAYANAN = [
  "Upgrade Lapisan Matras Sehat",
  "Upgrade Fondasi Matras Sehat",
  "Full Upgrade Lapisan dan Fondasi Matras Sehat",
  "Full Upgrade All In",
  "Full Service",
  "Ganti Kain",
  "Lainnya",
];

// Parse notes dari JSON; backward-compat: jika bukan JSON, anggap itu jenis layanan lama (plain text)
function parseNotes(notes) {
  if (!notes) return { jenisLayanan: "", merkKasur: "", ukuranKasur: "", keluhanCustomer: "", beratBadan: "" };
  try {
    const p = JSON.parse(notes);
    return {
      jenisLayanan: p.jenisLayanan || "",
      merkKasur: p.merkKasur || "",
      ukuranKasur: p.ukuranKasur || "",
      keluhanCustomer: p.keluhanCustomer || "",
      beratBadan: p.beratBadan || "",
    };
  } catch {
    return { jenisLayanan: notes, merkKasur: "", ukuranKasur: "", keluhanCustomer: "", beratBadan: "" };
  }
}

function buildNotes(info) {
  return JSON.stringify(info);
}

const EMPTY_DRAFT = {
  value: "", merkKasur: "", ukuranKasur: "",
  keluhanCustomer: "", beratBadan: "", jenisLayanan: "",
};

// Kartu order individual — punya state sendiri untuk text fields (blur-to-save)
function OrderCard({ order, customerId, onUpdate }) {
  const info = parseNotes(order.notes);
  const [keluhan, setKeluhan] = useState(info.keluhanCustomer);
  const [berat, setBerat] = useState(info.beratBadan);

  async function handleSelectChange(field, value) {
    try {
      const latest = parseNotes(order.notes);
      latest[field] = value;
      const updated = await api.updateCustomerOrder(customerId, order.id, { notes: buildNotes(latest) });
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleStatusChange(status) {
    try {
      const updated = await api.updateCustomerOrder(customerId, order.id, { status });
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    }
  }

  async function saveTextField() {
    try {
      const latest = parseNotes(order.notes);
      latest.keluhanCustomer = keluhan;
      latest.beratBadan = berat;
      const updated = await api.updateCustomerOrder(customerId, order.id, { notes: buildNotes(latest) });
      onUpdate(updated);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="order-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      {/* Nilai + badge status + dropdown ganti status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="order-item-value">{formatRupiah(order.value)}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className={`order-badge order-${order.status.toLowerCase()}`}>
            {ORDER_STATUS_LABELS[order.status] || order.status}
          </span>
          <select
            value={order.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            style={{ fontSize: 11, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Merk + Ukuran berdampingan */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div>
          <span style={metaLabel}>Merk Kasur</span>
          <select value={info.merkKasur} onChange={(e) => handleSelectChange("merkKasur", e.target.value)} style={inlineSelect}>
            <option value="">—</option>
            {MERK_KASUR.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <span style={metaLabel}>Ukuran</span>
          <select value={info.ukuranKasur} onChange={(e) => handleSelectChange("ukuranKasur", e.target.value)} style={inlineSelect}>
            <option value="">—</option>
            {UKURAN_KASUR.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>

      {/* Jenis Layanan */}
      <div>
        <span style={metaLabel}>Jenis Layanan</span>
        <select value={info.jenisLayanan} onChange={(e) => handleSelectChange("jenisLayanan", e.target.value)} style={inlineSelect}>
          <option value="">—</option>
          {JENIS_LAYANAN.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
      </div>

      {/* Keluhan Customer */}
      <div>
        <span style={metaLabel}>Keluhan Customer</span>
        <textarea
          value={keluhan}
          onChange={(e) => setKeluhan(e.target.value)}
          onBlur={saveTextField}
          placeholder="Keluhan kasur customer..."
          rows={2}
          style={{ ...inlineSelect, resize: "vertical" }}
        />
      </div>

      {/* Berat Badan */}
      <div>
        <span style={metaLabel}>Berat Badan</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="number"
            value={berat}
            onChange={(e) => setBerat(e.target.value)}
            onBlur={saveTextField}
            placeholder="—"
            min="1"
            style={{ ...inlineSelect, width: 72 }}
          />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>kg</span>
        </div>
      </div>
    </div>
  );
}

export default function OrderSection({ customer, onUpdate }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [showForm, setShowForm] = useState(false);

  const totalValue = customer.orders.reduce((sum, o) => sum + o.value, 0);

  function setD(field, val) {
    setDraft((d) => ({ ...d, [field]: val }));
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!draft.value) return;
    try {
      const order = await api.addOrder(customer.id, {
        value: draft.value,
        quantity: 1,
        notes: buildNotes({
          merkKasur: draft.merkKasur,
          ukuranKasur: draft.ukuranKasur,
          keluhanCustomer: draft.keluhanCustomer,
          beratBadan: draft.beratBadan,
          jenisLayanan: draft.jenisLayanan,
        }),
      });
      onUpdate({ ...customer, orders: [order, ...customer.orders] });
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
    } catch (err) {
      alert(err.message);
    }
  }

  function handleOrderUpdate(updatedOrder) {
    onUpdate({
      ...customer,
      orders: customer.orders.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)),
    });
  }

  return (
    <div>
      {/* Header: total + tombol + Order */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          {customer.orders.length} order · Total {formatRupiah(totalValue)}
        </p>
        <button
          className={`btn btn-sm ${showForm ? "btn-secondary" : "btn-primary"}`}
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Batal" : "+ Order"}
        </button>
      </div>

      {/* Form tambah order baru */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, padding: 14, background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border)" }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>Order Baru</p>

          <div>
            <label style={formLabel}>Merk Kasur</label>
            <select value={draft.merkKasur} onChange={(e) => setD("merkKasur", e.target.value)} style={formSelect}>
              <option value="">— Pilih Merk —</option>
              {MERK_KASUR.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div>
            <label style={formLabel}>Ukuran Kasur</label>
            <select value={draft.ukuranKasur} onChange={(e) => setD("ukuranKasur", e.target.value)} style={formSelect}>
              <option value="">— Pilih Ukuran —</option>
              {UKURAN_KASUR.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>

          <div>
            <label style={formLabel}>Keluhan Customer</label>
            <textarea
              value={draft.keluhanCustomer}
              onChange={(e) => setD("keluhanCustomer", e.target.value)}
              placeholder="Jelaskan keluhan kasur yang dirasakan customer..."
              rows={3}
              style={{ ...formSelect, resize: "vertical" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={formLabel}>Berat Badan (kg)</label>
              <input
                type="number"
                placeholder="kg"
                value={draft.beratBadan}
                onChange={(e) => setD("beratBadan", e.target.value)}
                min="1"
                style={formSelect}
              />
            </div>
            <div style={{ flex: 2 }}>
              <label style={formLabel}>Nilai Order (Rp) *</label>
              <input
                type="number"
                placeholder="Nilai (Rp)"
                value={draft.value}
                onChange={(e) => setD("value", e.target.value)}
                required
                style={formSelect}
              />
            </div>
          </div>

          <div>
            <label style={formLabel}>Jenis Layanan</label>
            <select value={draft.jenisLayanan} onChange={(e) => setD("jenisLayanan", e.target.value)} style={formSelect}>
              <option value="">— Pilih Jenis Layanan —</option>
              {JENIS_LAYANAN.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
            Simpan Order
          </button>
        </form>
      )}

      {/* Daftar order yang sudah ada */}
      <div className="order-list">
        {customer.orders.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            customerId={customer.id}
            onUpdate={handleOrderUpdate}
          />
        ))}
        {customer.orders.length === 0 && (
          <p className="text-small">Belum ada order. Klik "+ Order" untuk menambah.</p>
        )}
      </div>
    </div>
  );
}

const formLabel = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  marginBottom: 4,
};

const formSelect = {
  fontSize: 13,
  padding: "7px 9px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  width: "100%",
};

const inlineSelect = {
  fontSize: 11,
  padding: "4px 6px",
  borderRadius: 5,
  border: "1px solid var(--border)",
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  width: "100%",
};

const metaLabel = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 3,
};
