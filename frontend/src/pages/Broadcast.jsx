import React, { useEffect, useState, useCallback } from "react";
import { Plus, AlertTriangle, CheckCircle, Send, Pause, Play, Users, MessageSquare, X, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { PIPELINE_STAGES, LEAD_SOURCES } from "../utils/format.js";

const STEPS = ["Pesan", "Target", "Pilih Kontak", "Pengiriman", "Review"];

/** "3 hari lalu", "2 bulan lalu" — supaya recency langsung terbaca. */
function jarakWaktu(iso) {
  if (!iso) return "belum pernah";
  const hari = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (hari <= 0) return "hari ini";
  if (hari === 1) return "kemarin";
  if (hari < 30) return `${hari} hari lalu`;
  const bulan = Math.floor(hari / 30);
  return bulan === 1 ? "1 bulan lalu" : `${bulan} bulan lalu`;
}

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
  // kecualikanChatAktif default true — chat yang sedang ditangani sales
  // tidak boleh diblast promo. Harus sengaja dimatikan, bukan sengaja
  // dinyalakan.
  filters: { tidakAktifSejakHari: 30, kecualikanChatAktif: true },
  dailyCap: 30,
  tagOnSend: "",
};

// Kolom isian di halaman ini sebelumnya mengambil warna latar yang sama
// dengan panel di belakangnya, jadi seluruh form terlihat abu-abu rata dan
// batas kolomnya nyaris tidak kelihatan. Diberi latar surface eksplisit +
// border supaya jelas mana yang bisa diketik. Dipakai hanya di halaman ini
// (bukan global) supaya tidak mengubah tampilan form di halaman lain.
const GAYA_INPUT_KONTRAS = `
  .wizard-main .bc-input,
  .wizard-main input[type="text"],
  .wizard-main input[type="datetime-local"],
  .wizard-main textarea,
  .wizard-main select {
    background: var(--card-bg, #fff);
    border: 1px solid var(--border, #e5e7eb);
    color: var(--text-primary, #111827);
  }
  .wizard-main .bc-input:focus,
  .wizard-main input:focus,
  .wizard-main textarea:focus,
  .wizard-main select:focus {
    outline: 2px solid var(--primary, #2563eb);
    outline-offset: 1px;
    border-color: var(--primary, #2563eb);
  }
  .wizard-main input:disabled,
  .wizard-main textarea:disabled,
  .wizard-main select:disabled {
    background: var(--bg, #f8fafc);
    color: var(--text-muted, #9ca3af);
  }
`;

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
  // Kandidat + pilihan manual (langkah "Pilih Kontak")
  const [kandidat, setKandidat] = useState(null);
  const [totalKandidat, setTotalKandidat] = useState(0);
  const [terpilih, setTerpilih] = useState(() => new Set());
  const [memuatKandidat, setMemuatKandidat] = useState(false);
  const [cariKontak, setCariKontak] = useState("");
  const [mengunggah, setMengunggah] = useState(false);
  // Popup cuplikan chat: { kontak, data, memuat }
  const [intipChat, setIntipChat] = useState(null);

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

  // Kandidat dimuat saat masuk langkah "Pilih Kontak". Semua tercentang
  // secara default supaya perilakunya sama dengan sebelum fitur ini ada —
  // admin tinggal MENGURANGI, bukan harus mencentang ratusan satu per satu.
  useEffect(() => {
    if (step !== 3) return;
    setMemuatKandidat(true);
    api.getBroadcastPreviewTargets(form.filters)
      .then((hasil) => {
        setKandidat(hasil.data);
        setTotalKandidat(hasil.total);
        setTerpilih(new Set(hasil.data.map((k) => k.id)));
      })
      .catch(() => setKandidat([]))
      .finally(() => setMemuatKandidat(false));
  }, [step, form.filters]);

  function toggleKontak(id) {
    setTerpilih((prev) => {
      const baru = new Set(prev);
      if (baru.has(id)) baru.delete(id); else baru.add(id);
      return baru;
    });
  }

  /** Ambil N teratas (paling baru berinteraksi) — "10 dulu", "30 dulu". */
  function ambilTeratas(n) {
    if (!kandidat) return;
    setTerpilih(new Set(kandidat.slice(0, n).map((k) => k.id)));
  }

  // Pencarian hanya MENYARING TAMPILAN, tidak mengubah pilihan. Jadi admin
  // bisa mencari satu orang, mencentangnya, lalu mengosongkan kotak cari
  // tanpa kehilangan centang yang sudah dibuat sebelumnya.
  const kandidatTampil = (kandidat || []).filter((k) => {
    const q = cariKontak.trim().toLowerCase();
    if (!q) return true;
    return (k.name || "").toLowerCase().includes(q) || (k.phone || "").includes(q);
  });

  async function handleUnggahGambar(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // supaya file yang sama bisa dipilih lagi setelah dihapus
    if (!files.length) return;
    if (!activeCampaign) return alert("Simpan draft dulu sebelum menambah gambar");
    setMengunggah(true);
    try {
      const updated = await api.uploadBroadcastImages(activeCampaign.id, files);
      setActiveCampaign((prev) => ({ ...prev, images: updated.images }));
      muatCampaigns();
    } catch (err) {
      alert(err.message);
    } finally {
      setMengunggah(false);
    }
  }

  async function bukaIntipChat(kontak) {
    setIntipChat({ kontak, data: null, memuat: true });
    try {
      const data = await api.getBroadcastContactChat(kontak.id);
      setIntipChat({ kontak, data, memuat: false });
    } catch {
      setIntipChat({ kontak, data: { messages: [] }, memuat: false });
    }
  }

  async function handleHapusGambar(gambar) {
    try {
      const updated = await api.deleteBroadcastImage(activeCampaign.id, gambar);
      setActiveCampaign((prev) => ({ ...prev, images: updated.images }));
    } catch (err) {
      alert(err.message);
    }
  }

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

  // Uji kirim TIDAK butuh draft tersimpan — isi pesan & gambar dikirim
  // langsung dari form, supaya admin bisa memeriksa tampilannya lebih dulu.
  async function handleTest() {
    if (!testPhone.trim()) return alert("Isi nomor tujuan uji dulu");
    if (!form.message.trim()) return alert("Pesan masih kosong");
    setBusy(true);
    try {
      const hasil = await api.testBroadcast({
        phone: testPhone.trim(),
        message: form.message,
        images: activeCampaign?.images || [],
      });
      alert(`Pesan uji terkirim ke ${hasil.sentTo} lewat ${hasil.sesi}`);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleMulai() {
    if (!activeCampaign) return alert("Simpan draft terlebih dahulu");
    const konfirmasi = window.confirm(
      `Siapkan dan mulai kirim ke ${terpilih.size} kontak yang dipilih?\n\n` +
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
        // Kirim daftar id yang BENAR-BENAR dicentang admin — bukan sekadar
        // hasil filter — supaya yang terkirim persis sama dengan yang
        // dilihat dan disetujui di layar sebelumnya.
        const hasil = await api.prepareBroadcastCampaign(activeCampaign.id, {
          customerIds: Array.from(terpilih),
        });
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
      <style>{GAYA_INPUT_KONTRAS}</style>

      {/* Popup cuplikan chat — dibuka dari layar "Pilih Kontak" */}
      {intipChat && (
        <div
          onClick={() => setIntipChat(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card-bg, #fff)", borderRadius: 12, width: "min(560px, 100%)",
              maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden",
              boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {intipChat.kontak.name || "(tanpa nama)"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {intipChat.kontak.phone}
                  {intipChat.data?.sesi && ` · ${intipChat.data.sesi}`}
                  {` · terakhir ${jarakWaktu(intipChat.kontak.terakhirInteraksi)}`}
                </div>
              </div>
              {intipChat.data?.conversationId && (
                <Link
                  to={`/inbox?conv=${intipChat.data.conversationId}`}
                  className="btn btn-ghost btn-sm"
                  title="Buka percakapan penuh di Inbox"
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <ExternalLink size={13} /> Buka di Inbox
                </Link>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setIntipChat(null)} title="Tutup">
                <X size={15} />
              </button>
            </div>

            <div style={{ padding: 14, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
              {intipChat.memuat && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Memuat chat...</p>
              )}
              {!intipChat.memuat && intipChat.data?.messages?.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  Belum ada pesan di percakapan ini.
                </p>
              )}
              {intipChat.data?.messages?.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.direction === "OUTBOUND" ? "flex-end" : "flex-start",
                    maxWidth: "82%",
                    background: m.direction === "OUTBOUND" ? "var(--primary, #2563eb)" : "var(--bg, #f1f5f9)",
                    color: m.direction === "OUTBOUND" ? "#fff" : "var(--text-primary, #111827)",
                    borderRadius: 10, padding: "7px 11px", fontSize: 13, whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content || (m.mediaType ? `[${m.mediaType}]` : "[pesan kosong]")}
                  <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 3 }}>
                    {new Date(m.createdAt).toLocaleString("id-ID", {
                      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
                onClick={() => {
                  setTerpilih((prev) => {
                    const baru = new Set(prev);
                    baru.delete(intipChat.kontak.id);
                    return baru;
                  });
                  setIntipChat(null);
                }}
              >
                Jangan kirimi orang ini
              </button>
              <button
                className="btn btn-primary btn-sm"
                style={{ flex: 1 }}
                onClick={() => {
                  setTerpilih((prev) => new Set(prev).add(intipChat.kontak.id));
                  setIntipChat(null);
                }}
              >
                Kirimi
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="form-group">
                <label className="form-label">Gambar Promo (opsional)</label>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 6px" }}>
                  Dikirim <strong>sebelum</strong> pesan teks, supaya teksnya tidak terpotong
                  jadi caption "Baca selengkapnya".
                  {!activeCampaign && " Simpan draft dulu untuk bisa menambah gambar."}
                </p>

                {activeCampaign?.images?.length > 0 && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    {activeCampaign.images.map((g) => (
                      <div key={g} style={{ position: "relative" }}>
                        <img
                          src={g}
                          alt="Gambar promo"
                          style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 8, border: "1px solid var(--border)" }}
                        />
                        {!terkunci && (
                          <button
                            onClick={() => handleHapusGambar(g)}
                            title="Hapus gambar"
                            style={{
                              position: "absolute", top: -6, right: -6, width: 22, height: 22,
                              borderRadius: "50%", border: "none", cursor: "pointer",
                              background: "var(--color-danger, #dc2626)", color: "#fff", fontSize: 13, lineHeight: 1,
                            }}
                          >×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!terkunci && (
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={!activeCampaign || mengunggah}
                    onChange={handleUnggahGambar}
                    style={{ fontSize: 13 }}
                  />
                )}
                {mengunggah && (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "6px 0 0" }}>Mengunggah...</p>
                )}
                {activeCampaign?.images?.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--color-warning, #b45309)", margin: "6px 0 0" }}>
                    ⚠️ {activeCampaign.images.length} gambar + 1 teks = {activeCampaign.images.length + 1} pesan
                    per penerima. WhatsApp menghitung semuanya saat menilai pola akun — pertimbangkan
                    menurunkan batas harian.
                  </p>
                )}
              </div>

              {form.message && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                    Preview (persis seperti yang dilihat pelanggan):
                  </div>
                  {/* whiteSpace: pre-wrap WAJIB — tanpa ini semua baris baru
                      dan spasi runtuh jadi satu paragraf panjang, sehingga
                      preview tidak menggambarkan bentuk pesan yang sebenarnya
                      terkirim (daftar promo jadi berdempetan). */}
                  <div className="msg-preview" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
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
                <label className="form-label">Nomor CS</label>
                <select className="filter-select bc-input" style={{ width: "100%" }} disabled={terkunci}
                  value={form.filters.sesi || ""}
                  onChange={(e) => setFilter("sesi", e.target.value)}>
                  <option value="">Semua nomor (CS-1 &amp; CS-2)</option>
                  <option value="CS-1">Hanya CS-1</option>
                  <option value="CS-2">Hanya CS-2</option>
                </select>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0" }}>
                  Pesan SELALU dikirim dari nomor yang selama ini dipakai bicara dengan orang
                  tersebut. Memisahkan per nomor berguna karena batas harian berlaku per kampanye,
                  sedangkan risiko blokir berlaku per nomor.
                </p>
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

              <div className="form-group">
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    disabled={terkunci}
                    checked={form.filters.kecualikanChatAktif !== false}
                    onChange={(e) => setFilter("kecualikanChatAktif", e.target.checked)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: 13.5 }}>
                    Kecualikan yang belum dibalas sales
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      Pelanggan yang pesan terakhirnya belum kita jawab. Mengirimi mereka promo
                      massal padahal pertanyaannya menggantung adalah cara tercepat mengundang
                      komplain.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Step 3 — Pilih Kontak */}
          {step === 3 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Pilih Kontak</h3>

              {memuatKandidat && (
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Memuat kandidat...</p>
              )}

              {!memuatKandidat && kandidat && (
                <>
                  <div className="estimate-card" style={{ marginBottom: 14 }}>
                    <div className="estimate-count">{terpilih.size}</div>
                    <div>
                      <div className="estimate-label">kontak dipilih untuk dikirimi</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        dari {totalKandidat} yang cocok filter
                        {totalKandidat > kandidat.length && ` (ditampilkan ${kandidat.length} teratas)`}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                    <span style={{ fontSize: 12.5, color: "var(--text-muted)", alignSelf: "center", marginRight: 4 }}>
                      Ambil cepat:
                    </span>
                    {[10, 30, 50, 100].filter((n) => n <= kandidat.length).map((n) => (
                      <button key={n} className="btn btn-ghost btn-sm" onClick={() => ambilTeratas(n)}>
                        {n} teratas
                      </button>
                    ))}
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => setTerpilih(new Set(kandidat.map((k) => k.id)))}>
                      Semua
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setTerpilih(new Set())}>
                      Kosongkan
                    </button>
                  </div>

                  <input
                    type="text"
                    className="bc-input"
                    placeholder="Cari nama atau nomor..."
                    value={cariKontak}
                    onChange={(e) => setCariKontak(e.target.value)}
                    style={{ width: "100%", marginBottom: 10 }}
                  />

                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 8px" }}>
                    Diurutkan dari yang <strong>paling baru berinteraksi</strong> — mereka paling ingat
                    Sano, jadi paling kecil kemungkinan menganggap pesan ini spam. Mencari tidak
                    menghilangkan centang yang sudah dibuat.
                  </p>

                  <div style={{ border: "1px solid var(--border)", borderRadius: 8, maxHeight: 360, overflowY: "auto" }}>
                    {kandidatTampil.length === 0 && (
                      <div style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
                        {cariKontak
                          ? `Tidak ada kontak cocok dengan "${cariKontak}".`
                          : "Tidak ada kontak yang cocok. Longgarkan filter di langkah sebelumnya."}
                      </div>
                    )}
                    {kandidatTampil.map((k) => (
                      <label
                        key={k.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
                          borderBottom: "1px solid var(--border)", cursor: "pointer", fontSize: 13,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={terpilih.has(k.id)}
                          onChange={() => toggleKontak(k.id)}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{k.name || "(tanpa nama)"}</span>
                          <span style={{ color: "var(--text-muted)", marginLeft: 8, fontSize: 12 }}>
                            {k.phone}
                          </span>
                        </span>
                        {/* type="button" WAJIB: tombol ini berada di dalam
                            <label>, tanpa itu klik akan diteruskan ke
                            checkbox dan malah mengubah centang. */}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          title="Lihat chat terakhir"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); bukaIntipChat(k); }}
                          style={{ padding: "2px 6px" }}
                        >
                          <MessageSquare size={13} />
                        </button>
                        {k.orderCount > 0 && (
                          <span className="badge badge-resolved" style={{ fontSize: 10.5 }}>
                            {k.orderCount}x order
                          </span>
                        )}
                        {/* Nomor CS mana yang selama ini bicara dengan orang
                            ini. Pesannya PASTI keluar dari nomor yang sama —
                            kalau sesinya belum diketahui, dia tidak akan
                            dikirimi sama sekali (bukan ditebak). */}
                        <span
                          className={`badge ${k.sesi ? "badge-open" : "badge-pending"}`}
                          style={{ fontSize: 10.5 }}
                          title={k.sesi
                            ? `Akan dikirim dari ${k.sesi}`
                            : "Sesi belum diketahui — kontak ini akan dilewati. Buka chatnya di Inbox dan pilih sesi."}
                        >
                          {k.sesi || "sesi ?"}
                        </span>
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                          {jarakWaktu(k.terakhirInteraksi)}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4 — Pengiriman */}
          {step === 4 && (
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

          {/* Step 5 — Review */}
          {step === 5 && (
            <div>
              <h3 style={{ marginTop: 0 }}>Review &amp; Kirim</h3>
              <div className="chart-card" style={{ margin: 0, padding: 20 }}>
                <div style={{ display: "grid", gap: 12, fontSize: 13.5 }}>
                  <div><strong>Nama Kampanye:</strong> {form.name || "—"}</div>
                  <div><strong>Target:</strong> {terpilih.size} kontak dipilih</div>
                  <div><strong>Batas harian:</strong> {form.dailyCap} pesan/hari (08:00–20:00 WIB)</div>
                  <div><strong>Perkiraan selesai:</strong>{" "}
                    {terpilih.size ? `±${Math.ceil(terpilih.size / form.dailyCap)} hari` : "—"}
                  </div>
                  <div><strong>Tag setelah terkirim:</strong> {form.tagOnSend || "—"}</div>
                  <div><strong>Yang belum dibalas sales:</strong>{" "}
                    {form.filters.kecualikanChatAktif ? "dikecualikan" : "IKUT DIKIRIMI"}
                  </div>
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
          {step < 5 ? (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}
              disabled={(step === 1 && (!form.name || !form.message)) || (step === 3 && terpilih.size === 0)}>
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
