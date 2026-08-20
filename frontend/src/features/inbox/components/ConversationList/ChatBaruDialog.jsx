import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search, Check, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/api.js";

// "Ketik nomor lalu chat" — seperti di aplikasi WhatsApp.
//
// KENAPA INI ADA. Sebelumnya percakapan HANYA bisa lahir dari customer yang
// chat duluan. Kalau sales dapat nomor dari telepon, kartu nama, atau
// referral, tidak ada jalan memulai chat dari CRM — mereka harus buka
// WhatsApp di HP, dan percakapan itu tidak pernah tercatat di CRM sampai
// customer membalas.
//
// Nomor DIPERIKSA DULU ke WhatsApp sebelum apa pun dibuat. Tanpa itu, salah
// ketik satu digit menghasilkan pelanggan hantu di database DAN pesan yang
// terkirim ke ruang hampa — WhatsApp tidak mengembalikan error untuk tujuan
// yang tidak ada.

const SESI = ["CS-1", "CS-2"];

export default function ChatBaruDialog({ open, onClose, onJadi }) {
  const [nomor, setNomor] = useState("");
  const [sesi, setSesi] = useState(SESI[0]);
  const [nama, setNama] = useState("");
  const [cek, setCek] = useState(null);      // hasil /cek-nomor
  const [memeriksa, setMemeriksa] = useState(false);
  const [membuat, setMembuat] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      setNomor(""); setNama(""); setCek(null); setError(""); setMembuat(false);
      // Fokus otomatis — dialog ini dibuka untuk MENGETIK, jadi kursor harus
      // sudah siap tanpa klik tambahan.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Periksa nomor sambil mengetik (debounce) — umpan balik langsung jauh
  // lebih baik daripada baru tahu salah setelah menekan tombol.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    setCek(null);
    setError("");
    const bersih = nomor.replace(/\D/g, "");
    if (bersih.length < 8) return;

    debounceRef.current = setTimeout(async () => {
      setMemeriksa(true);
      try {
        setCek(await api.cekNomorWa(nomor, sesi));
      } catch {
        setCek(null);
      } finally {
        setMemeriksa(false);
      }
    }, 500);
    return () => clearTimeout(debounceRef.current);
  }, [nomor, sesi]);

  async function handleMulai() {
    setMembuat(true);
    setError("");
    try {
      const hasil = await api.mulaiChatBaru({ phone: nomor, session: sesi, name: nama });
      onJadi?.(hasil);
      onClose();
    } catch (e) {
      setError(e.message || "Gagal memulai percakapan");
    } finally {
      setMembuat(false);
    }
  }

  if (!open) return null;

  const bolehMulai =
    cek?.valid && cek.adaDiWhatsApp !== false && !memeriksa && !membuat;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card, #fff)", borderRadius: 12, width: "min(440px, 100%)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "13px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
          <strong style={{ flex: 1, fontSize: 14 }}>Chat Baru</strong>
          <button onClick={onClose} title="Tutup"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)" }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 13 }}>
          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Nomor WhatsApp
            </label>
            <input
              ref={inputRef}
              type="tel"
              value={nomor}
              onChange={(e) => setNomor(e.target.value)}
              placeholder="0851-8728-3900 atau 628518728390"
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg-card, #fff)",
                color: "var(--text-primary)", fontSize: 14,
              }}
            />
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Boleh ditulis bebas — 08xx, +62, atau 8xx semuanya diterima.
            </p>
          </div>

          {/* Umpan balik hasil pemeriksaan */}
          {memeriksa && (
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-secondary)" }}>
              <Loader2 size={14} className="animate-spin" /> Memeriksa nomor...
            </div>
          )}

          {!memeriksa && cek && !cek.valid && (
            <div style={{ display: "flex", gap: 7, fontSize: 12.5, color: "var(--danger, #dc2626)" }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {cek.alasan}
            </div>
          )}

          {!memeriksa && cek?.valid && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5,
              background: "var(--bg, #f8fafc)", borderRadius: 8, padding: "9px 11px",
            }}>
              <div style={{ fontFamily: "monospace", fontWeight: 600 }}>{cek.nomor}</div>

              {cek.adaDiWhatsApp === true && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--success, #16a34a)" }}>
                  <Check size={13} /> Terdaftar di WhatsApp
                </div>
              )}
              {cek.adaDiWhatsApp === false && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--danger, #dc2626)" }}>
                  <AlertTriangle size={13} /> Tidak terdaftar di WhatsApp
                </div>
              )}
              {/* null = WAHA tidak terjangkau. SENGAJA dibedakan dari "tidak
                  terdaftar" — kalau disamakan, sales akan mengira nomornya
                  salah padahal layanannya yang sedang mati. */}
              {cek.adaDiWhatsApp === null && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--warning, #b45309)" }}>
                  <AlertTriangle size={13} /> Status tidak bisa dipastikan (WhatsApp tidak terjangkau)
                </div>
              )}

              {cek.sudahAdaDiCrm && (
                <div style={{ color: "var(--text-secondary)" }}>
                  Sudah ada di CRM{cek.namaDiCrm ? ` sebagai "${cek.namaDiCrm}"` : ""} — akan dibuka percakapannya.
                </div>
              )}
            </div>
          )}

          {/* Nama cuma relevan untuk kontak yang benar-benar baru */}
          {cek?.valid && !cek.sudahAdaDiCrm && (
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 5 }}>
                Nama <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(opsional)</span>
              </label>
              <input
                type="text"
                value={nama}
                onChange={(e) => setNama(e.target.value)}
                placeholder="Kosongkan untuk pakai nama dari WhatsApp"
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  border: "1px solid var(--border)", background: "var(--bg-card, #fff)",
                  color: "var(--text-primary)", fontSize: 14,
                }}
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12.5, fontWeight: 600, display: "block", marginBottom: 5 }}>
              Kirim dari nomor
            </label>
            <select
              value={sesi}
              onChange={(e) => setSesi(e.target.value)}
              style={{
                width: "100%", padding: "9px 12px", borderRadius: 8,
                border: "1px solid var(--border)", background: "var(--bg-card, #fff)",
                color: "var(--text-primary)", fontSize: 14,
              }}
            >
              {SESI.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "5px 0 0" }}>
              Pelanggan akan melihat pesan datang dari nomor ini.
            </p>
          </div>

          {error && (
            <div style={{ fontSize: 12.5, color: "var(--danger, #dc2626)" }}>{error}</div>
          )}
        </div>

        <div style={{
          display: "flex", gap: 8, padding: "12px 16px",
          borderTop: "1px solid var(--border)", justifyContent: "flex-end",
        }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm">Batal</button>
          <button
            onClick={handleMulai}
            disabled={!bolehMulai}
            className="btn btn-primary btn-sm"
            style={{ display: "flex", alignItems: "center", gap: 6, opacity: bolehMulai ? 1 : 0.5 }}
          >
            <Search size={13} />
            {membuat ? "Membuka..." : cek?.sudahAdaDiCrm ? "Buka Percakapan" : "Mulai Chat"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
