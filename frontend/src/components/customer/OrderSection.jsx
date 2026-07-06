import React, { useState } from "react";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { api } from "../../api.js";
import {
  formatRupiah, ORDER_STATUS_LABELS, ORDER_STATUSES,
  PAYMENT_STATUS_LABELS, PAYMENT_STATUS_BADGE, PAYMENT_STATUSES,
  UKURAN_KASUR, MERK_KASUR,
} from "../../utils/format.js";

const JENIS_LAYANAN = [
  "Upgrade Lapisan Matras Sehat",
  "Upgrade Fondasi Matras Sehat",
  "Full Upgrade Lapisan dan Fondasi Matras Sehat",
  "Full Upgrade All In",
  "Full Service",
  "Ganti Kain",
  "Lainnya",
];

function parseNotes(notes) {
  if (!notes) return { merkKasur: "", ukuranKasur: "", keluhanCustomer: "" };
  try {
    const p = JSON.parse(notes);
    return {
      merkKasur: p.merkKasur || "",
      ukuranKasur: p.ukuranKasur || "",
      keluhanCustomer: p.keluhanCustomer || "",
    };
  } catch {
    return { merkKasur: "", ukuranKasur: "", keluhanCustomer: notes, beratBadan: "" };
  }
}

function buildNotes(info) {
  return JSON.stringify({
    merkKasur:       info.merkKasur || "",
    ukuranKasur:     info.ukuranKasur || "",
    keluhanCustomer: info.keluhanCustomer || "",
  });
}

function newItem() {
  return { key: Date.now() + Math.random(), layananName: "", harga: "" };
}

const ORDER_STATUS_BADGE = {
  PENDING:    { bg: "#fef3c7", color: "#92400e" },
  PICKUP:     { bg: "#dbeafe", color: "#1e40af" },
  PROCESSING: { bg: "#ede9fe", color: "#5b21b6" },
  READY:      { bg: "#ccfbf1", color: "#065f46" },
  DELIVERED:  { bg: "#dcfce7", color: "#166534" },
  CANCELLED:  { bg: "#fee2e2", color: "#991b1b" },
};

// ─── Detail order yang bisa di-expand ────────────────────────────────────────
function OrderDetail({ order, customerId, onRefresh, onDelete }) {
  const info = parseNotes(order.notes);
  const [editing, setEditing]             = useState(false);
  const [status, setStatus]               = useState(order.status);
  const [paymentStatus, setPaymentStatus] = useState(order.paymentStatus || "BELUM_BAYAR");
  const [orderNumber, setOrderNumber]     = useState(order.orderNumber || "");
  const [beratBadan, setBeratBadan]       = useState(order.beratBadan ? String(order.beratBadan) : "");
  const [merkKasur, setMerkKasur]     = useState(info.merkKasur);
  const [ukuran, setUkuran]           = useState(info.ukuranKasur);
  const [keluhan, setKeluhan]         = useState(info.keluhanCustomer);
  const [items, setItems]             = useState(
    (order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) }))
  );
  const [saving, setSaving]           = useState(false);
  const [deleting, setDeleting]       = useState(false);

  const totalItems = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => p.filter((it) => it.key !== key)); }
  function setItemField(key, field, val) {
    setItems((p) => p.map((it) => it.key === key ? { ...it, [field]: val } : it));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateOrder(order.id, {
        status,
        paymentStatus,
        beratBadan: beratBadan ? Number(beratBadan) : null,
        notes: buildNotes({ merkKasur, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
        orderNumber: orderNumber.trim() || null,
      });
      const existingIds = (order.items || []).map((it) => it.id);
      const currentIds  = items.filter((it) => it.id).map((it) => it.id);
      for (const id of existingIds) {
        if (!currentIds.includes(id)) await api.deleteOrderItem(id);
      }
      for (const it of items.filter((it) => it.id)) {
        if (it.layananName?.trim())
          await api.updateOrderItem(it.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
      }
      for (const it of items.filter((it) => !it.id)) {
        if (it.layananName?.trim())
          await api.addOrderItem(order.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
      }
      setEditing(false);
      onRefresh();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    const inf = parseNotes(order.notes);
    setStatus(order.status);
    setPaymentStatus(order.paymentStatus || "BELUM_BAYAR");
    setOrderNumber(order.orderNumber || "");
    setBeratBadan(order.beratBadan ? String(order.beratBadan) : "");
    setMerkKasur(inf.merkKasur);
    setUkuran(inf.ukuranKasur);
    setKeluhan(inf.keluhanCustomer);
    setItems((order.items || []).map((it) => ({ ...it, key: it.id, harga: String(it.harga) })));
    setEditing(false);
  }

  async function handleDelete() {
    if (!confirm("Hapus order ini? Semua item layanan juga akan dihapus.")) return;
    setDeleting(true);
    try {
      await api.deleteOrder(order.id);
      onDelete(order.id);
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  }

  return (
    <div style={{ padding: "12px 14px", background: "#fafafa", borderTop: "1px solid var(--border)" }}>
      {/* Tombol aksi */}
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginBottom: 10 }}>
        {!editing ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button
              className="btn btn-sm"
              onClick={handleDelete}
              disabled={deleting}
              style={{ background: "#fee2e2", color: "#991b1b", border: "none", cursor: "pointer", borderRadius: 6, padding: "4px 10px", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
            >
              <Trash2 size={12} /> {deleting ? "..." : "Hapus"}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? "..." : "Simpan"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel} disabled={saving}>Batal</button>
          </>
        )}
      </div>

      {/* Status Pengerjaan + Status Pembayaran — dalam 1 baris di view mode */}
      <div style={{ marginBottom: 8 }}>
        <span style={metaLabel}>Status</span>
        {editing ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selStyleFull}>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
              ))}
            </select>
            <select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} style={selStyleFull}>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s] || s}</option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, ...ORDER_STATUS_BADGE[order.status] }}>
              {ORDER_STATUS_LABELS[order.status] || order.status}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 6, ...PAYMENT_STATUS_BADGE[order.paymentStatus || "BELUM_BAYAR"] }}>
              {PAYMENT_STATUS_LABELS[order.paymentStatus || "BELUM_BAYAR"]}
            </span>
            <select
              value={order.status}
              onChange={async (e) => {
                try { await api.updateOrder(order.id, { status: e.target.value }); onRefresh(); }
                catch (err) { alert(err.message); }
              }}
              style={{ ...selStyle, fontSize: 11 }}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s] || s}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ID Order */}
      <div style={{ marginBottom: 8 }}>
        <span style={metaLabel}>ID Order</span>
        {editing ? (
          <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="cth: ORD-001" style={selStyleFull} />
        ) : (
          <span style={{ fontSize: 13 }}>{order.orderNumber || <span style={{ color: "var(--text-muted)" }}>—</span>}</span>
        )}
      </div>

      {/* Berat Badan */}
      <div style={{ marginBottom: 8 }}>
        <span style={metaLabel}>Berat Badan (kg)</span>
        {editing ? (
          <input
            type="number" value={beratBadan} onChange={(e) => setBeratBadan(e.target.value)}
            placeholder="cth: 75" min="1" max="300"
            style={{ ...selStyleFull, width: 100 }}
          />
        ) : (
          <span style={{ fontSize: 13 }}>
            {order.beratBadan ? `${order.beratBadan} kg` : <span style={{ color: "var(--text-muted)" }}>—</span>}
          </span>
        )}
      </div>

      {/* Merk + Ukuran */}
      {editing ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 8 }}>
          <div>
            <span style={metaLabel}>Merk Kasur</span>
            <select value={merkKasur} onChange={(e) => setMerkKasur(e.target.value)} style={selStyleFull}>
              <option value="">—</option>
              {MERK_KASUR.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <span style={metaLabel}>Ukuran</span>
            <select value={ukuran} onChange={(e) => setUkuran(e.target.value)} style={selStyleFull}>
              <option value="">—</option>
              {UKURAN_KASUR.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
      ) : (info.merkKasur || info.ukuranKasur) ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {info.merkKasur && <span style={chipStyle}>{info.merkKasur}</span>}
          {info.ukuranKasur && <span style={chipStyle}>{info.ukuranKasur}</span>}
        </div>
      ) : null}

      {/* Items layanan */}
      {editing ? (
        <div style={{ marginBottom: 8 }}>
          <span style={metaLabel}>Layanan (add-ons)</span>
          {items.map((it) => (
            <div key={it.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 5 }}>
              <input
                list="layanan-suggestions"
                value={it.layananName}
                onChange={(e) => setItemField(it.key, "layananName", e.target.value)}
                placeholder="Nama layanan..."
                style={{ flex: 2, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)" }}
              />
              <input
                type="number" value={it.harga}
                onChange={(e) => setItemField(it.key, "harga", e.target.value)}
                placeholder="Harga" min="0"
                style={{ flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 5, border: "1px solid var(--border)", minWidth: 80 }}
              />
              {items.length > 1 && (
                <button onClick={() => removeItem(it.key)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 18, padding: "0 2px" }}>×</button>
              )}
            </div>
          ))}
          <datalist id="layanan-suggestions">
            {JENIS_LAYANAN.map((j) => <option key={j} value={j} />)}
          </datalist>
          <button onClick={addItem}
            style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
            + Tambah layanan lain
          </button>
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 600 }}>Total: {formatRupiah(totalItems)}</div>
        </div>
      ) : (order.items && order.items.length > 0) ? (
        <div style={{ marginBottom: 8 }}>
          <span style={metaLabel}>Layanan</span>
          {order.items.map((it) => (
            <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "var(--text-secondary)" }}>
              <span>{it.layananName}</span>
              <span style={{ fontWeight: 600 }}>{formatRupiah(it.harga)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
            <span>Total</span>
            <span>{formatRupiah(order.value)}</span>
          </div>
        </div>
      ) : null}

      {/* Keluhan */}
      {editing ? (
        <div>
          <span style={metaLabel}>Keluhan Customer</span>
          <textarea value={keluhan} onChange={(e) => setKeluhan(e.target.value)}
            placeholder="Keluhan kasur customer..." rows={2}
            style={{ ...selStyleFull, resize: "vertical" }} />
        </div>
      ) : info.keluhanCustomer ? (
        <div>
          <span style={metaLabel}>Keluhan</span>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{info.keluhanCustomer}</p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Form tambah order baru (2 step) ─────────────────────────────────────────
function AddOrderForm({ customerId, onDone, onCancel }) {
  const [step, setStep]               = useState(1);
  const [orderNumber, setOrderNumber] = useState("");
  const [beratBadan, setBeratBadan]   = useState("");
  const [merkKasur, setMerk]          = useState("");
  const [ukuran, setUkuran]           = useState("");
  const [keluhan, setKeluhan]         = useState("");
  const [items, setItems]             = useState([newItem()]);
  const [saving, setSaving]           = useState(false);

  const total = items.reduce((s, it) => s + (Number(it.harga) || 0), 0);

  function addItem() { setItems((p) => [...p, newItem()]); }
  function removeItem(key) { setItems((p) => p.filter((it) => it.key !== key)); }
  function setItemField(key, field, val) {
    setItems((p) => p.map((it) => it.key === key ? { ...it, [field]: val } : it));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const validItems = items.filter((it) => it.layananName?.trim());
    if (validItems.length === 0) return alert("Tambahkan minimal satu layanan");
    setSaving(true);
    try {
      const order = await api.addOrder(customerId, {
        beratBadan: beratBadan ? Number(beratBadan) : null,
        notes: buildNotes({ merkKasur, ukuranKasur: ukuran, keluhanCustomer: keluhan }),
        orderNumber: orderNumber.trim() || null,
      });
      for (const it of validItems) {
        await api.addOrderItem(order.id, { layananName: it.layananName, harga: Number(it.harga) || 0 });
      }
      onDone();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (step === 1) {
    return (
      <div style={formBox}>
        <p style={{ margin: "0 0 12px", fontWeight: 700, fontSize: 13 }}>Order Baru — Langkah 1: Info Kasur</p>
        <div style={{ marginBottom: 10 }}>
          <label style={formLabel}>ID Order (opsional)</label>
          <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="cth: ORD-001" style={formSelect} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={formLabel}>Berat Badan (kg)</label>
          <input
            type="number" value={beratBadan} onChange={(e) => setBeratBadan(e.target.value)}
            placeholder="cth: 75" min="1" max="300"
            style={{ ...formSelect, width: 120 }}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={formLabel}>Merk Kasur</label>
          <select value={merkKasur} onChange={(e) => setMerk(e.target.value)} style={formSelect}>
            <option value="">— Pilih Merk —</option>
            {MERK_KASUR.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={formLabel}>Ukuran Kasur</label>
          <select value={ukuran} onChange={(e) => setUkuran(e.target.value)} style={formSelect}>
            <option value="">— Pilih Ukuran —</option>
            {UKURAN_KASUR.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={formLabel}>Keluhan Customer</label>
          <textarea value={keluhan} onChange={(e) => setKeluhan(e.target.value)}
            placeholder="Jelaskan keluhan kasur yang dirasakan customer..." rows={3}
            style={{ ...formSelect, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setStep(2)}>
            Lanjut ke Layanan →
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Batal</button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={formBox}>
      <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13 }}>Langkah 2: Daftar Layanan</p>
      {(merkKasur || ukuran) && (
        <p style={{ margin: "0 0 12px", fontSize: 11, color: "var(--text-muted)" }}>
          {[merkKasur, ukuran].filter(Boolean).join(" · ")}
          <button type="button" onClick={() => setStep(1)}
            style={{ marginLeft: 8, fontSize: 11, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Ubah
          </button>
        </p>
      )}
      <label style={formLabel}>Layanan (add-ons)</label>
      {items.map((it) => (
        <div key={it.key} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input
            list="new-layanan-suggestions" value={it.layananName}
            onChange={(e) => setItemField(it.key, "layananName", e.target.value)}
            placeholder="Nama layanan..."
            style={{ flex: 2, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)" }}
          />
          <input
            type="number" value={it.harga}
            onChange={(e) => setItemField(it.key, "harga", e.target.value)}
            placeholder="Harga (Rp)" min="0"
            style={{ flex: 1, fontSize: 12, padding: "7px 8px", borderRadius: 6, border: "1px solid var(--border)", minWidth: 90 }}
          />
          {items.length > 1 && (
            <button type="button" onClick={() => removeItem(it.key)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", fontSize: 20, lineHeight: 1, padding: "0 2px" }}>×</button>
          )}
        </div>
      ))}
      <datalist id="new-layanan-suggestions">
        {JENIS_LAYANAN.map((j) => <option key={j} value={j} />)}
      </datalist>
      <button type="button" onClick={addItem}
        style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginBottom: 10 }}>
        + Tambah layanan lain
      </button>
      <div style={{ padding: "8px 0", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Total</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>{formatRupiah(total)}</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan Order"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Kembali</button>
      </div>
    </form>
  );
}

// ─── Container utama ──────────────────────────────────────────────────────────
export default function OrderSection({ customer, onUpdate }) {
  const [showForm, setShowForm]   = useState(false);
  const [expandedId, setExpandedId] = useState(null); // ID order yang sedang di-expand

  async function refresh() {
    try {
      const fresh = await api.getCustomer(customer.id);
      onUpdate(fresh);
    } catch {}
  }

  function handleDelete(orderId) {
    onUpdate({ ...customer, orders: customer.orders.filter((o) => o.id !== orderId) });
  }

  function toggleExpand(id) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const totalValue = customer.orders.reduce((s, o) => s + o.value, 0);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          {customer.orders.length} order · Total {formatRupiah(totalValue)}
        </p>
        {!showForm && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>+ Order</button>
        )}
      </div>

      {showForm && (
        <AddOrderForm
          customerId={customer.id}
          onDone={() => { setShowForm(false); refresh(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Tabel ringkasan semua order */}
      {customer.orders.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-secondary)" }}>
                <th style={thStyle}>ID Order</th>
                <th style={thStyle}>Nilai</th>
                <th style={thStyle}>Status</th>
                <th style={{ ...thStyle, width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {customer.orders.map((o) => {
                const badge = ORDER_STATUS_BADGE[o.status] || {};
                const isOpen = expandedId === o.id;
                return (
                  <React.Fragment key={o.id}>
                    <tr
                      onClick={() => toggleExpand(o.id)}
                      style={{ borderTop: "1px solid var(--border)", cursor: "pointer", background: isOpen ? "#f8fafc" : "white", transition: "background 0.1s" }}
                    >
                      <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                        {o.orderNumber || <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700 }}>{formatRupiah(o.value)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, ...badge }}>
                          {ORDER_STATUS_LABELS[o.status] || o.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px 8px", textAlign: "center" }}>
                        {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} style={{ padding: 0 }}>
                          <OrderDetail
                            order={o}
                            customerId={customer.id}
                            onRefresh={refresh}
                            onDelete={handleDelete}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {customer.orders.length === 0 && !showForm && (
        <p className="text-small">Belum ada order. Klik "+ Order" untuk menambah.</p>
      )}
    </div>
  );
}

// ─── Style helpers ────────────────────────────────────────────────────────────
const thStyle = {
  padding: "8px 12px", textAlign: "left", fontSize: 11,
  fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const formLabel = {
  display: "block", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.04em", marginBottom: 4,
};

const formSelect = {
  fontSize: 13, padding: "7px 9px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg-primary)",
  color: "var(--text-primary)", width: "100%",
};

const formBox = {
  marginBottom: 16, padding: 14, background: "var(--bg-secondary)",
  borderRadius: 8, border: "1px solid var(--border)",
};

const selStyle = {
  fontSize: 11, padding: "3px 6px", borderRadius: 4,
  border: "1px solid var(--border)", background: "var(--bg-secondary)",
  color: "var(--text-primary)", flexShrink: 0,
};

const selStyleFull = {
  ...selStyle, width: "100%", fontSize: 12, padding: "5px 7px",
};

const metaLabel = {
  display: "block", fontSize: 10, fontWeight: 600,
  color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: 3,
};

const chipStyle = {
  fontSize: 11, padding: "2px 8px", borderRadius: 99,
  background: "#f3f4f6", color: "#374151", fontWeight: 500,
};
