import React, { useState } from "react";
import { Check } from "lucide-react";
import { api } from "../../../../api.js";
import { SERVICE_AREA_LABELS, SERVICE_AREA_OPTIONS, formatTanggalWaktu } from "../../../../utils/format.js";

// Area Layanan + milestone Konsultasi/Penawaran (7 Okt 2026) — lihat
// Customer.serviceArea/consultedAt/quotedAt di schema.prisma.
//
// Area: 1 ketukan, WAJIB sebelum stage dinaikkan ke Prospek ke atas (backend
// menolak dgn code AREA_WAJIB). Sengaja BUKAN field Kota — Kota dicabut dari
// panel ini 29 Agu 2026 (redundan dgn kota pengiriman di order); area jauh
// lebih kasar dan berguna untuk lead yang belum/tidak akan order.
//
// Penawaran terisi OTOMATIS (tiap 2 menit) begitu sales mengirim pesan yang
// memuat harga — tombol manual cuma untuk harga yang dikirim di luar chat
// (telepon, gambar tanpa teks).
export default function LeadProgressSection({ customer, onUpdate }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function patch(data) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateCustomer(customer.id, data);
      onUpdate((c) => ({ ...c, ...updated }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const area = customer.serviceArea;

  return (
    <>
      <div className="panel-section">
        <span className="panel-section-label">Area Layanan</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SERVICE_AREA_OPTIONS.map((value) => {
            const active = area === value;
            return (
              <button
                key={value} type="button" disabled={busy}
                onClick={() => !active && patch({ serviceArea: value })}
                className={active ? "bg-accentbg text-accent" : "text-ink2 hover:bg-hovertint"}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 99,
                  border: `1.5px solid ${active ? "var(--color-accent, #2563eb)" : "var(--border)"}`,
                  cursor: active ? "default" : "pointer",
                }}
              >
                {SERVICE_AREA_LABELS[value]}
              </button>
            );
          })}
        </div>
        {!area && (
          <p className="text-orange" style={{ margin: "6px 0 0", fontSize: 11 }}>
            Belum diisi — tanyakan domisili. Wajib sebelum pindah ke Prospek.
          </p>
        )}
      </div>

      <div className="panel-section">
        <span className="panel-section-label">Progres Lead</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <MilestoneRow
            label="Konsultasi"
            at={customer.consultedAt}
            hint="Tandai setelah keluhan digali & rekomendasi diberikan."
            busy={busy}
            onMark={() => patch({ consulted: true })}
            onUndo={() => patch({ consulted: false })}
          />
          <MilestoneRow
            label="Penawaran"
            at={customer.quotedAt}
            detail={customer.quotedSource === "MANUAL" ? "ditandai manual" : customer.quotedAt ? "otomatis dari pesan berharga" : null}
            hint="Terisi otomatis saat harga dikirim lewat chat."
            busy={busy}
            onMark={() => patch({ quoted: true })}
            onUndo={() => patch({ quoted: false })}
          />
        </div>
        {error && <p className="text-red" style={{ margin: "6px 0 0", fontSize: 11 }}>{error}</p>}
      </div>
    </>
  );
}

function MilestoneRow({ label, at, detail, hint, busy, onMark, onUndo }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
      <div style={{ minWidth: 0 }}>
        <div className="text-ink" style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div className="text-ink3" style={{ fontSize: 11 }}>
          {at ? `${formatTanggalWaktu(at)}${detail ? ` · ${detail}` : ""}` : hint}
        </div>
      </div>
      {at ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span className="bg-greenbg text-green" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99 }}>
            <Check size={12} /> Sudah
          </span>
          <button type="button" disabled={busy} onClick={onUndo} className="text-ink3 hover:text-ink" style={{ fontSize: 11, textDecoration: "underline" }}>
            Batal
          </button>
        </div>
      ) : (
        <button type="button" disabled={busy} onClick={onMark} className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
          Tandai
        </button>
      )}
    </div>
  );
}
