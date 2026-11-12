import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MessageSquare, PenLine, ClipboardCheck, FlaskConical, Sparkles, ThumbsUp, ThumbsDown,
  ArrowUp, Plus, Loader2, Check, AlertTriangle, LayoutGrid, Users,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api.js";
import { rolesOf } from "@/lib/roles.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Button } from "@/components/ui/button.jsx";

// ─── AI STUDIO — MVP 1 (November 2026) ──────────────────────────────────────
// Workspace TERPISAH dari Sales CRM (keputusan Owner). Tiga layar:
//   • Playground  — sales berperan sebagai customer, AI (Mattress Consultant)
//                   menjawab; setiap balasan bisa dinilai & dikoreksi.
//   • Tinjauan    — Owner/Admin menerima/menolak koreksi → jadi test case.
//   • Test Case   — kumpulan kasus dari koreksi yang diterima (dipakai MVP 2).
// Belum ada balasan ke customer sungguhan.
// Gaya: token SANSS (kartu tanpa border, bayangan lembut) + ubin ikon
// bergradien ala iOS (mockup "Sano AI Studio", 12 Nov 2026).

const TILE = {
  blue: "linear-gradient(160deg,#6AB7FF,#1E6BFF)",
  orange: "linear-gradient(160deg,#FFC15A,#FF7A1A)",
  purple: "linear-gradient(160deg,#C48BFF,#8A3FFC)",
  green: "linear-gradient(160deg,#5EE07D,#1FA84A)",
  indigo: "linear-gradient(160deg,#8C9BFF,#4B47E0)",
};

const ALASAN = [
  ["LUPA_KIRIM_KATALOG", "Lupa kirim katalog"],
  ["INFO_SALAH", "Info salah"],
  ["TERLALU_PANJANG", "Terlalu panjang"],
  ["NADA_KURANG_HANGAT", "Nada kurang hangat"],
  ["HARGA_TERLALU_CEPAT_LAMBAT", "Harga terlalu cepat/lambat"],
  ["PERTANYAAN_KURANG_TEPAT", "Pertanyaan kurang tepat"],
  ["REKOMENDASI_TIDAK_SESUAI", "Rekomendasi tidak sesuai"],
  ["HARUS_HANDOVER", "Harus handover"],
  ["LAINNYA", "Lainnya"],
];
const LABEL_ALASAN = Object.fromEntries(ALASAN);

const SKENARIO = [
  ["Tanya harga di awal", "Halo, saya lihat iklannya. Kasur 160 harganya berapa ya?"],
  ["Seharga kasur baru", "Wah harganya sama kayak beli kasur baru ya kak"],
  ["Saraf kejepit", "Saya ada saraf kejepit di pinggang, kasur 180 udah amblas. Berat saya 85 kg."],
  ["Minta diskon", "Bisa diskon nggak kak? Temen saya dapet potongan."],
  ["Komplain", "Kasur yang kemarin diupgrade kok malah tambah sakit, kecewa banget."],
];

const TAHAP = ["SAMBUT", "DIAGNOSA", "EDUKASI", "REKOMENDASI", "HARGA", "KEBERATAN", "CLOSING", "HANDOVER"];
const LABEL_DATA = [
  ["ukuran", "Ukuran"], ["beratBadan", "Berat badan"], ["keluhan", "Keluhan"], ["kondisiKasur", "Kondisi kasur"],
  ["umurKasur", "Umur kasur"], ["posisiTidur", "Posisi tidur"], ["riwayatKesehatan", "Riwayat kesehatan"], ["domisili", "Domisili"],
];

const card = { background: "var(--bg-surface)", boxShadow: "var(--shadow-card)", borderRadius: 20 };
const pill = (aktif) => ({
  border: "none", borderRadius: 999, padding: "7px 12px", fontSize: 12.5, fontWeight: aktif ? 700 : 600, cursor: "pointer",
  background: aktif ? "var(--accent-bg)" : "var(--bg-inset)", color: aktif ? "var(--accent)" : "var(--text-secondary)",
});

function Tile({ grad, Icon, size = 36 }) {
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.27, background: grad, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", boxShadow: "inset 0 1px 0 rgba(255,255,255,.35)" }}>
      <Icon size={size * 0.5} color="#fff" strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

function fmtData(v) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? `${x} kg` : x)).join(" · ");
  return String(v);
}

// ── Navigasi tab di dalam workspace (sidebar tetap milik Layout) ────────────
function StudioTabs({ tab, onTab, menunggu, bisaTinjau }) {
  const items = [
    ["playground", "Playground", MessageSquare, TILE.blue],
    ...(bisaTinjau ? [["tinjauan", "Tinjauan", ClipboardCheck, TILE.purple]] : []),
    ["test-case", "Test Case", FlaskConical, TILE.green],
  ];
  return (
    <nav aria-label="Menu AI Studio" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {items.map(([key, label, Icon, grad]) => (
        <button key={key} type="button" onClick={() => onTab(key)} aria-current={tab === key ? "page" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 10, border: "none", cursor: "pointer", borderRadius: 14, padding: "8px 14px 8px 8px",
            background: tab === key ? "var(--bg-surface)" : "transparent", boxShadow: tab === key ? "var(--shadow-card)" : "none", color: "var(--text-primary)", fontWeight: tab === key ? 800 : 600, fontSize: 14 }}>
          <Tile grad={grad} Icon={Icon} size={30} />
          {label}
          {key === "tinjauan" && menunggu > 0 && (
            <span style={{ background: "#FF3B30", color: "#fff", fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "1px 7px" }}>{menunggu}</span>
          )}
        </button>
      ))}
    </nav>
  );
}

// ── Widget ringkasan ────────────────────────────────────────────────────────
function Widgets({ summary, biaya }) {
  const w = [
    [TILE.orange, PenLine, summary?.koreksiMingguIni ?? "—", "Koreksi minggu ini"],
    [TILE.blue, Check, summary?.persenBagus != null ? `${summary.persenBagus}%` : "—", "Balasan dinilai bagus"],
    [TILE.green, FlaskConical, summary?.testCaseAktif ?? "—", "Test case aktif"],
    [TILE.purple, Users, summary?.pelatihAktif ?? "—", "Sales ikut melatih"],
    [TILE.indigo, LayoutGrid, biaya ? `$${biaya.terpakai.toFixed(2)}` : "—", biaya ? `Biaya bulan ini / $${biaya.batas}` : "Biaya bulan ini"],
  ];
  return (
    <section aria-label="Ringkasan" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
      {w.map(([grad, Icon, angka, label]) => (
        <div key={label} style={{ ...card, borderRadius: 18, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
          <Tile grad={grad} Icon={Icon} size={44} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.4 }}>{angka}</span>
            <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 600 }}>{label}</span>
          </span>
        </div>
      ))}
    </section>
  );
}

// ── Form koreksi di bawah satu balasan AI ───────────────────────────────────
function KoreksiForm({ message, onDone }) {
  const [rating, setRating] = useState(null);
  const [ideal, setIdeal] = useState((message.content?.bubbles || []).join("\n"));
  const [alasan, setAlasan] = useState([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const kirim = async (r) => {
    setErr("");
    setSaving(true);
    try {
      await api.studioFeedback(message.id, r === "GOOD" ? { rating: "GOOD" } : { rating: "BAD", idealReply: ideal, reasons: alasan, note });
      onDone();
    } catch (e) {
      setErr(e.message || "Gagal menyimpan koreksi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...card, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10, boxShadow: "var(--shadow-popover)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14 }}><Tile grad={TILE.orange} Icon={PenLine} size={26} />Nilai balasan ini</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-label="Balasan bagus" disabled={saving} onClick={() => kirim("GOOD")}
            style={{ width: 36, height: 36, border: "none", borderRadius: 10, cursor: "pointer", background: "var(--green-bg)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ThumbsUp size={17} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Balasan kurang tepat" aria-pressed={rating === "BAD"} onClick={() => setRating("BAD")}
            style={{ width: 36, height: 36, border: "none", borderRadius: 10, cursor: "pointer", background: rating === "BAD" ? "var(--red-bg)" : "var(--bg-inset)", color: rating === "BAD" ? "var(--red)" : "var(--text-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ThumbsDown size={17} aria-hidden="true" />
          </button>
        </span>
      </div>
      {rating === "BAD" && (
        <>
          <label htmlFor={`ideal-${message.id}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" }}>Balasan yang seharusnya</label>
          <textarea id={`ideal-${message.id}`} rows={4} value={ideal} onChange={(e) => setIdeal(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", border: "none", background: "var(--bg-inset)", borderRadius: 12, padding: 12, fontFamily: "inherit", fontSize: 14, lineHeight: 1.45, color: "var(--text-primary)", resize: "vertical" }} />
          <div role="group" aria-label="Alasan koreksi" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALASAN.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={alasan.includes(k)} style={pill(alasan.includes(k))}
                onClick={() => setAlasan((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))}>{label}</button>
            ))}
          </div>
          <label htmlFor={`note-${message.id}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-secondary)" }}>Catatan untuk tim (opsional)</label>
          <input id={`note-${message.id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. customer seperti ini biasanya…"
            style={{ border: "none", background: "var(--bg-inset)", borderRadius: 10, padding: "10px 12px", fontFamily: "inherit", fontSize: 13.5, color: "var(--text-primary)" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => setRating(null)}>Batal</Button>
            <Button onClick={() => kirim("BAD")} disabled={saving || !ideal.trim()}>{saving ? <Loader2 size={15} className="animate-spin" /> : null} Kirim koreksi</Button>
          </div>
        </>
      )}
      {err && <span style={{ color: "var(--red)", fontSize: 12.5 }}>{err}</span>}
    </div>
  );
}

// ── Satu balasan AI (bubble + kartu katalog + status koreksi) ──────────────
function AgentTurn({ m, onSelect, selected, onFeedbackDone }) {
  const c = m.content || {};
  const sudah = (m.feedback || [])[0];
  return (
    <div style={{ alignSelf: "flex-end", maxWidth: "78%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
      {(c.bubbles || []).map((b, i) => (
        <button key={i} type="button" onClick={() => onSelect(m.id)} aria-label="Lihat alasan balasan ini"
          style={{ textAlign: "left", border: "none", cursor: "pointer", background: "var(--accent)", color: "#fff", borderRadius: "18px 18px 6px 18px", padding: "11px 14px", fontSize: 14.5, lineHeight: 1.45, whiteSpace: "pre-wrap", outline: selected ? "3px solid var(--accent-bg)" : "none", outlineOffset: 2 }}>
          {b}
        </button>
      ))}
      {(c.kirimKatalog || []).map((k) => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--bg-surface)", boxShadow: "0 1px 2px rgba(0,0,0,.06)", borderRadius: 14, padding: "8px 12px 8px 8px" }}>
          <Tile grad={TILE.blue} Icon={LayoutGrid} size={34} />
          <span style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>{k}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>Kartu katalog</span>
          </span>
        </span>
      ))}
      <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
        AI · {c.tahap || "—"}{c.handover?.perlu ? " · serahkan ke sales" : ""}{sudah ? ` · ${sudah.rating === "GOOD" ? "dinilai bagus" : "sudah dikoreksi"}` : ""}
      </span>
      {!sudah && selected && <div style={{ width: "min(560px, 100%)" }}><KoreksiForm message={m} onDone={onFeedbackDone} /></div>}
    </div>
  );
}

// ── Panel "kenapa AI menjawab begini" ───────────────────────────────────────
function PanelAlasan({ m }) {
  if (!m) {
    return <section style={{ ...card, padding: 18, fontSize: 13.5, color: "var(--text-secondary)" }}>Klik balasan AI untuk melihat alasannya di sini.</section>;
  }
  const c = m.content || {};
  const idx = TAHAP.indexOf(c.tahap);
  const data = c.dataTerkumpul || {};
  const terisi = LABEL_DATA.filter(([k]) => fmtData(data[k])).length;
  const checks = c.checks || [];
  const lulus = checks.filter((x) => x.lulus).length;
  return (
    <>
      <section style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Tahap percakapan</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {TAHAP.slice(0, 7).map((t, i) => (
            <span key={t} style={{ borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700,
              background: i === idx ? "var(--accent)" : i < idx ? "var(--green-bg)" : "var(--bg-inset)",
              color: i === idx ? "#fff" : i < idx ? "var(--green)" : "var(--text-secondary)" }}>{i < idx ? "✓ " : ""}{t[0] + t.slice(1).toLowerCase()}</span>
          ))}
          {c.tahap === "HANDOVER" && <span style={{ borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 700, background: "var(--orange-bg)", color: "var(--orange)" }}>Handover</span>}
        </div>
        {c.catatanInternal && <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{c.catatanInternal}</span>}
      </section>

      <section style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Data terkumpul</h2>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--blue-ink)", background: "var(--blue-50)", borderRadius: 999, padding: "4px 9px" }}>{terisi} dari {LABEL_DATA.length}</span>
        </div>
        {LABEL_DATA.map(([k, label], i) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", fontSize: 13.5, boxShadow: i < LABEL_DATA.length - 1 ? "inset 0 -1px 0 var(--hairline)" : "none" }}>
            <span style={{ color: "var(--text-secondary)" }}>{label}</span>
            <span style={{ fontWeight: fmtData(data[k]) ? 700 : 600, color: fmtData(data[k]) ? "var(--text-primary)" : "var(--text-tertiary)", textAlign: "right" }}>{fmtData(data[k]) || "Belum"}</span>
          </div>
        ))}
      </section>

      {(c.rekomendasi?.utama || c.rekomendasi?.alternatif) && (
        <section style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Arah rekomendasi</h2>
          {c.rekomendasi.utama && <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.rekomendasi.utama}</span>}
          {c.rekomendasi.alternatif && <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Alternatif: {c.rekomendasi.alternatif}</span>}
        </section>
      )}

      <section style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800 }}>Cek keras</h2>
          <span style={{ fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "4px 9px", background: lulus === checks.length ? "var(--green-bg)" : "var(--orange-bg)", color: lulus === checks.length ? "var(--green)" : "var(--orange)" }}>{lulus}/{checks.length} lulus</span>
        </div>
        {checks.map((x) => (
          <span key={x.kode} style={{ fontSize: 13.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
            {x.lulus ? <Check size={16} color="var(--green)" aria-label="Lulus" /> : <AlertTriangle size={16} color="var(--orange)" aria-label="Perlu dicek" />}
            {x.pesan}
          </span>
        ))}
      </section>

      <section style={{ ...card, padding: "16px 18px", display: "flex", justifyContent: "space-between", gap: 10 }}>
        {[["Model", (m.model || "—").replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2").replace(/-/g, " ")], ["Token", (m.inputTokens + m.outputTokens + m.cacheReadTokens).toLocaleString("id-ID")], ["Biaya", `$${(m.costUsd || 0).toFixed(4)}`], ["Cache", m.cacheReadTokens ? `${Math.round((m.cacheReadTokens / (m.inputTokens + m.cacheReadTokens)) * 100)}%` : "0%"]].map(([l, v]) => (
          <span key={l} style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 11.5, color: "var(--text-secondary)", fontWeight: 600 }}>{l}</span>
            <span style={{ fontSize: 14, fontWeight: 800, textTransform: l === "Model" ? "capitalize" : "none" }}>{v}</span>
          </span>
        ))}
      </section>
    </>
  );
}

// ── PLAYGROUND ──────────────────────────────────────────────────────────────
function Playground({ meta, onChanged }) {
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [text, setText] = useState("");
  const [model, setModel] = useState("claude-haiku-5-5");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const bawah = useRef(null);

  const muatDaftar = useCallback(async () => {
    const r = await api.studioSessions();
    setSessions(r.sessions || []);
    return r.sessions || [];
  }, []);
  const buka = useCallback(async (id) => {
    const r = await api.studioSession(id);
    setSession(r.session);
    const agents = (r.session.messages || []).filter((x) => x.role === "AGENT");
    setSelectedId(agents.length ? agents[agents.length - 1].id : null);
  }, []);

  useEffect(() => {
    muatDaftar().then((list) => { if (list[0]) buka(list[0].id); }).catch((e) => setErr(e.message));
  }, [muatDaftar, buka]);
  useEffect(() => { bawah.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [session?.messages?.length]);

  const baru = async (judul) => {
    setErr("");
    const r = await api.studioCreateSession({ title: judul || "Simulasi baru", model });
    await muatDaftar();
    setSession({ ...r.session, messages: [] });
    setSelectedId(null);
  };

  const kirim = async (isi) => {
    const t = (isi ?? text).trim();
    if (!t || sending) return;
    setErr("");
    setSending(true);
    try {
      let s = session;
      if (!s) {
        const r = await api.studioCreateSession({ title: t.slice(0, 60), model });
        s = { ...r.session, messages: [] };
        await muatDaftar();
      }
      const r = await api.studioSend(s.id, t, model);
      setSession({ ...s, messages: [...(s.messages || []), r.customer, r.agent] });
      setSelectedId(r.agent.id);
      setText("");
      muatDaftar().catch(() => {}); // jumlah pesan di daftar sesi ikut terbarui
      onChanged?.();
    } catch (e) {
      setErr(e.message || "Gagal mengirim");
    } finally {
      setSending(false);
    }
  };

  const terpilih = useMemo(() => session?.messages?.find((x) => x.id === selectedId), [session, selectedId]);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
      <section aria-label="Simulasi chat" style={{ ...card, borderRadius: 22, flex: "999 1 520px", minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, boxShadow: "inset 0 -1px 0 var(--hairline)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <label htmlFor="sesi" style={{ fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 600 }}>Sesi</label>
            <select id="sesi" value={session?.id || ""} onChange={(e) => e.target.value && buka(e.target.value)}
              style={{ border: "none", background: "var(--bg-inset)", borderRadius: 10, padding: "8px 10px", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, color: "var(--text-primary)", maxWidth: 280 }}>
              {!session && <option value="">Belum ada sesi</option>}
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.title} ({s._count?.messages || 0})</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={() => baru()}><Plus size={15} /> Baru</Button>
          </div>
          <div role="group" aria-label="Model" style={{ display: "flex", background: "var(--bg-inset)", borderRadius: 11, padding: 3 }}>
            {(meta?.models || ["claude-haiku-5-5", "claude-sonnet-5-5"]).filter((x) => !x.includes("opus")).map((x) => (
              <button key={x} type="button" aria-pressed={model === x} onClick={() => setModel(x)}
                style={{ border: "none", cursor: "pointer", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, fontWeight: model === x ? 700 : 600,
                  background: model === x ? "var(--bg-surface)" : "transparent", boxShadow: model === x ? "0 1px 3px rgba(0,0,0,.12)" : "none", color: "var(--text-primary)", textTransform: "capitalize" }}>
                {x.replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2")}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "10px 18px", display: "flex", flexWrap: "wrap", gap: 6, boxShadow: "inset 0 -1px 0 var(--hairline)" }}>
          <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 700, alignSelf: "center" }}>Skenario cepat:</span>
          {SKENARIO.map(([label, isi]) => (
            <button key={label} type="button" style={pill(false)} onClick={() => setText(isi)}>{label}</button>
          ))}
        </div>

        <div style={{ padding: "20px 18px 10px", display: "flex", flexDirection: "column", gap: 12, background: "var(--bg-inset)", minHeight: 360, maxHeight: "62vh", overflowY: "auto" }}>
          {!session?.messages?.length && (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--text-secondary)", fontSize: 14, maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <Tile grad={TILE.blue} Icon={Sparkles} size={52} />
              Berperan sebagai customer: ketik pesan pertama atau pilih skenario cepat di atas.
            </div>
          )}
          {(session?.messages || []).map((m) =>
            m.role === "CUSTOMER" ? (
              <div key={m.id} style={{ alignSelf: "flex-start", maxWidth: "78%", background: "var(--bg-surface)", boxShadow: "0 1px 2px rgba(0,0,0,.06)", borderRadius: "18px 18px 18px 6px", padding: "11px 14px", fontSize: 14.5, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{m.content?.text}</div>
            ) : (
              <AgentTurn key={m.id} m={m} selected={m.id === selectedId} onSelect={setSelectedId}
                onFeedbackDone={() => { buka(session.id); onChanged?.(); }} />
            )
          )}
          {sending && <span style={{ alignSelf: "flex-end", fontSize: 12.5, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}><Loader2 size={14} className="animate-spin" /> AI sedang menyusun balasan…</span>}
          <div ref={bawah} />
        </div>

        <form onSubmit={(e) => { e.preventDefault(); kirim(); }} style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", boxShadow: "inset 0 1px 0 var(--hairline)" }}>
          <label htmlFor="pesan-customer" className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Ketik sebagai customer</label>
          <input id="pesan-customer" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ketik sebagai customer…" maxLength={2000}
            style={{ flex: 1, minWidth: 0, border: "none", background: "var(--bg-inset)", borderRadius: 999, padding: "12px 16px", fontFamily: "inherit", fontSize: 14, color: "var(--text-primary)" }} />
          <button type="submit" aria-label="Kirim" disabled={sending || !text.trim()}
            style={{ width: 44, height: 44, border: "none", borderRadius: 999, background: "var(--accent)", opacity: sending || !text.trim() ? 0.5 : 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowUp size={18} color="#fff" aria-hidden="true" />
          </button>
        </form>
        {err && <div role="alert" style={{ padding: "0 16px 12px", color: "var(--red)", fontSize: 13 }}>{err}</div>}
      </section>

      <aside aria-label="Penjelasan balasan AI" style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        <PanelAlasan m={terpilih} />
      </aside>
    </div>
  );
}

// ── TINJAUAN (Owner/Admin) ──────────────────────────────────────────────────
function Tinjauan({ onChanged }) {
  const [status, setStatus] = useState("NEW");
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const muat = useCallback(() => {
    setItems(null);
    api.studioFeedbackQueue(status).then((r) => setItems(r.items || [])).catch((e) => { setErr(e.message); setItems([]); });
  }, [status]);
  useEffect(muat, [muat]);

  const putuskan = async (id, action) => {
    try {
      await api.studioReview(id, action);
      muat();
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div role="group" aria-label="Status" style={{ display: "flex", gap: 6 }}>
        {[["NEW", "Menunggu"], ["ACCEPTED", "Diterima"], ["REJECTED", "Ditolak"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} style={pill(status === k)} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      {err && <div role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
      {items === null && <Loader2 className="animate-spin" />}
      {items?.length === 0 && <div style={{ ...card, padding: 24, color: "var(--text-secondary)", fontSize: 14 }}>Tidak ada koreksi di sini.</div>}
      {items?.map((f) => (
        <article key={f.id} style={{ ...card, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 12.5, color: "var(--text-secondary)" }}>
            <span><b style={{ color: "var(--text-primary)" }}>{f.createdByName}</b> · {f.message?.session?.title}</span>
            <span>{new Date(f.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <div style={{ background: "var(--bg-inset)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-secondary)", marginBottom: 6 }}>Balasan AI</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{(f.message?.content?.bubbles || []).join("\n\n")}</div>
            </div>
            <div style={{ background: f.rating === "GOOD" ? "var(--green-bg)" : "var(--accent-bg)", borderRadius: 14, padding: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: f.rating === "GOOD" ? "var(--green)" : "var(--accent)", marginBottom: 6 }}>{f.rating === "GOOD" ? "Dinilai bagus" : "Balasan yang seharusnya"}</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{f.idealReply || "—"}</div>
            </div>
          </div>
          {(f.reasons?.length > 0 || f.note) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              {f.reasons.map((r) => <span key={r} style={pill(true)}>{LABEL_ALASAN[r] || r}</span>)}
              {f.note && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>“{f.note}”</span>}
            </div>
          )}
          {f.status === "NEW" && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button variant="ghost" onClick={() => putuskan(f.id, "REJECT")}>Tolak</Button>
              <Button onClick={() => putuskan(f.id, "ACCEPT")}>{f.rating === "BAD" ? "Terima → jadi test case" : "Terima"}</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

// ── TEST CASE ───────────────────────────────────────────────────────────────
function TestCases() {
  const [items, setItems] = useState(null);
  useEffect(() => { api.studioTestCases().then((r) => setItems(r.items || [])).catch(() => setItems([])); }, []);
  if (items === null) return <Loader2 className="animate-spin" />;
  if (!items.length) return <div style={{ ...card, padding: 24, color: "var(--text-secondary)", fontSize: 14 }}>Belum ada test case. Koreksi yang diterima di Tinjauan otomatis masuk ke sini.</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {items.map((t) => (
        <article key={t.id} style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: 14 }}><Tile grad={TILE.green} Icon={FlaskConical} size={30} />{t.title}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
            {(t.history || []).slice(-4).map((h, i) => (
              <span key={i} style={{ color: h.role === "customer" ? "var(--text-primary)" : "var(--text-secondary)" }}><b>{h.role === "customer" ? "Customer" : "AI"}:</b> {h.text}</span>
            ))}
          </div>
          <div style={{ background: "var(--accent-bg)", borderRadius: 12, padding: 10, fontSize: 13, lineHeight: 1.45 }}><b>Ideal:</b> {t.idealReply}</div>
          {t.mustRules?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{t.mustRules.map((r) => <span key={r} style={pill(false)}>{LABEL_ALASAN[r] || r}</span>)}</div>}
        </article>
      ))}
    </div>
  );
}

// ── HALAMAN ─────────────────────────────────────────────────────────────────
export default function AiStudio({ tab = "playground" }) {
  const navigate = useNavigate();
  // Tinjauan koreksi khusus ADMIN/OWNER (server menegakkan ulang) — SALES tidak melihat tab/menunya.
  const bisaTinjau = useMemo(() => {
    try { return rolesOf(JSON.parse(localStorage.getItem("user") || "null")).some((r) => r === "ADMIN" || r === "OWNER"); } catch { return false; }
  }, []);
  const aktif = tab === "tinjauan" && !bisaTinjau ? "playground" : tab;
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");

  const muatMeta = useCallback(() => {
    api.studioAgents().then(setMeta).catch((e) => setErr(e.message));
    api.studioSummary().then(setSummary).catch(() => {});
  }, []);
  useEffect(muatMeta, [muatMeta]);

  // Lewat router (bukan history.replaceState) supaya menu aktif di sidebar ikut berpindah.
  const gantiTab = (k) => navigate(k === "playground" ? "/ai-studio" : `/ai-studio/${k}`);
  const agent = meta?.agents?.[0];
  const live = agent?.versions?.find((v) => v.status === "LIVE");

  return (
    <PageContainer>
      <PageHeader
        title="AI Studio"
        subtitle={agent ? `${agent.name} · latih, uji, dan sempurnakan bersama tim sales` : "Latih, uji, dan sempurnakan agent AI bersama tim sales"}
        actions={live ? (
          <span style={{ display: "flex", alignItems: "center", gap: 8, ...card, borderRadius: 12, padding: "9px 14px", fontSize: 13, fontWeight: 700 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--green)" }} />Versi {live.versionNumber} · Live
          </span>
        ) : null}
      />
      <PageBody>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {err && <div role="alert" style={{ ...card, padding: 14, color: "var(--red)", fontSize: 13.5 }}>{err}</div>}
          <Widgets summary={summary} biaya={meta ? { terpakai: meta.biayaBulanIni || 0, batas: meta.batasBiaya } : null} />
          <StudioTabs tab={aktif} onTab={gantiTab} menunggu={summary?.menungguTinjauan || 0} bisaTinjau={bisaTinjau} />
          {aktif === "playground" && <Playground meta={meta} onChanged={muatMeta} />}
          {aktif === "tinjauan" && <Tinjauan onChanged={muatMeta} />}
          {aktif === "test-case" && <TestCases />}
        </div>
      </PageBody>
    </PageContainer>
  );
}
