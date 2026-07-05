import React, { useEffect, useLayoutEffect, useState, useRef } from "react";
import { Plus, Trash2, Upload, Search, Send, X, Pencil } from "lucide-react";
import { api } from "../api.js";
import MarkdownEditor from "../components/knowledge/MarkdownEditor.jsx";

// ─── Workflow Tab ─────────────────────────────────────────────────────────────

const TRIGGER_OPTIONS = [
  { value: "pesan_masuk",    label: "Pesan Masuk" },
  { value: "pelanggan_baru", label: "Pelanggan Baru" },
  { value: "order_baru",     label: "Order Baru" },
  { value: "stage_berubah",  label: "Stage Pipeline Berubah" },
  { value: "jadwal",         label: "Jadwal Terjadwal" },
];

const ACTION_OPTIONS = [
  { value: "kirim_pesan_wa",    label: "Kirim Pesan WhatsApp" },
  { value: "ubah_stage",         label: "Ubah Stage Pipeline" },
  { value: "tambah_tag",         label: "Tambah Tag ke Pelanggan" },
  { value: "assign_sales",       label: "Assign ke Sales" },
  { value: "catat_di_crm",      label: "Catat di CRM (Log)" },
];

function WorkflowTab() {
  const [workflows, setWorkflows]   = useState([]);
  const [selected, setSelected]     = useState(null);
  const [form, setForm]             = useState({ name: "", trigger: "", condition: "", action: "" });
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    api.getWorkflows().then(setWorkflows).catch(() => {});
  }, []);

  function handleNew() {
    setSelected(null);
    setForm({ name: "", trigger: "", condition: "", action: "" });
  }

  function handleSelect(wf) {
    setSelected(wf);
    setForm({ name: wf.name, trigger: wf.trigger, condition: wf.condition || "", action: wf.action });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      if (selected) {
        const updated = await api.updateWorkflow(selected.id, form);
        setWorkflows((prev) => prev.map((w) => w.id === updated.id ? updated : w));
        setSelected(updated);
      } else {
        const created = await api.createWorkflow(form);
        setWorkflows((prev) => [created, ...prev]);
        setSelected(created);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(wf) {
    const updated = await api.updateWorkflow(wf.id, { active: !wf.active }).catch((e) => { alert(e.message); return null; });
    if (updated) setWorkflows((prev) => prev.map((w) => w.id === updated.id ? updated : w));
  }

  async function handleDelete(wf) {
    if (!window.confirm("Hapus workflow ini?")) return;
    await api.deleteWorkflow(wf.id).catch((e) => alert(e.message));
    setWorkflows((prev) => prev.filter((w) => w.id !== wf.id));
    if (selected?.id === wf.id) { setSelected(null); setForm({ name: "", trigger: "", condition: "", action: "" }); }
  }

  const triggerLabel = TRIGGER_OPTIONS.find((o) => o.value === form.trigger)?.label || "";
  const actionLabel  = ACTION_OPTIONS.find((o) => o.value === form.action)?.label || "";

  return (
    <div className="automation-layout" style={{ height: "100%" }}>
      {/* Sidebar */}
      <div className="automation-sidebar">
        <div className="automation-sidebar-header">
          Workflow
          <button className="btn btn-primary btn-sm" onClick={handleNew}><Plus size={13} /></button>
        </div>
        <div className="automation-list">
          {workflows.length === 0 && (
            <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Belum ada workflow.</div>
          )}
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className={`automation-item ${selected?.id === wf.id ? "active" : ""}`}
              onClick={() => handleSelect(wf)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="automation-item-name">{wf.name}</div>
                <button
                  className={`toggle ${wf.active ? "on" : ""}`}
                  onClick={(e) => { e.stopPropagation(); handleToggle(wf); }}
                  title={wf.active ? "Nonaktifkan" : "Aktifkan"}
                />
              </div>
              <div className="automation-item-sub">{TRIGGER_OPTIONS.find((o) => o.value === wf.trigger)?.label || wf.trigger}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail / Form */}
      <div className="automation-main">
        <form onSubmit={handleSave}>
          <h3 style={{ marginTop: 0 }}>{selected ? "Edit Workflow" : "Workflow Baru"}</h3>

          {/* Flow preview */}
          {(form.trigger || form.action) && (
            <div className="workflow-flow">
              <div className="workflow-card">
                <div className="workflow-card-label">Trigger</div>
                <div className="workflow-card-value">{triggerLabel || "Pilih trigger"}</div>
              </div>
              <div className="workflow-arrow">→</div>
              {form.condition && (
                <>
                  <div className="workflow-card" style={{ borderColor: "#ddd6fe" }}>
                    <div className="workflow-card-label">Kondisi</div>
                    <div className="workflow-card-value">{form.condition}</div>
                  </div>
                  <div className="workflow-arrow">→</div>
                </>
              )}
              <div className="workflow-card" style={{ borderColor: "#bbf7d0" }}>
                <div className="workflow-card-label">Aksi</div>
                <div className="workflow-card-value">{actionLabel || "Pilih aksi"}</div>
              </div>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Nama Workflow</label>
            <input type="text" required placeholder="Contoh: Follow-up Pelanggan Baru"
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Trigger</label>
            <select required value={form.trigger} onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value }))}>
              <option value="">Pilih trigger...</option>
              {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Kondisi (opsional)</label>
            <input type="text" placeholder="Contoh: pipelineStage = LEAD"
              value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Aksi</label>
            <select required value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))}>
              <option value="">Pilih aksi...</option>
              {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan Workflow"}
            </button>
            {selected && (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(selected)}>
                <Trash2 size={14} /> Hapus
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Helper: highlight teks dengan mark (dipakai KB + Persona) ───────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderWithHighlights(text, query, activeIdx, markIdPrefix = "doc-match") {
  if (!query.trim()) return <span style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>{text}</span>;
  const re = new RegExp(`(${escapeRegex(query)})`, "gi");
  const parts = text.split(re);
  let matchCounter = -1;
  return (
    <span style={{ whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
      {parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          matchCounter++;
          const idx = matchCounter;
          return (
            <mark
              key={i}
              id={`${markIdPrefix}-${idx}`}
              style={{
                background: idx === activeIdx ? "#fb923c" : "#fde68a",
                color: "#111",
                borderRadius: 2,
                outline: idx === activeIdx ? "2px solid #f97316" : "none",
              }}
            >
              {part}
            </mark>
          );
        }
        return part;
      })}
    </span>
  );
}

// ─── AI Playground Tab ────────────────────────────────────────────────────────

function AiPlaygroundTab() {
  const [models, setModels]         = useState([]);
  const [activeModel, setActiveModel] = useState(null);
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [chatting, setChatting]     = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm]       = useState({ name: "", provider: "anthropic", apiKey: "", model: "" });
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState(null);
  // System prompt (persona) + KB toggle
  const [systemPrompt, setSystemPrompt] = useState("");
  const [useKb, setUseKb]           = useState(true);
  const [showPersonaPanel, setShowPersonaPanel] = useState(false);
  const [savingPersona, setSavingPersona] = useState(false);
  const messagesEndRef = useRef(null);
  const [handoverSignal, setHandoverSignal]         = useState(null);
  const [showScenariosPanel, setShowScenariosPanel] = useState(false);
  // Persona search (Ctrl+F style)
  const [personaSearch, setPersonaSearch]   = useState("");
  const [personaMatchIdx, setPersonaMatchIdx] = useState(0);
  const personaTextareaRef = useRef(null);
  const personaScrollContainerRef = useRef(null);

  useEffect(() => {
    api.getAiModels().then(setModels).catch(() => {});
    api.getAiSettings().then((s) => {
      setSystemPrompt(s.personaPrompt || "");
      setUseKb(s.useKb !== false);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Saat search berubah, reset ke match pertama
  useEffect(() => { setPersonaMatchIdx(0); }, [personaSearch]);

  // Scroll persona container ke mark aktif
  useLayoutEffect(() => {
    if (!personaSearch.trim()) return;
    const container = personaScrollContainerRef.current;
    const el = document.getElementById(`persona-match-${personaMatchIdx}`);
    if (!el || !container) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offsetFromTop = elRect.top - containerRect.top;
    const targetScrollTop = container.scrollTop + offsetFromTop - container.clientHeight / 2 + elRect.height / 2;
    container.scrollTop = Math.max(0, targetScrollTop);
  }, [personaMatchIdx, personaSearch]);

  function findPersonaMatches(text, query) {
    if (!query.trim()) return [];
    const positions = [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let i = 0;
    while ((i = lower.indexOf(q, i)) !== -1) { positions.push(i); i += q.length; }
    return positions;
  }

  async function handleAddModel(e) {
    e.preventDefault();
    try {
      const created = await api.createAiModel(addForm);
      setModels((prev) => [...prev, created]);
      setShowAddModal(false);
      setAddForm({ name: "", provider: "anthropic", apiKey: "", model: "" });
      setTestResult(null);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      await api.testAiConnection({ provider: addForm.provider, apiKey: addForm.apiKey, model: addForm.model || undefined });
      setTestResult({ ok: true });
    } catch (err) {
      setTestResult({ ok: false, msg: err.message });
    } finally {
      setTesting(false);
    }
  }

  async function handleChat(e) {
    e.preventDefault();
    if (!input.trim() || !activeModel) return;
    const userMsg = { role: "user", content: input.trim() };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    setInput("");
    setChatting(true);
    try {
      const res = await api.aiChat(activeModel.id, withUser, { systemPrompt: systemPrompt || undefined, useKb });
      const aiMsg = { role: "assistant", content: res.content };
      const allMsgs = [...withUser, aiMsg];
      setMessages(allMsgs);
      // Cek sinyal handover di background — tidak blocking, hanya sekali per sesi
      if (!handoverSignal) {
        api.checkHandover(allMsgs).then((h) => {
          if (h?.shouldHandover) setHandoverSignal(h);
        }).catch(() => {});
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatting(false);
    }
  }

  async function handleSavePersona() {
    setSavingPersona(true);
    try {
      await api.updateAiSettings({ personaPrompt: systemPrompt, useKb });
      alert("Persona berhasil disimpan!");
    } catch (err) {
      alert("Gagal simpan persona: " + err.message);
    } finally {
      setSavingPersona(false);
    }
  }

  async function handleDeleteModel(m) {
    if (!window.confirm("Hapus model ini?")) return;
    await api.deleteAiModel(m.id).catch((e) => alert(e.message));
    setModels((prev) => prev.filter((x) => x.id !== m.id));
    if (activeModel?.id === m.id) { setActiveModel(null); setMessages([]); }
  }

  return (
    <div className="ai-layout" style={{ height: "100%" }}>
      {/* Sidebar */}
      <div className="ai-sidebar">
        <div className="ai-sidebar-header">
          AI Playground
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}><Plus size={13} /></button>
        </div>
        <div className="ai-model-list">
          {models.length === 0 && (
            <div style={{ padding: 20, color: "var(--text-muted)", fontSize: 13 }}>Belum ada model. Klik + untuk tambah.</div>
          )}
          {models.map((m) => (
            <div
              key={m.id}
              className={`ai-model-item ${activeModel?.id === m.id ? "active" : ""}`}
              onClick={() => { setActiveModel(m); setMessages([]); }}
            >
              <div style={{ display: "flex", justify: "space-between", alignItems: "center" }}>
                <div className="ai-model-name">{m.name}</div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteModel(m); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="ai-model-meta">
                <span className={`ai-status-dot ${m.hasKey ? "online" : "offline"}`} />
                {m.provider} · {m.model || "—"}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="ai-chat-area">
        {!activeModel ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
            Pilih model AI di kiri atau tambah model baru
          </div>
        ) : (
          <>
            <div className="ai-chat-header">
              <strong>{activeModel.name}</strong>
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>{activeModel.model}</span>
              <button
                className={`btn btn-ghost btn-sm ${showPersonaPanel ? "active" : ""}`}
                style={{ marginLeft: "auto" }}
                onClick={() => setShowPersonaPanel((v) => !v)}
                title="Persona & Pengaturan AI"
              >
                Persona
              </button>
              <button
                className={`btn btn-ghost btn-sm ${showScenariosPanel ? "active" : ""}`}
                onClick={() => setShowScenariosPanel((v) => !v)}
                title="Panduan Skenario Test Fase C"
              >
                🧪 Skenario
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setMessages([]); setHandoverSignal(null); }}>
                Bersihkan
              </button>
            </div>
            {/* Panel Persona — tampil saat tombol "Persona" diklik */}
            {showPersonaPanel && (() => {
              const personaMatches = findPersonaMatches(systemPrompt, personaSearch);
              const personaMatchCount = personaMatches.length;
              const noPersonaMatch = personaSearch.trim() && personaMatchCount === 0;
              return (
                <div style={{ borderBottom: "1px solid var(--border)", background: "#f8fafc", padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <strong style={{ fontSize: 13 }}>System Prompt / Persona</strong>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "var(--text-secondary)", marginLeft: "auto", cursor: "pointer" }}>
                      <input type="checkbox" checked={useKb} onChange={(e) => setUseKb(e.target.checked)} />
                      Sisipkan Knowledge Base
                    </label>
                  </div>
                  {/* Search bar */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6,
                    marginBottom: 6, padding: "4px 10px",
                    background: noPersonaMatch ? "#fef2f2" : "white",
                    border: `1px solid ${noPersonaMatch ? "#fca5a5" : "var(--border)"}`,
                    borderRadius: 7,
                  }}>
                    <Search size={12} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
                    <input
                      type="text"
                      placeholder="Cari dalam persona... (Enter: berikutnya)"
                      value={personaSearch}
                      onChange={(e) => setPersonaSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && personaMatchCount > 0) {
                          setPersonaMatchIdx(e.shiftKey
                            ? (personaMatchIdx - 1 + personaMatchCount) % personaMatchCount
                            : (personaMatchIdx + 1) % personaMatchCount);
                        }
                        if (e.key === "Escape") setPersonaSearch("");
                      }}
                      style={{ flex: 1, border: "none", background: "transparent", fontSize: 12, outline: "none" }}
                    />
                    {personaSearch.trim() && (
                      <>
                        <span style={{ fontSize: 11, color: noPersonaMatch ? "#ef4444" : "var(--text-muted)", whiteSpace: "nowrap", minWidth: 52, textAlign: "right" }}>
                          {noPersonaMatch ? "Tidak ditemukan" : `${personaMatchIdx + 1} / ${personaMatchCount}`}
                        </span>
                        <button
                          onClick={() => setPersonaMatchIdx((personaMatchIdx - 1 + personaMatchCount) % personaMatchCount)}
                          disabled={personaMatchCount === 0}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", padding: "0px 5px", fontSize: 11, opacity: personaMatchCount === 0 ? 0.4 : 1 }}>↑</button>
                        <button
                          onClick={() => setPersonaMatchIdx((personaMatchIdx + 1) % personaMatchCount)}
                          disabled={personaMatchCount === 0}
                          style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", padding: "0px 5px", fontSize: 11, opacity: personaMatchCount === 0 ? 0.4 : 1 }}>↓</button>
                        <button onClick={() => setPersonaSearch("")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}>
                          <X size={12} />
                        </button>
                      </>
                    )}
                  </div>
                  {/* Textarea: disembunyikan saat search aktif */}
                  <textarea
                    ref={personaTextareaRef}
                    rows={8}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={"Contoh:\nKamu adalah Sano, konsultan tidur di Klinik Matras...\n\n[DI SINI: konten Knowledge Base akan disisipkan otomatis oleh sistem]"}
                    style={{
                      display: personaSearch.trim() ? "none" : "block",
                      width: "100%", fontSize: 12, fontFamily: "monospace", resize: "vertical",
                      border: "1px solid var(--border)", borderRadius: 6, padding: 8,
                    }}
                  />
                  {/* Saat search aktif: highlight sama persis dengan view mode */}
                  {personaSearch.trim() && (
                    <div ref={personaScrollContainerRef} style={{
                      background: "#1e1e2e", color: "#cdd6f4",
                      border: "1px solid var(--border)", borderRadius: 6,
                      maxHeight: 220, overflowY: "auto", padding: 8,
                      fontSize: 12,
                    }}>
                      {renderWithHighlights(systemPrompt, personaSearch, personaMatchIdx, "persona-match")}
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
                    <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>
                      Sisipkan placeholder <code>[DI SINI: konten Knowledge Base akan disisipkan otomatis oleh sistem]</code> untuk injeksi KB
                    </span>
                    <button className="btn btn-primary btn-sm" onClick={handleSavePersona} disabled={savingPersona}>
                      {savingPersona ? "Menyimpan..." : "Simpan Persona"}
                    </button>
                  </div>
                </div>
              );
            })()}
            {/* Panel panduan skenario test Fase C */}
            {showScenariosPanel && (
              <div style={{ borderBottom: "1px solid var(--border)", background: "#f0fdf4", padding: "14px 18px", fontSize: 12 }}>
                <strong style={{ fontSize: 13, display: "block", marginBottom: 8 }}>🧪 Panduan Skenario Test Handover — Fase C (Sandbox)</strong>
                <p style={{ color: "var(--text-muted)", marginBottom: 10, fontSize: 11 }}>
                  Isi Persona dengan system prompt Sano dari file ai-persona-sano-draft.md, lalu coba percakapan di bawah.
                  Card SIMULASI akan muncul di bawah chat kalau sinyal handover terdeteksi.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    { n: 1, label: "Trigger Harga Spesifik",      msg: '"berapa harga upgrade fondasi?"',                       expect: "Card HARGA_SPESIFIK" },
                    { n: 2, label: "Komplain Prioritas Tinggi",    msg: '"kasur yang diupgrade makin sakit pinggang, kecewa"',   expect: "Card KOMPLAIN + badge merah" },
                    { n: 3, label: "Safety Net (8+ balasan)",      msg: "Chat santai soal tidur saja, tanpa tanya harga/order",  expect: "Card SAFETY_NET setelah ≥8 balasan AI" },
                    { n: 4, label: "Minta Foto Produk",            msg: '"bisa kirim foto-foto produknya kak?"',                 expect: "Card MINTA_FOTO" },
                    { n: 5, label: "Negatif — Jangan Trigger",     msg: '"saya sering pegal bangun tidur, normal ga ya?"',       expect: "TIDAK ada card (konsultasi biasa)" },
                  ].map(({ n, label, msg, expect }) => (
                    <div key={n} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px" }}>
                      <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 12 }}>Skenario {n}: {label}</div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Coba: {msg}</div>
                      <div style={{ color: "#16a34a", fontSize: 11, marginTop: 2 }}>✓ Ekspektasi: {expect}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="ai-chat-messages">
              {messages.length === 0 && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: 40, fontSize: 13 }}>
                  Mulai percakapan dengan AI...
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`ai-bubble ${m.role === "user" ? "user" : "ai"}`}>
                  {m.content}
                </div>
              ))}
              {chatting && <div className="ai-bubble ai" style={{ color: "var(--text-muted)" }}>Mengetik...</div>}

              {/* Card simulasi handover — muncul saat sinyal terdeteksi (SANDBOX ONLY) */}
              {handoverSignal?.shouldHandover && (
                <div style={{
                  margin: "12px 0",
                  padding: "14px 16px",
                  background: handoverSignal.priority === "tinggi" ? "#fff1f2" : "#fffbeb",
                  border: `2px solid ${handoverSignal.priority === "tinggi" ? "#f87171" : "#fbbf24"}`,
                  borderRadius: 10,
                  fontSize: 13,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>🔔 SIMULASI: Handover akan terjadi di sini</span>
                    {handoverSignal.priority === "tinggi" && (
                      <span style={{
                        background: "#dc2626", color: "#fff",
                        fontSize: 10, fontWeight: 700,
                        padding: "2px 8px", borderRadius: 10,
                      }}>
                        🚨 PRIORITAS TINGGI
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                    Trigger: {handoverSignal.reasonLabel} · Ini SIMULASI sandbox — tidak memicu aksi nyata
                  </div>
                  {handoverSignal.summary && (
                    <pre style={{
                      margin: 0, fontSize: 12,
                      whiteSpace: "pre-wrap", lineHeight: 1.6,
                      background: "white",
                      border: "1px solid var(--border)",
                      borderRadius: 6, padding: "10px 12px",
                      fontFamily: "inherit",
                    }}>
                      {handoverSignal.summary}
                    </pre>
                  )}
                  <button
                    onClick={() => setHandoverSignal(null)}
                    style={{
                      marginTop: 8, background: "none",
                      border: "1px solid var(--border)", borderRadius: 6,
                      padding: "4px 12px", cursor: "pointer",
                      fontSize: 11, color: "var(--text-muted)",
                    }}
                  >
                    Tutup
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
            <div className="ai-chat-footer">
              <form onSubmit={handleChat} style={{ display: "flex", gap: 8, flex: 1 }}>
                <textarea
                  rows={1}
                  placeholder="Tulis pesan..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(e); } }}
                />
                <button type="submit" className="btn btn-primary" disabled={chatting || !input.trim()}>
                  <Send size={15} />
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* Add Model Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Tambah Model AI</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleAddModel}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Nama Model</label>
                  <input type="text" required placeholder="Contoh: Claude untuk CS"
                    value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <select value={addForm.provider} onChange={(e) => setAddForm((f) => ({ ...f, provider: e.target.value, model: "" }))}>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI (GPT)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Model ID</label>
                  <input type="text"
                    placeholder={addForm.provider === "openai" ? "gpt-5.5 atau gpt-5.4-mini" : "claude-sonnet-4-6 atau claude-haiku-4-5-20251001"}
                    value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    {addForm.provider === "openai"
                      ? "gpt-5.5 (setara Sonnet, lebih mahal) · gpt-5.4-mini (setara Haiku, hemat)"
                      : "claude-sonnet-4-6 (kualitas) · claude-haiku-4-5-20251001 (hemat)"}
                  </p>
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="password" required
                      placeholder={addForm.provider === "openai" ? "sk-..." : "sk-ant-..."}
                      value={addForm.apiKey} onChange={(e) => setAddForm((f) => ({ ...f, apiKey: e.target.value }))}
                      style={{ flex: 1 }} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleTestConnection} disabled={testing || !addForm.apiKey}>
                      {testing ? "..." : "Test"}
                    </button>
                  </div>
                  {testResult && (
                    <p style={{ fontSize: 12, marginTop: 4, color: testResult.ok ? "var(--color-success)" : "var(--color-danger)" }}>
                      {testResult.ok ? "✓ Koneksi berhasil" : "✗ " + testResult.msg}
                    </p>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowAddModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Simpan Model</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Knowledge Base Tab ───────────────────────────────────────────────────────

const CAT_ICONS = {
  "konsep-istilah-teknis": "📚",
  "dunia-kasur-umum":      "🌐",
  "faq-tambahan":          "❓",
  "insight-lapangan":      "💡",
};

function KnowledgeBaseTab() {
  const [docs, setDocs]             = useState([]);
  const [faqs, setFaqs]             = useState([]);
  const [selected, setSelected]     = useState(null);
  const [content, setContent]       = useState("");
  const [searchQ, setSearchQ]       = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [uploading, setUploading]   = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [faqForm, setFaqForm]       = useState({ question: "", answer: "" });
  const [savingFaq, setSavingFaq]   = useState(false);
  const fileInputRef = useRef(null);

  // Quick-Add KB categories
  const [categories, setCategories]         = useState([]);
  const [selectedQCat, setSelectedQCat]     = useState(null);
  const [qEntries, setQEntries]             = useState([]);
  const [expandedEntry, setExpandedEntry]   = useState(null);
  const [loadingQEntries, setLoadingQEntries] = useState(false);
  const [editingEntry, setEditingEntry]     = useState(null); // { index, title, content }
  const [savingEntry, setSavingEntry]       = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState(null);
  const [qEntrySearch, setQEntrySearch]    = useState("");

  // Dokumen yang dipilih
  const [savingDoc, setSavingDoc]       = useState(false);
  const [savedContent, setSavedContent] = useState("");

  // Debug context — lihat apa yang terbaca AI dari KB
  const [showDebugCtx, setShowDebugCtx] = useState(false);
  const [debugCtx, setDebugCtx]         = useState(null);
  const [loadingDebug, setLoadingDebug] = useState(false);

  useEffect(() => {
    Promise.all([api.getKbDocuments(), api.getFaq()]).then(([d, f]) => { setDocs(d); setFaqs(f); }).catch(() => {});
    api.getKbCategories().then(setCategories).catch(() => {});
    api.getMe().then((u) => setCurrentUserRole(u.role)).catch(() => {});
  }, []);

  async function handleSelectQCat(cat) {
    const next = cat === selectedQCat ? null : cat;
    setSelectedQCat(next);
    setExpandedEntry(null);
    setEditingEntry(null);
    setQEntrySearch("");
    if (!next) return;
    setLoadingQEntries(true);
    try { setQEntries(await api.getKbCategoryEntries(cat)); } catch {}
    finally { setLoadingQEntries(false); }
  }

  async function handleSaveEntry() {
    if (!editingEntry || !selectedQCat) return;
    setSavingEntry(true);
    try {
      await api.updateKbEntry(selectedQCat, editingEntry.index, {
        title: editingEntry.title,
        content: editingEntry.content,
      });
      setQEntries(await api.getKbCategoryEntries(selectedQCat));
      setEditingEntry(null);
      setExpandedEntry(null);
    } catch (err) {
      alert("Gagal menyimpan: " + err.message);
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(entry) {
    if (!window.confirm(`Hapus entri "${entry.title}"?`)) return;
    try {
      await api.deleteKbEntry(selectedQCat, entry.index);
      setQEntries(await api.getKbCategoryEntries(selectedQCat));
      api.getKbCategories().then(setCategories).catch(() => {});
      if (editingEntry?.index === entry.index) setEditingEntry(null);
      setExpandedEntry(null);
    } catch (err) {
      alert("Gagal menghapus: " + err.message);
    }
  }

  async function handleUpload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const doc = await api.uploadKbDocument(fd);
      setDocs((prev) => [doc, ...prev]);
    } catch (err) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  }


  async function handleSelectDoc(doc) {
    setSelected(doc);
    setContent("");
    setSavedContent("");
    setSelectedQCat(null);
    try {
      const res = await api.getKbDocumentContent(doc.id);
      setContent(res.text);
      setSavedContent(res.text);
    } catch {}
  }

  async function handleSaveDocContent() {
    if (!selected) return;
    setSavingDoc(true);
    try {
      await api.updateKbDocumentContent(selected.id, content);
      setSavedContent(content);
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingDoc(false);
    }
  }

  async function handleShowDebugContext() {
    setLoadingDebug(true);
    setShowDebugCtx(true);
    setDebugCtx(null);
    try {
      const res = await fetch("/api/ai/debug-context", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      const data = await res.json();
      setDebugCtx(data);
    } catch (err) {
      setDebugCtx({ error: err.message });
    } finally {
      setLoadingDebug(false);
    }
  }

  async function handleToggleDoc(doc) {
    const updated = await api.updateKbDocument(doc.id, { active: !doc.active }).catch((e) => { alert(e.message); return null; });
    if (updated) setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d));
  }

  async function handleDeleteDoc(doc) {
    if (!window.confirm("Hapus dokumen ini?")) return;
    await api.deleteKbDocument(doc.id).catch((e) => alert(e.message));
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    if (selected?.id === doc.id) { setSelected(null); setContent(""); setSavedContent(""); }
  }

  async function handleSearch(e) {
    e.preventDefault();
    if (!searchQ.trim()) return;
    const res = await api.searchKnowledge(searchQ).catch(() => []);
    setSearchResults(res);
  }

  async function handleAddFaq(e) {
    e.preventDefault();
    setSavingFaq(true);
    try {
      const faq = await api.createFaq(faqForm);
      setFaqs((prev) => [faq, ...prev]);
      setFaqForm({ question: "", answer: "" });
    } catch (err) {
      alert(err.message);
    } finally {
      setSavingFaq(false);
    }
  }

  async function handleDeleteFaq(faq) {
    await api.deleteFaq(faq.id).catch((e) => alert(e.message));
    setFaqs((prev) => prev.filter((f) => f.id !== faq.id));
  }

  return (
    <div className="kb-layout" style={{ height: "100%" }}>
      {/* Sidebar */}
      <div className="kb-sidebar">
        {/* Upload zone */}
        <div style={{ padding: 12 }}>
          <div
            className={`upload-zone ${dragActive ? "drag-over" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
          >
            <div className="upload-zone-icon">📄</div>
            <div className="upload-zone-text">{uploading ? "Mengunggah..." : "Drag & drop atau klik"}</div>
            <div className="upload-zone-sub">.txt, .md, .pdf (maks. 5MB)</div>
          </div>
          <input ref={fileInputRef} type="file" accept=".txt,.md,.pdf" style={{ display: "none" }}
            onChange={(e) => handleUpload(e.target.files[0])} />
        </div>

        {/* Doc list */}
        <div style={{ overflowY: "auto" }}>
          {docs.map((d) => (
            <div
              key={d.id}
              className={`kb-doc-item ${selected?.id === d.id && !selectedQCat ? "active" : ""}`}
              onClick={() => { handleSelectDoc(d); setSelectedQCat(null); }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="kb-doc-name">{d.name}</div>
                <div className="kb-doc-meta">{d.active ? "Aktif" : "Nonaktif"}</div>
              </div>
              <button
                className={`toggle ${d.active ? "on" : ""}`}
                style={{ width: 32, height: 18 }}
                onClick={(e) => { e.stopPropagation(); handleToggleDoc(d); }}
              />
              <button onClick={(e) => { e.stopPropagation(); handleDeleteDoc(d); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Quick-Add KB Folders */}
        <div style={{ padding: "12px 12px 0", borderTop: "1px solid var(--border)" }}>
          <p style={{
            fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
            marginBottom: 6, textTransform: "uppercase", letterSpacing: 1,
          }}>
            Quick-Add Entries
          </p>
          {categories.map((c) => (
            <button
              key={c.category}
              onClick={() => handleSelectQCat(c.category)}
              style={{
                width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8,
                border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                background: selectedQCat === c.category ? "var(--primary, #2563eb)" : "transparent",
                color: selectedQCat === c.category ? "#fff" : "var(--text-primary)",
                fontSize: 13, marginBottom: 2,
              }}
            >
              <span>{CAT_ICONS[c.category]}</span>
              <span style={{ flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>({c.count})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="kb-main">
        {/* Tombol debug KB — hanya untuk admin */}
        {currentUserRole === "ADMIN" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button
              onClick={handleShowDebugContext}
              style={{ fontSize: 12, padding: "4px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--text-secondary)" }}
            >
              🔍 Lihat KB yang Terbaca AI
            </button>
          </div>
        )}

        {/* Panel entri Quick-Add kategori yang dipilih */}
        {selectedQCat && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>{CAT_ICONS[selectedQCat]}</span>
              <span style={{ fontWeight: 700, fontSize: 15 }}>
                {categories.find((c) => c.category === selectedQCat)?.label}
              </span>
              <button
                onClick={() => setSelectedQCat(null)}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 18 }}
              >
                ✕
              </button>
            </div>
            {loadingQEntries && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Memuat...</p>
            )}
            {!loadingQEntries && qEntries.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                Belum ada entri. Minta Sano Co-pilot "tambahin info: ..." untuk mulai mengisi kategori ini.
              </p>
            )}
            {!loadingQEntries && qEntries.length > 0 && (
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search size={13} style={{
                  position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)",
                  color: "var(--text-muted)", pointerEvents: "none",
                }} />
                <input
                  type="text"
                  placeholder="Cari entri di kategori ini..."
                  value={qEntrySearch}
                  onChange={(e) => { setQEntrySearch(e.target.value); setExpandedEntry(null); setEditingEntry(null); }}
                  style={{
                    width: "100%", padding: "6px 10px 6px 28px", fontSize: 12,
                    border: "1px solid var(--border)", borderRadius: 7,
                    boxSizing: "border-box", outline: "none",
                  }}
                />
                {qEntrySearch && (
                  <button
                    onClick={() => { setQEntrySearch(""); setExpandedEntry(null); }}
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
            {qEntries.filter((e) => {
              if (!qEntrySearch.trim()) return true;
              const q = qEntrySearch.toLowerCase();
              return e.title.toLowerCase().includes(q) || e.content.toLowerCase().includes(q);
            }).map((entry, i) => {
              const isEditing = editingEntry?.index === entry.index;
              return (
                <div
                  key={entry.index}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, overflow: "hidden" }}
                >
                  {/* Header baris */}
                  <div style={{
                    padding: "10px 14px", background: expandedEntry === i ? "#f8fafc" : "white",
                    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                  }}>
                    <button
                      onClick={() => { setExpandedEntry(expandedEntry === i ? null : i); setEditingEntry(null); }}
                      style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{entry.title}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8 }}>
                        {entry.date} · {entry.author} {expandedEntry === i ? "▲" : "▼"}
                      </span>
                    </button>
                    {currentUserRole === "ADMIN" && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button
                          onClick={() => {
                            setEditingEntry({ index: entry.index, title: entry.title, content: entry.content });
                            setExpandedEntry(i);
                          }}
                          title="Edit entri"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: "2px 4px" }}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => handleDeleteEntry(entry)}
                          title="Hapus entri"
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: "2px 4px" }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Body — mode baca atau mode edit */}
                  {expandedEntry === i && !isEditing && (
                    <div style={{
                      padding: "0 14px 12px", fontSize: 13,
                      color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.6,
                      borderTop: "1px solid var(--border)",
                    }}>
                      {entry.content}
                    </div>
                  )}
                  {expandedEntry === i && isEditing && (
                    <div style={{ padding: "10px 14px 12px", borderTop: "1px solid var(--border)" }}>
                      <input
                        value={editingEntry.title}
                        onChange={(e) => setEditingEntry((v) => ({ ...v, title: e.target.value }))}
                        placeholder="Judul entri"
                        style={{
                          width: "100%", marginBottom: 8, padding: "6px 10px", fontSize: 13,
                          border: "1px solid var(--border)", borderRadius: 6, boxSizing: "border-box",
                        }}
                      />
                      <textarea
                        value={editingEntry.content}
                        onChange={(e) => setEditingEntry((v) => ({ ...v, content: e.target.value }))}
                        rows={6}
                        placeholder="Isi entri..."
                        style={{
                          width: "100%", marginBottom: 8, padding: "6px 10px", fontSize: 13,
                          border: "1px solid var(--border)", borderRadius: 6, resize: "vertical",
                          boxSizing: "border-box", fontFamily: "inherit", lineHeight: 1.6,
                        }}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={handleSaveEntry}
                          disabled={savingEntry || !editingEntry.title.trim() || !editingEntry.content.trim()}
                          className="btn btn-primary btn-sm"
                        >
                          {savingEntry ? "Menyimpan..." : "Simpan"}
                        </button>
                        <button
                          onClick={() => setEditingEntry(null)}
                          className="btn btn-sm"
                          style={{ background: "var(--border)", color: "var(--text-primary)" }}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <div className="search-input-wrap" style={{ flex: 1, margin: 0 }}>
            <Search size={14} className="search-icon" />
            <input className="search-input" placeholder="Cari di Knowledge Base..."
              value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm">Cari</button>
        </form>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: "0 0 8px" }}>Hasil Pencarian</h4>
            {searchResults.map((r, i) => (
              <div key={i} style={{ padding: "10px 14px", background: "#fffff0", border: "1px solid #fde68a", borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{r.source}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{r.snippet}</div>
              </div>
            ))}
          </div>
        )}

        {/* Doc editor — CodeMirror (search + edit dalam satu komponen) */}
        {selected && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 14, wordBreak: "break-all" }}>{selected.name}</h4>
            <MarkdownEditor
              value={content}
              onChange={setContent}
              onSave={handleSaveDocContent}
              isAdmin={currentUserRole === "ADMIN"}
              saving={savingDoc}
              hasChanges={content !== savedContent}
            />
          </div>
        )}

        {/* FAQ section */}
        <h4 style={{ margin: "0 0 12px" }}>FAQ Manual</h4>
        <form onSubmit={handleAddFaq} style={{ marginBottom: 16, background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
          <div className="form-group">
            <label className="form-label">Pertanyaan</label>
            <input type="text" required placeholder="Apa yang sering ditanya pelanggan?"
              value={faqForm.question} onChange={(e) => setFaqForm((f) => ({ ...f, question: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Jawaban</label>
            <textarea rows={3} required placeholder="Jawaban yang akan dipakai AI..."
              style={{ width: "100%", resize: "vertical", borderRadius: 8, padding: "8px 12px", border: "1px solid var(--border)", fontFamily: "inherit", fontSize: 13.5 }}
              value={faqForm.answer} onChange={(e) => setFaqForm((f) => ({ ...f, answer: e.target.value }))} />
          </div>
          <button type="submit" className="btn btn-primary btn-sm" disabled={savingFaq}>
            {savingFaq ? "Menyimpan..." : "Tambah FAQ"}
          </button>
        </form>
        {faqs.map((faq) => (
          <div key={faq.id} style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px", marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>Q: {faq.question}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>A: {faq.answer}</div>
              </div>
              <button onClick={() => handleDeleteFaq(faq)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0, padding: 2 }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Lihat KB yang Terbaca AI */}
      {showDebugCtx && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setShowDebugCtx(false)}
        >
          <div
            style={{ background: "var(--card-bg)", borderRadius: 12, padding: 24, maxWidth: 720, width: "90%", maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>Knowledge Base yang Dibaca AI</h3>
              <button onClick={() => setShowDebugCtx(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1, color: "var(--text-muted)" }}>×</button>
            </div>
            {loadingDebug ? (
              <p style={{ color: "var(--text-muted)" }}>Memuat...</p>
            ) : debugCtx?.error ? (
              <p style={{ color: "var(--danger)" }}>{debugCtx.error}</p>
            ) : (
              <>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                  {debugCtx?.isEmpty
                    ? "⚠️ KB kosong — AI tidak punya konteks tambahan"
                    : `✅ ${debugCtx?.length?.toLocaleString("id-ID")} karakter terbaca`}
                </p>
                <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f8fafc", padding: 12, borderRadius: 6, border: "1px solid var(--border)", maxHeight: 420, overflow: "auto", margin: 0 }}>
                  {debugCtx?.kbContext || "(kosong)"}
                </pre>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Automation Page ─────────────────────────────────────────────────────

const SUB_TABS = [
  { key: "workflow",   label: "Workflow" },
  { key: "ai",        label: "AI Playground" },
  { key: "knowledge", label: "Knowledge Base" },
];

export default function Automation() {
  const [tab, setTab] = useState("workflow");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      {/* Sub-tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 24px", background: "white", flexShrink: 0 }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "14px 20px",
              fontSize: 14,
              fontWeight: tab === t.key ? 700 : 500,
              background: "none",
              border: "none",
              borderBottom: tab === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
              color: tab === t.key ? "var(--color-primary)" : "var(--text-muted)",
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "workflow"   && <WorkflowTab />}
        {tab === "ai"        && <AiPlaygroundTab />}
        {tab === "knowledge" && <KnowledgeBaseTab />}
      </div>
    </div>
  );
}
