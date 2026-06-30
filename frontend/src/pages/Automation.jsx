import React, { useEffect, useState, useRef } from "react";
import { Plus, Trash2, Upload, Search, Send, X } from "lucide-react";
import { api } from "../api.js";

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
  const messagesEndRef = useRef(null);

  useEffect(() => {
    api.getAiModels().then(setModels).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      await api.testAiConnection({ provider: addForm.provider, apiKey: addForm.apiKey });
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
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setChatting(true);
    try {
      const res = await api.aiChat(activeModel.id, [...messages, userMsg]);
      setMessages((prev) => [...prev, { role: "assistant", content: res.content }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setChatting(false);
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
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setMessages([])}>
                Bersihkan
              </button>
            </div>
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
                  <select value={addForm.provider} onChange={(e) => setAddForm((f) => ({ ...f, provider: e.target.value }))}>
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai" disabled>OpenAI (GPT) — Belum Didukung</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Model ID</label>
                  <input type="text" placeholder="claude-sonnet-4-6"
                    value={addForm.model} onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input type="password" required placeholder="sk-ant-..."
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

  useEffect(() => {
    Promise.all([api.getKbDocuments(), api.getFaq()]).then(([d, f]) => { setDocs(d); setFaqs(f); }).catch(() => {});
  }, []);

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
    try {
      const res = await api.getKbDocumentContent(doc.id);
      setContent(res.text);
    } catch {}
  }

  async function handleToggleDoc(doc) {
    const updated = await api.updateKbDocument(doc.id, { active: !doc.active }).catch((e) => { alert(e.message); return null; });
    if (updated) setDocs((prev) => prev.map((d) => d.id === updated.id ? updated : d));
  }

  async function handleDeleteDoc(doc) {
    if (!window.confirm("Hapus dokumen ini?")) return;
    await api.deleteKbDocument(doc.id).catch((e) => alert(e.message));
    setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    if (selected?.id === doc.id) { setSelected(null); setContent(""); }
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
        <div style={{ flex: 1, overflowY: "auto" }}>
          {docs.map((d) => (
            <div
              key={d.id}
              className={`kb-doc-item ${selected?.id === d.id ? "active" : ""}`}
              onClick={() => handleSelectDoc(d)}
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
      </div>

      {/* Main */}
      <div className="kb-main">
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

        {/* Doc preview */}
        {selected && (
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 8px" }}>{selected.name}</h4>
            <div className="kb-preview" style={{ background: "white", border: "1px solid var(--border)", borderRadius: 10, maxHeight: 320, overflowY: "auto" }}>
              {content || <span style={{ color: "var(--text-muted)" }}>Memuat...</span>}
            </div>
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
