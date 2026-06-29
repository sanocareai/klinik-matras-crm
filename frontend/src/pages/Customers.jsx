import React, { useEffect, useState } from "react";
import { api } from "../api.js";

function formatRupiah(n) {
  return "Rp" + (n || 0).toLocaleString("id-ID");
}

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getCustomers().then((data) => {
      setCustomers(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="page-loading">Memuat data pelanggan...</div>;

  return (
    <div className="customers-page">
      <h1>Pelanggan</h1>

      <div className="table-wrap">
        <table className="customer-table">
          <thead>
            <tr>
              <th>Nama / Kontak</th>
              <th>Kota</th>
              <th>Tags</th>
              <th>Jumlah order</th>
              <th>Nilai order</th>
              <th>Status</th>
              <th>Sales</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <div className="cell-strong">{c.name || "Belum ada nama"}</div>
                  <div className="muted">{c.phone || c.instagramHandle}</div>
                </td>
                <td>{c.city || "—"}</td>
                <td>
                  {c.tags.length === 0
                    ? "—"
                    : c.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}
                </td>
                <td>{c.orderCount}</td>
                <td>{formatRupiah(c.orderValue)}</td>
                <td>
                  <span className={`stage-badge stage-${c.pipelineStage.toLowerCase()}`}>
                    {c.pipelineStage}
                  </span>
                </td>
                <td>{c.assignedSales?.name || "—"}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr><td colSpan={7} className="muted">Belum ada pelanggan.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
