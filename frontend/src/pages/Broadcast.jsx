import React, { useEffect, useState, useCallback } from "react";
import { Plus, AlertTriangle, CheckCircle, Send } from "lucide-react";
import { api } from "../api.js";
import { formatRupiah, PIPELINE_STAGES, LEAD_SOURCES } from "../utils/format.js";

const STEPS = ["Pesan", "Target", "Pengiriman", "Review"];

const STATUS_BADGE = { DRAFT: "badge-pending", BERJALAN: "badge-open", SELESAI: "badge-resolved" };

function WizardStepsBar({ step }) {
  return (
    <div className="wizard-steps-bar">
      {STEPS.map((label, i) => {
        const num = i + 1;
        const done   = step > num;
        const active = step === num;
        return (
          <div key={label} className="wizard-step-item">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div className={`wizard-step-circle ${done ? "done" : active ? "active" : ""}`}>
                {done ? "✓" : num}
              </div>
              <div className={`wizard-step-label ${active ? "active" : ""}`}>{label}</div>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`wizard-step-line ${done ? "done" : ""}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Broadcast() {
  const [campaigns, setCampaigns]   = useState([]);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [step, setStep]             = useState(1);
  const [form, setForm]             = useState({ name: "", message: "", filters: {}, randomDelay: true });
  const [estimate, setEstimate]     = useState(null);
  const [health, setHealth]         = useState(null);
  const [saving, setSaving]         = useState(false);
  const [sending, setSending]       = useState(false);

  useEffect(() => {
    api.getBroadcastCampaigns().then(setCampaigns).catch(() => {});
    api.getBroadcastHealthCheck().then(setHealth).catch(() => {});
  }, []);

  // Debounce estimate fetch saat filter berubah
  useEffect(() => {
    if (step !== 2) return;
    const t = setTimeout(() => {
      api.getBroadcastEstimate(form.filters).then(setEstimate).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [form.filters, step]);

  function setFilter(key, val) {
    setForm((f) => ({ ...f, filters: { ...f.filters, [key]: val || undefined } }));
  }

  function handleNewCampaign() {
    setActiveCampaign(null);
    setForm({ name: "", message: "", filters: {}, randomDelay: true });
    setStep(1);
    setEstimate(null);
  }

  function handleSelectCampaign(c) {
    setActiveCampaign(c);
    setForm({ name: c.name, message: c.message, filters: c.filters || {}, randomDelay: c.randomDelay !== false });
    setStep(1);
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      if (activeCampaign) {
        const updated = await api.updateBroadcastCampaign(activeCampaign.id, { name: form.name, message: form.message, filters: form.filters, randomDelay: form.randomDelay, status: "DRAFT" });
        setCampaigns((prev) => prev.map((c) => c.id === updated.id ? updated : c));
        setActiveCampaign(updated);
      } else {
        const created = await api.createBroadcastCampaign(form);
        setCampaigns((prev) => [created, ...prev]);
        setActiveCampaign(created);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    if (!activeCampaign) {
      alert("Simpan draft terlebih dahulu");
      return;
    }
    if (!window.confirm(`Mulai kirim ke ${estimate?.count || "?"} kontak?`)) return;
    setSending(true);
    try {
      await api.sendBroadcastCampaign(activeCampaign.id);
      const updated = campaigns.map((c) => c.id === activeCampaign.id ? { ...c, status: "BERJALAN" } : c);
      setCampaigns(updated);
      setActiveCampaign((prev) => ({ ...prev, status: "BERJALAN" }));
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="wizard-layout" style={{ height: "calc(100vh - 56px)" }}>
      {/* Sidebar */}
      <div className="wizard-sidebar">
        <div className="wizard-sidebar-header">
          Broadcast & Campaign
          <button className="btn btn-primary btn-sm" onClick={handleNewCampaign} style={{ marginLeft: 8 }}>
            <Plus size={13} />
          </button>
        </div>
        <div className="wizard-campaign-list">
          {campaigns.length === 0 && (
            <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>
              Belum ada kampanye. Klik + untuk buat baru.
            </div>
          )}
          {campaigns.map((c) => (
            <div
              key={c.id}
              className={`wizard-campaign-item ${activeCampaign?.id === c.id ? "active" : ""}`}
              onClick={() => handleSelectCampaign(c)}
            >
              <div className="wizard-campaign-name">{c.name}</div>
              <div className="wizard-campaign-meta">
                <span className={`badge ${STATUS_BADGE[c.status] || "badge-pending"}`}>{c.status}</span>
                {c.sentCount !== undefined && c.totalTargets > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11 }}>{c.sentCount}/{c.totalTargets}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="wizard-main">
        <WizardStepsBar step={step} />

        <div className="wizard-body">
          {/* Step 1: Pesan */}
          {step === 1 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Buat Pesan</h3>
              <div className="form-group">
                <label className="form-label">Nama Kampanye</label>
                <input
                  type="text"
                  placeholder="Contoh: Promo Juni 2026"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Pesan</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px" }}>
                  Gunakan <code>{"{{nama}}"}</code> untuk nama pelanggan.
                </p>
                <textarea
                  rows={5}
                  style={{ width: "100%", resize: "vertical", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13.5 }}
                  placeholder="Halo {{nama}}, ada promo menarik dari Klinik Matras..."
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                />
              </div>
              {form.message && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Preview:</div>
                  <div className="msg-preview">
                    {form.message.replace(/\{\{nama\}\}/gi, "Budi")}
                    <div className="msg-preview-meta">15:30 ✓✓</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Target */}
          {step === 2 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Pilih Target Audiens</h3>
              {estimate && (
                <div className="estimate-card">
                  <div className="estimate-count">{estimate.count}</div>
                  <div>
                    <div className="estimate-label">kontak cocok dengan filter ini</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Hanya nomor yang terdaftar</div>
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Pipeline Stage</label>
                <select className="filter-select" style={{ width: "100%" }}
                  value={form.filters.stage || ""}
                  onChange={(e) => setFilter("stage", e.target.value)}>
                  <option value="">Semua Stage</option>
                  {PIPELINE_STAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Sumber Lead</label>
                <select className="filter-select" style={{ width: "100%" }}
                  value={form.filters.source || ""}
                  onChange={(e) => setFilter("source", e.target.value)}>
                  <option value="">Semua Sumber</option>
                  {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Step 3: Pengiriman */}
          {step === 3 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Pengaturan Pengiriman</h3>

              {/* Health check */}
              {health && (
                <div className={`health-alert ${health.safe ? "safe" : "warn"}`}>
                  {health.safe
                    ? <CheckCircle size={16} />
                    : <AlertTriangle size={16} />}
                  <div>
                    <strong>{health.safe ? "Status Aman" : "Peringatan Risiko"}</strong>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      Rasio outbound:inbound 7 hari terakhir: {health.ratio}
                      {!health.safe && " — risiko ban tinggi. Pertimbangkan kirim lebih sedikit."}
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Jadwal Kirim</label>
                <input
                  type="datetime-local"
                  value={form.schedule || ""}
                  onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
                />
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Kosongkan untuk kirim sekarang.
                </p>
              </div>
              <div className="form-group">
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={form.randomDelay}
                    onChange={(e) => setForm((f) => ({ ...f, randomDelay: e.target.checked }))}
                  />
                  <span style={{ fontSize: 13.5 }}>Aktifkan random delay 3–15 detik antar pesan (direkomendasikan)</span>
                </label>
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Review & Kirim</h3>
              <div className="chart-card" style={{ margin: 0, padding: 20 }}>
                <div style={{ display: "grid", gap: 12, fontSize: 13.5 }}>
                  <div><strong>Nama Kampanye:</strong> {form.name || "—"}</div>
                  <div><strong>Pesan:</strong> {form.message?.slice(0, 100) || "—"}{form.message?.length > 100 ? "..." : ""}</div>
                  <div><strong>Target:</strong> {estimate?.count ?? "—"} kontak</div>
                  <div><strong>Jadwal:</strong> {form.schedule || "Kirim sekarang"}</div>
                  <div><strong>Random delay:</strong> {form.randomDelay ? "Aktif" : "Tidak aktif"}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="wizard-footer">
          {step > 1 && (
            <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>← Kembali</button>
          )}
          <button className="btn btn-ghost" onClick={handleSaveDraft} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Draft"}
          </button>
          {step < 4 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}
              disabled={step === 1 && (!form.name || !form.message)}>
              Lanjut →
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleSend} disabled={sending}
              style={{ background: "var(--color-success)", display: "flex", alignItems: "center", gap: 6 }}>
              <Send size={14} />
              {sending ? "Mengirim..." : "Mulai Kirim"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
