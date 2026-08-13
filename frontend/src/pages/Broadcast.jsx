import React, { useEffect, useState, useCallback } from "react";
import { Plus, AlertTriangle, CheckCircle, Send, Pause, Play, Users } from "lucide-react";
import { api } from "../api.js";
import { PIPELINE_STAGES, LEAD_SOURCES } from "../utils/format.js";

const STEPS = ["Pesan", "Target", "Pengiriman", "Review"];

const STATUS_BADGE = {
  DRAFT: "badge-pending",
  BERJALAN: "badge-open",
  JEDA: "badge-pending",
  SELESAI: "badge-resolved",
};

// Pilihan batas harian. Angka-angka ini bukan preferensi gaya — nomor WA
// yang dipakai adalah satu-satunya pintu masuk seluruh lead iklan, jadi
// default-nya sengaja kecil dan naiknya bertahap.
const PILIHAN_KUOTA = [
  { value: 30,  label: "30 / hari — pemanasan (paling aman)" },
  { value: 60,  label: "60 / hari — setelah 2-3 hari lancar" },
  { value: 100, label: "100 / hari" },
  { value: 150, label: "150 / hari — hanya jika rasio tetap sehat" },
];

function WizardStepsBar({ step }) {
  return (
    <div className="wizard-steps-bar">
      {STEPS.map((label, i) => {
        const num = i + 1;
        const done = step > num;
        const active = step === num;
        return (
          <div key={label} className="wizard-step-item">
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div className={`wizard-step-circle ${done ? "done" : active ? "active" : ""}`}>
                {done ? "✓" : num}
              </div>
              <div className={`wizard-step-label ${active ? "active" : ""}`}>{label}</div>
            </div>
            {i < STEPS.length - 1 && <div className={`wizard-step-line ${done ? "done" : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}

const FORM_KOSONG = {
  name: "",
  message: "",
  filters: { tidakAktifSejakHari: 30 },
  dailyCap: 30,
  tagOnSend: "",
};

export default function Broadcast() {
  const [campaigns, setCampaigns] = useState([]);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(FORM_KOSONG);
  const [estimate, setEstimate] = useState(null);
  const [health, setHealth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState("");

  const muatCampaigns = useCallback(() => {
    api.getBroadcastCampaigns().then(setCampaigns).catch(() => {});
  }, []);

  useEffect(() => {
    muatCampaigns();
    api.getBroadcastHealthCheck().then(setHealth).catch(() => {});
  }, [muatCampaigns]);

  // Campaign berjalan bergerak pelan (dibatasi kuota harian), tapi progres
  // tetap perlu terlihat bergerak tanpa harus refresh manual.
  useEffect(() => {
    if (!campaigns.some((c) => c.status === "BERJALAN")) return;
    const t = setInterval(muatCampaigns, 20_000);
    return () => clearInterval(t);
  }, [campaigns, muatCampaigns]);

  useEffect(() => {
    if (step !== 2) return;
    const t = setTimeout(() => {
      api.getBroadcastEstimate(form.filters).then(setEstimate).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [form.filters, step]);

  function setFilter(key, val) {
    setForm((f) => ({ ...f, filters: { ...f.filters, [key]: val === "" ? undefined : val } }));
  }

  function handleNewCampaign() {
    setActiveCampaign(null);
    setForm(FORM_KOSONG);
    setStep(1);
    setEstimate(null);
  }

  function handleSelectCampaign(c) {
    setActiveCampaign(c);
    setForm({
      name: c.name,
      message: c.message,
      filters: c.filters || {},
      dailyCap: c.dailyCap ?? 30,
      tagOnSend: c.tagOnSend || "",
    });
    setStep(1);
  }

  async function handleSaveDraft() {
    setSaving(true);
    try {
      if (activeCampaign) {
        const updated = await api.updateBroadcastCampaign(activeCampaign.id, form);
        setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        setActiveCampaign((prev) => ({ ...prev, ...updated }));
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

  async function handleTest() {
    if (!activeCampaign) return alert("Simpan draft terlebih dahulu");
    if (!testPhone.trim()) return alert("Isi nomor tujuan uji dulu");
    setBusy(true);
    try {
      await api.testBroadcastCampaign(activeCampaign.id, testPhone.trim());
      alert(`Pesan uji terkirim ke ${testPhone.trim()}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMulai() {
    if (!activeCampaign) return alert("Simpan draft terlebih dahulu");
    const konfirmasi = window.confirm(
      `Siapkan dan mulai kirim ke ±${estimate?.count ?? "?"} kontak?\n\n` +
      `Maksimal ${form.dailyCap} pesan/hari, hanya jam 08:00–20:00 WIB.\n` +
      `Kampanye bisa dijeda kapan saja.`
    );
    if (!konfirmasi) return;

    setBusy(true);
    try {
      // Kalau target sudah pernah disiapkan, prepare akan menolak — itu
      // wajar saat melanjutkan campaign yang dijeda, jadi jangan dianggap
      // kegagalan.
      const sudahPunyaTarget = (activeCampaign.totalTargets || 0) > 0;
      if (!sudahPunyaTarget) {
        const hasil = await api.prepareBroadcastCampaign(activeCampaign.id);
        if (!window.confirm(`${hasil.prepared} kontak siap dikirimi. Lanjut kirim sekarang?`)) {
          setBusy(false);
          muatCampaigns();
          return;
        }
      }
      await api.startBroadcastCampaign(activeCampaign.id);
      muatCampaigns();
      setActiveCampaign((prev) => ({ ...prev, status: "BERJALAN" }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleJeda() {
    setBusy(true);
    try {
      await api.pauseBroadcastCampaign(activeCampaign.id);
      muatCampaigns();
      setActiveCampaign((prev) => ({ ...prev, status: "JEDA" }));
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  const berjalan = activeCampaign?.status === "BERJALAN";
  const terkunci = activeCampaign && activeCampaign.status !== "DRAFT";

  return (
    <div className="wizard-layout" style={{ height: "calc(100dvh - 56px)" }}>
      <div className="wizard-sidebar">
        <div className="wizard-sidebar-header">
          Broadcast &amp; Campaign
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
                {c.totalTargets > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 11 }}>
                    {c.sentCount}/{c.totalTargets}
                    {c.failedCount > 0 && (
                      <span style={{ color: "var(--color-danger)" }}> · {c.failedCount} gagal</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="wizard-main">
        <WizardStepsBar step={step} />

        <div className="wizard-body">
          {/* Step 1 — Pesan */}
          {step === 1 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Buat Pesan</h3>
              {terkunci && (
                <div className="health-alert warn" style={{ marginBottom: 14 }}>
                  <AlertTriangle size={16} />
                  <div style={{ fontSize: 12.5 }}>
                    Kampanye sudah berjalan — isi pesan &amp; target tidak bisa diubah lagi.
                    Sebagian penerima sudah menerima versi ini.
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Nama Kampanye</label>
                <input
                  type="text"
                  placeholder="Contoh: Merdeka dari Sakit Pinggang"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Pesan</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px" }}>
                  Gunakan <code>{"{{nama}}"}</code> untuk nama pelanggan. Kontak tanpa nama disapa "Kak".
                </p>
                <textarea
                  rows={5}
                  disabled={terkunci}
                  style={{ width: "100%", resize: "vertical", borderRadius: 8, padding: "10px 14px", border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13.5 }}
                  placeholder="Halo {{nama}}, dalam rangka HUT RI ke-81 Klinik Matras kasih..."
                  value={form.message}
                  onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                />
              </div>
              {form.message && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Preview:</div>
                  <div className="msg-preview">
                    {form.message.replace(/\{\{\s*nama\s*\}\}/gi, "Budi")}
                    <div className="msg-preview-meta">15:30 ✓✓</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — Target */}
          {step === 2 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Pilih Target Audiens</h3>
              {estimate && (
                <div className="estimate-card">
                  <div className="estimate-count">{estimate.count}</div>
                  <div>
                    <div className="estimate-label">kontak cocok dengan filter ini</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Sudah otomatis mengecualikan yang minta berhenti
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Tidak aktif sejak</label>
                <select className="filter-select" style={{ width: "100%" }} disabled={terkunci}
                  value={form.filters.tidakAktifSejakHari || ""}
                  onChange={(e) => setFilter("tidakAktifSejakHari", e.target.value)}>
                  <option value="">Semua (termasuk yang baru chat)</option>
                  <option value="14">Lebih dari 14 hari</option>
                  <option value="30">Lebih dari 30 hari</option>
                  <option value="60">Lebih dari 60 hari</option>
                  <option value="90">Lebih dari 90 hari</option>
                </select>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Yang baru saja chat sedang diurus sales — sebaiknya jangan diblast promo.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Pipeline Stage</label>
                <select className="filter-select" style={{ width: "100%" }} disabled={terkunci}
                  value={form.filters.stage || ""}
                  onChange={(e) => setFilter("stage", e.target.value)}>
                  <option value="">Semua Stage</option>
                  {PIPELINE_STAGES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Sumber Lead</label>
                <select className="filter-select" style={{ width: "100%" }} disabled={terkunci}
                  value={form.filters.source || ""}
                  onChange={(e) => setFilter("source", e.target.value)}>
                  <option value="">Semua Sumber</option>
                  {LEAD_SOURCES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Riwayat Order</label>
                <select className="filter-select" style={{ width: "100%" }} disabled={terkunci}
                  value={form.filters.sudahOrder === undefined ? "" : String(form.filters.sudahOrder)}
                  onChange={(e) => setFilter("sudahOrder", e.target.value === "" ? "" : e.target.value === "true")}>
                  <option value="">Semua</option>
                  <option value="true">Pernah order</option>
                  <option value="false">Belum pernah order</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 3 — Pengiriman */}
          {step === 3 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Pengaturan Pengiriman</h3>

              {health && (
                <div className={`health-alert ${health.safe ? "safe" : "warn"}`}>
                  {health.safe ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
                  <div>
                    <strong>{health.safe ? "Status Aman" : "Peringatan Risiko"}</strong>
                    <div style={{ fontSize: 12, marginTop: 2 }}>
                      Rasio pesan keluar : masuk (7 hari) = {health.ratio}
                      {!health.safe && " — terlalu tinggi. Turunkan kuota harian dulu."}
                    </div>
                  </div>
                </div>
              )}

              <div className="form-group">
                <label className="form-label">Batas Kirim per Hari</label>
                <select className="filter-select" style={{ width: "100%" }}
                  value={form.dailyCap}
                  onChange={(e) => setForm((f) => ({ ...f, dailyCap: Number(e.target.value) }))}>
                  {PILIHAN_KUOTA.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
                </select>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Pengiriman otomatis berhenti saat kuota harian habis dan lanjut sendiri besok pagi.
                  Hanya dikirim jam 08:00–20:00 WIB, dengan jeda acak antar pesan.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Tag Otomatis Setelah Terkirim</label>
                <input
                  type="text"
                  placeholder="Contoh: Reactivation Merdeka"
                  value={form.tagOnSend}
                  onChange={(e) => setForm((f) => ({ ...f, tagOnSend: e.target.value }))}
                />
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Tag ini menempel ke pelanggan begitu pesannya terkirim — dipakai untuk mengukur
                  hasil kampanye nanti.
                </p>
              </div>

              <div className="form-group">
                <label className="form-label">Kirim Uji Dulu</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    placeholder="628xxx (nomor yang sudah ada di CRM)"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-secondary" onClick={handleTest} disabled={busy}>
                    Kirim Uji
                  </button>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Kirim ke nomor sendiri dulu untuk memeriksa tampilan pesannya.
                </p>
              </div>
            </div>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Review &amp; Kirim</h3>
              <div className="chart-card" style={{ margin: 0, padding: 20 }}>
                <div style={{ display: "grid", gap: 12, fontSize: 13.5 }}>
                  <div><strong>Nama Kampanye:</strong> {form.name || "—"}</div>
                  <div><strong>Target:</strong> {estimate?.count ?? "—"} kontak</div>
                  <div><strong>Batas harian:</strong> {form.dailyCap} pesan/hari (08:00–20:00 WIB)</div>
                  <div><strong>Perkiraan selesai:</strong>{" "}
                    {estimate?.count ? `±${Math.ceil(estimate.count / form.dailyCap)} hari` : "—"}
                  </div>
                  <div><strong>Tag setelah terkirim:</strong> {form.tagOnSend || "—"}</div>
                </div>
              </div>

              {activeCampaign?.totalTargets > 0 && (
                <div className="chart-card" style={{ marginTop: 14, padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <Users size={15} />
                    <strong style={{ fontSize: 13.5 }}>Progres Pengiriman</strong>
                  </div>
                  <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                    <div>Terkirim: <strong>{activeCampaign.sentCount}</strong> dari {activeCampaign.totalTargets}</div>
                    <div style={{ color: "var(--text-muted)" }}>Menunggu giliran: {activeCampaign.pendingCount}</div>
                    {activeCampaign.failedCount > 0 && (
                      <div style={{ color: "var(--color-danger)" }}>Gagal: {activeCampaign.failedCount}</div>
                    )}
                    {activeCampaign.skippedCount > 0 && (
                      <div style={{ color: "var(--text-muted)" }}>
                        Dilewati (minta berhenti): {activeCampaign.skippedCount}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

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
          ) : berjalan ? (
            <button className="btn btn-secondary" onClick={handleJeda} disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Pause size={14} /> Jeda Kampanye
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleMulai} disabled={busy}
              style={{ background: "var(--color-success)", display: "flex", alignItems: "center", gap: 6 }}>
              {activeCampaign?.status === "JEDA" ? <Play size={14} /> : <Send size={14} />}
              {busy ? "Memproses..." : activeCampaign?.status === "JEDA" ? "Lanjutkan" : "Mulai Kirim"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
