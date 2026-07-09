import React from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { AlertCircle } from "lucide-react";
import { formatRupiah, ORDER_STATUS_LABELS } from "../../../utils/format.js";

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: "easeOut" } },
};

function statusBadgeClass(status) {
  if (status === "DELIVERED") return "dash-badge-success";
  if (status === "CANCELLED") return "dash-badge-failed";
  return "dash-badge-processing";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function RecentOrdersTable({ orders, loading }) {
  if (loading) {
    return (
      <div className="dash-chart-card">
        <h3>Recent Orders</h3>
        <div className="skeleton" style={{ height: 220, borderRadius: 12 }} />
      </div>
    );
  }

  return (
    <motion.div variants={itemVariants} className="dash-chart-card dash-orders-card">
      <div className="dash-orders-header">
        <h3>Recent Orders</h3>
        <Link to="/customers" className="dash-orders-link">Lihat semua</Link>
      </div>

      {!orders || orders.length === 0 ? (
        <p className="dash-chart-empty">Belum ada order.</p>
      ) : (
        <div className="dash-orders-table-wrap">
          <table className="dash-orders-table">
            <thead>
              <tr>
                <th>Produk/Layanan</th>
                <th>Pelanggan</th>
                <th>Tanggal</th>
                <th>Nilai</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td>{o.product}</td>
                  <td>{o.customerName}</td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{formatRupiah(o.value)}</td>
                  <td>
                    <span className={`dash-badge ${statusBadgeClass(o.status)}`}>
                      {ORDER_STATUS_LABELS[o.status] || o.status}
                    </span>
                    {o.hasComplaint && (
                      <span className="dash-badge dash-badge-failed" style={{ marginLeft: 6 }} title="Pernah komplain">
                        <AlertCircle size={11} />
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
