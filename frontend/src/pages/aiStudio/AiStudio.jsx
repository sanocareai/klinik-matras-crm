import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PenLine, FlaskConical, Sparkles, ThumbsUp, ThumbsDown, ArrowUp, Plus, Loader2, Check, AlertTriangle,
  LayoutGrid, Users, Wallet, ListChecks, Database, Route, Gauge, ShieldCheck, ClipboardCheck,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api.js";
import { rolesOf } from "@/lib/roles.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { KartuWidget, InfoI, Ubin } from "@/components/apple/Apple.jsx";
import "@/styles/sanss-ai-studio.css";

// ─── AI STUDIO — MVP 1 (November 2026) ──────────────────────────────────────
// Workspace TERPISAH dari Sales CRM (keputusan Owner). Tiga layar (dipilih dari sidebar):
//   • Playground  — sales berperan sebagai customer, AI (Mattress Consultant)
//                   menjawab; setiap balasan bisa dinilai & dikoreksi.
//   • Tinjauan    — Owner/Admin menerima/menolak koreksi → jadi test case.
//   • Test Case   — kumpulan kasus dari koreksi yang diterima (dipakai MVP 2).
// Belum ada balasan ke customer sungguhan.
// Gaya: bahasa visual Apple bersama (styles/sanss-apple.css: kartu widget, ubin squircle, panel, tombol capsule)
// seperti Delivery/All Teams/B2B/Main Hub, + pelengkap halaman di styles/sanss-ai-studio.css (kelas `as-`).

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
const JUDUL = { playground: "Playground", tinjauan: "Tinjauan Koreksi", "test-case": "Test Case" };

const namaModel = (m) => (m || "—").replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2").replace(/-/g, " ");

function fmtData(v) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? `${x} kg` : x)).join(" · ");
  return String(v);
}

// ── Widget ringkasan (kartu berwarna, sama dengan Delivery/Main Hub) ────────
function Widgets({ summary, biaya, bisaTinjau, onBuka }) {
  return (
    <section aria-label="Ringkasan" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 sm:gap-4">
      <KartuWidget nada="jingga" Glif={PenLine} judul="Koreksi" className="ap-w-ringkas" testid="as-k-koreksi"
        info="Balasan AI yang dinilai atau dikoreksi sales dalam 7 hari terakhir (termasuk yang dinilai bagus)." onBuka={bisaTinjau ? () => onBuka("tinjauan") : undefined}>
        <div className="ap-w-angka">{summary?.koreksiMingguIni ?? "—"}</div>
        <p className="ap-w-label">{summary?.menungguTinjauan ? `7 hari · ${summary.menungguTinjauan} menunggu` : "7 hari terakhir"}</p>
      </KartuWidget>
      <KartuWidget nada="biru" Glif={ThumbsUp} judul="Dinilai bagus" className="ap-w-ringkas" testid="as-k-bagus"
        info="Persentase balasan yang dinilai bagus dari semua penilaian 7 hari terakhir.">
        <div className="ap-w-angka">{summary?.persenBagus != null ? `${summary.persenBagus}%` : "—"}</div>
        <p className="ap-w-label">7 hari terakhir</p>
      </KartuWidget>
      <KartuWidget nada="hijau" Glif={FlaskConical} judul="Test case" className="ap-w-ringkas" testid="as-k-test"
        info="Koreksi yang diterima Owner/Admin dan disimpan sebagai kasus uji." onBuka={() => onBuka("test-case")}>
        <div className="ap-w-angka">{summary?.testCaseAktif ?? "—"}</div>
        <p className="ap-w-label">aktif</p>
      </KartuWidget>
      <KartuWidget nada="ungu" Glif={Users} judul="Pelatih" className="ap-w-ringkas" testid="as-k-pelatih"
        info="Orang yang menilai atau mengoreksi balasan AI dalam 7 hari terakhir.">
        <div className="ap-w-angka">{summary?.pelatihAktif ?? "—"}</div>
        <p className="ap-w-label">sales · 7 hari</p>
      </KartuWidget>
      <KartuWidget nada="indigo" Glif={Wallet} judul="Biaya AI" className="ap-w-ringkas col-span-2 sm:col-span-1" testid="as-k-biaya"
        info="Biaya pemakaian model AI bulan ini (USD). Pengiriman pesan ditolak bila batas tercapai.">
        <div className="ap-w-angka">{biaya ? `$${biaya.terpakai.toFixed(2)}` : "—"}</div>
        <p className="ap-w-label">{biaya ? `bulan ini · batas $${biaya.batas}` : "bulan ini"}</p>
      </KartuWidget>
    </section>
  );
}

// ── Form nilai/koreksi di bawah satu balasan AI ─────────────────────────────
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
    <div className="as-koreksi">
      <div className="as-koreksi-kepala">
        <span><Ubin nada="oranye" ukuran={28}><PenLine size={15} strokeWidth={1.9} /></Ubin>Nilai balasan ini</span>
        <span style={{ display: "flex", gap: 6 }}>
          <button type="button" className="as-jempol as-jempol-bagus" aria-label="Balasan bagus" disabled={saving} onClick={() => kirim("GOOD")}>
            <ThumbsUp size={17} aria-hidden="true" />
          </button>
          <button type="button" className="as-jempol" aria-label="Balasan kurang tepat" aria-pressed={rating === "BAD"} onClick={() => setRating("BAD")}>
            <ThumbsDown size={17} aria-hidden="true" />
          </button>
        </span>
      </div>
      {rating === "BAD" && (
        <>
          <label htmlFor={`ideal-${message.id}`} className="as-label">Balasan yang seharusnya</label>
          <textarea id={`ideal-${message.id}`} rows={4} className="as-isian" value={ideal} onChange={(e) => setIdeal(e.target.value)} />
          <div role="group" aria-label="Alasan koreksi" className="as-baris-chip">
            {ALASAN.map(([k, label]) => (
              <button key={k} type="button" className="as-chip" aria-pressed={alasan.includes(k)}
                onClick={() => setAlasan((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]))}>{label}</button>
            ))}
          </div>
          <label htmlFor={`note-${message.id}`} className="as-label">Catatan untuk tim (opsional)</label>
          <input id={`note-${message.id}`} className="as-isian" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. customer seperti ini biasanya…" />
          <div className="as-aksi">
            <button type="button" className="ap-tombol ap-tombol-abu" onClick={() => setRating(null)}>Batal</button>
            <button type="button" className="ap-tombol ap-tombol-utama" onClick={() => kirim("BAD")} disabled={saving || !ideal.trim()}>
              {saving && <Loader2 size={15} className="animate-spin" />} Kirim koreksi
            </button>
          </div>
        </>
      )}
      {err && <span role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</span>}
    </div>
  );
}

// ── Satu balasan AI (bubble + kartu katalog + status koreksi) ──────────────
function AgentTurn({ m, onSelect, selected, onFeedbackDone }) {
  const c = m.content || {};
  const sudah = (m.feedback || [])[0];
  return (
    <div className="as-giliran">
      {(c.bubbles || []).map((b, i) => (
        <button key={i} type="button" className="as-bubble as-bubble-ai" data-terpilih={selected} onClick={() => onSelect(m.id)} aria-label="Lihat alasan balasan ini">{b}</button>
      ))}
      {(c.kirimKatalog || []).map((k) => (
        <span key={k} className="as-katalog">
          <Ubin nada="biru" ukuran={34}><LayoutGrid size={18} strokeWidth={1.9} /></Ubin>
          <span><b>{k}</b><small>Kartu katalog</small></span>
        </span>
      ))}
      <span className="as-meta-giliran">
        AI · {c.tahap || "—"}{c.handover?.perlu ? " · serahkan ke sales" : ""}{sudah ? ` · ${sudah.rating === "GOOD" ? "dinilai bagus" : "sudah dikoreksi"}` : ""}
      </span>
      {!sudah && selected && <KoreksiForm message={m} onDone={onFeedbackDone} />}
    </div>
  );
}

// ── Panel "kenapa AI menjawab begini" ───────────────────────────────────────
function PanelAlasan({ m }) {
  if (!m) {
    return (
      <section className="ap-panel">
        <h2 className="ap-judul-kecil"><Ubin nada="indigo" ukuran={30}><Sparkles size={16} strokeWidth={1.9} /></Ubin> Alasan balasan</h2>
        <p className="as-petunjuk" style={{ margin: 0 }}>Ketuk balasan AI untuk melihat tahap, data terkumpul, dan hasil cek keras di sini.</p>
      </section>
    );
  }
  const c = m.content || {};
  const idx = TAHAP.indexOf(c.tahap);
  const data = c.dataTerkumpul || {};
  const terisi = LABEL_DATA.filter(([k]) => fmtData(data[k])).length;
  const checks = c.checks || [];
  const lulus = checks.filter((x) => x.lulus).length;
  const semua = lulus === checks.length;
  return (
    <>
      <section className="ap-panel" aria-label="Tahap percakapan">
        <div className="as-panel-judul"><h2 className="ap-judul-kecil"><Ubin nada="biru" ukuran={30}><Route size={16} strokeWidth={1.9} /></Ubin> Tahap percakapan</h2></div>
        <div className="as-tahap">
          {TAHAP.slice(0, 7).map((t, i) => (
            <span key={t} className={i === idx ? "as-kini" : i < idx ? "as-lewat" : undefined}>
              {i < idx && <Check size={12} strokeWidth={2.4} aria-hidden="true" />}{t[0] + t.slice(1).toLowerCase()}
            </span>
          ))}
          {c.tahap === "HANDOVER" && <span className="as-handover">Handover</span>}
        </div>
        {c.catatanInternal && <p className="as-catatan">{c.catatanInternal}</p>}
      </section>

      <section className="ap-panel" aria-label="Data terkumpul">
        <div className="as-panel-judul">
          <h2 className="ap-judul-kecil"><Ubin nada="teal" ukuran={30}><Database size={16} strokeWidth={1.9} /></Ubin> Data terkumpul</h2>
          <span className="as-pil-status">{terisi} dari {LABEL_DATA.length}</span>
        </div>
        {LABEL_DATA.map(([k, label]) => (
          <div key={k} className="as-baris">
            <span>{label}</span>
            <span className={fmtData(data[k]) ? undefined : "as-belum"}>{fmtData(data[k]) || "Belum"}</span>
          </div>
        ))}
      </section>

      {(c.rekomendasi?.utama || c.rekomendasi?.alternatif) && (
        <section className="ap-panel" aria-label="Arah rekomendasi">
          <div className="as-panel-judul"><h2 className="ap-judul-kecil"><Ubin nada="ungu" ukuran={30}><ListChecks size={16} strokeWidth={1.9} /></Ubin> Arah rekomendasi</h2></div>
          {c.rekomendasi.utama && <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500 }}>{c.rekomendasi.utama}</p>}
          {c.rekomendasi.alternatif && <p className="as-catatan">Alternatif: {c.rekomendasi.alternatif}</p>}
        </section>
      )}

      <section className="ap-panel" aria-label="Cek keras">
        <div className="as-panel-judul">
          <h2 className="ap-judul-kecil"><Ubin nada={semua ? "hijau" : "oranye"} ukuran={30}><ShieldCheck size={16} strokeWidth={1.9} /></Ubin> Cek keras</h2>
          <span className={`as-pil-status ${semua ? "as-ok" : "as-awas"}`}>{lulus}/{checks.length} lulus</span>
        </div>
        {checks.map((x) => (
          <div key={x.kode} className="as-cek">
            {x.lulus ? <Check size={16} className="as-ok" aria-label="Lulus" /> : <AlertTriangle size={16} className="as-awas" aria-label="Perlu dicek" />}
            <span>{x.pesan}</span>
          </div>
        ))}
      </section>

      <section className="ap-panel" aria-label="Pemakaian model">
        <div className="as-panel-judul"><h2 className="ap-judul-kecil"><Ubin nada="abu" ukuran={30}><Gauge size={16} strokeWidth={1.9} /></Ubin> Pemakaian</h2></div>
        <div className="as-meta">
          {[["Model", namaModel(m.model)], ["Token", (m.inputTokens + m.outputTokens + m.cacheReadTokens).toLocaleString("id-ID")], ["Biaya", `$${(m.costUsd || 0).toFixed(4)}`], ["Cache", m.cacheReadTokens ? `${Math.round((m.cacheReadTokens / (m.inputTokens + m.cacheReadTokens)) * 100)}%` : "0%"]].map(([l, v]) => (
            <span key={l}><small>{l}</small><b style={l === "Model" ? { textTransform: "capitalize" } : undefined}>{v}</b></span>
          ))}
        </div>
      </section>
    </>
  );
}

// ── PLAYGROUND ──────────────────────────────────────────────────────────────
function Playground({ meta, onChanged, sesiBaruRef }) {
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
  // Gulir HANYA ruang chat ke pesan terbaru (scrollIntoView ikut menggulung halaman sehingga judul & ringkasan hilang dari layar).
  useEffect(() => { const el = bawah.current; if (el) el.scrollTop = el.scrollHeight; }, [session?.id, session?.messages?.length, sending]);

  const baru = async (judul) => {
    setErr("");
    const r = await api.studioCreateSession({ title: judul || "Simulasi baru", model });
    await muatDaftar();
    setSession({ ...r.session, messages: [] });
    setSelectedId(null);
  };
  if (sesiBaruRef) sesiBaruRef.current = () => baru().catch((e) => setErr(e.message));

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
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-label="Simulasi chat" className="ap-panel as-chat">
        <div className="as-chat-kepala">
          <label htmlFor="sesi" className="sr-only">Sesi</label>
          <select id="sesi" value={session?.id || ""} onChange={(e) => e.target.value && buka(e.target.value)}>
            {!session && <option value="">Belum ada sesi</option>}
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.title} ({s._count?.messages || 0})</option>)}
          </select>
          <div role="group" aria-label="Model" className="as-segmen">
            {(meta?.models || ["claude-haiku-5-5", "claude-sonnet-5-5"]).filter((x) => !x.includes("opus")).map((x) => (
              <button key={x} type="button" aria-pressed={model === x} onClick={() => setModel(x)} style={{ textTransform: "capitalize" }}>{namaModel(x)}</button>
            ))}
          </div>
        </div>

        <div className="as-skenario as-baris-chip">
          <span className="as-skenario-label">Skenario cepat</span>
          {SKENARIO.map(([label, isi]) => (
            <button key={label} type="button" className="as-chip" onClick={() => setText(isi)}>{label}</button>
          ))}
        </div>

        <div className="as-pesan" ref={bawah}>
          {!session?.messages?.length && (
            <div className="as-kosong">
              <Ubin nada="biru" ukuran={52}><Sparkles size={28} strokeWidth={1.9} /></Ubin>
              Berperan sebagai customer: ketik pesan pertama atau pilih skenario cepat di atas.
            </div>
          )}
          {(session?.messages || []).map((m) =>
            m.role === "CUSTOMER" ? (
              <div key={m.id} className="as-bubble as-bubble-customer">{m.content?.text}</div>
            ) : (
              <AgentTurn key={m.id} m={m} selected={m.id === selectedId} onSelect={setSelectedId}
                onFeedbackDone={() => { buka(session.id); onChanged?.(); }} />
            )
          )}
          {sending && <span className="as-menyusun"><Loader2 size={14} className="animate-spin" /> AI sedang menyusun balasan…</span>}
        </div>

        <form className="as-tulis" onSubmit={(e) => { e.preventDefault(); kirim(); }}>
          <label htmlFor="pesan-customer" className="sr-only">Ketik sebagai customer</label>
          <input id="pesan-customer" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ketik sebagai customer…" maxLength={2000} />
          <button type="submit" className="as-kirim" aria-label="Kirim" disabled={sending || !text.trim()}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </form>
        {err && <div role="alert" className="as-galat">{err}</div>}
      </section>

      <aside aria-label="Penjelasan balasan AI" className="as-samping">
        <PanelAlasan m={terpilih} />
      </aside>
    </div>
  );
}

// ── TINJAUAN (Owner/Admin) ──────────────────────────────────────────────────
function Tinjauan({ onChanged, menunggu }) {
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
    <div className="as-daftar">
      <div role="group" aria-label="Status koreksi" className="as-segmen" style={{ alignSelf: "flex-start" }}>
        {[["NEW", "Menunggu"], ["ACCEPTED", "Diterima"], ["REJECTED", "Ditolak"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>
            {l}{k === "NEW" && menunggu > 0 && <span className="as-jumlah">{menunggu}</span>}
          </button>
        ))}
      </div>
      {err && <div role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
      {items === null && <Loader2 className="animate-spin" />}
      {items?.length === 0 && (
        <section className="ap-panel">
          <h2 className="ap-judul-kecil"><Ubin nada="ungu" ukuran={30}><ClipboardCheck size={16} strokeWidth={1.9} /></Ubin> Tidak ada koreksi di sini</h2>
          <p className="as-petunjuk" style={{ margin: 0 }}>Koreksi dari sales di Playground akan muncul di daftar Menunggu.</p>
        </section>
      )}
      {items?.map((f) => (
        <article key={f.id} className="ap-panel as-kartu">
          <div className="as-kartu-kepala">
            <span><b>{f.createdByName}</b> · {f.message?.session?.title}</span>
            <span>{new Date(f.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <div className="as-banding">
            <div className="as-kotak"><small>Balasan AI</small>{(f.message?.content?.bubbles || []).join("\n\n")}</div>
            <div className={`as-kotak ${f.rating === "GOOD" ? "as-kotak-hijau" : "as-kotak-biru"}`}>
              <small>{f.rating === "GOOD" ? "Dinilai bagus" : "Balasan yang seharusnya"}</small>{f.idealReply || (f.rating === "GOOD" ? "Sales menilai balasan ini sudah tepat — bisa dijadikan contoh balasan yang baik." : "—")}
            </div>
          </div>
          {(f.reasons?.length > 0 || f.note) && (
            <div className="as-baris-chip">
              {f.reasons.map((r) => <span key={r} className="as-chip as-chip-tint">{LABEL_ALASAN[r] || r}</span>)}
              {f.note && <span className="as-petunjuk">“{f.note}”</span>}
            </div>
          )}
          {f.status === "NEW" && (
            <div className="as-aksi">
              <button type="button" className="ap-tombol ap-tombol-abu" onClick={() => putuskan(f.id, "REJECT")}>Tolak</button>
              <button type="button" className="ap-tombol ap-tombol-utama" onClick={() => putuskan(f.id, "ACCEPT")}>{f.rating === "BAD" ? "Terima → jadi test case" : "Terima"}</button>
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
  if (!items.length) {
    return (
      <section className="ap-panel">
        <h2 className="ap-judul-kecil"><Ubin nada="hijau" ukuran={30}><FlaskConical size={16} strokeWidth={1.9} /></Ubin> Belum ada test case</h2>
        <p className="as-petunjuk" style={{ margin: 0 }}>Koreksi yang diterima di Tinjauan otomatis masuk ke sini.</p>
      </section>
    );
  }
  return (
    <div className="as-kisi-kasus">
      {items.map((t) => (
        <article key={t.id} className="ap-panel as-kartu">
          <h2 className="ap-judul-kecil" style={{ margin: 0 }}><Ubin nada="hijau" ukuran={30}><FlaskConical size={16} strokeWidth={1.9} /></Ubin> {t.title}</h2>
          <div className="as-riwayat">
            {(t.history || []).slice(-4).map((h, i) => (
              <span key={i}><b>{h.role === "customer" ? "Customer" : "AI"}:</b> {h.text}</span>
            ))}
          </div>
          <div className="as-kotak as-kotak-biru"><small>Balasan ideal</small>{t.idealReply}</div>
          {t.mustRules?.length > 0 && <div className="as-baris-chip">{t.mustRules.map((r) => <span key={r} className="as-chip as-chip-tint">{LABEL_ALASAN[r] || r}</span>)}</div>}
        </article>
      ))}
    </div>
  );
}

// ── HALAMAN ─────────────────────────────────────────────────────────────────
export default function AiStudio({ tab = "playground" }) {
  const navigate = useNavigate();
  // Tinjauan koreksi khusus ADMIN/OWNER (server menegakkan ulang) — SALES tidak melihat menunya.
  const bisaTinjau = useMemo(() => {
    try { return rolesOf(JSON.parse(localStorage.getItem("user") || "null")).some((r) => r === "ADMIN" || r === "OWNER"); } catch { return false; }
  }, []);
  const aktif = tab === "tinjauan" && !bisaTinjau ? "playground" : tab;
  const [meta, setMeta] = useState(null);
  const [summary, setSummary] = useState(null);
  const [err, setErr] = useState("");
  const sesiBaru = useRef(null);

  const muatMeta = useCallback(() => {
    api.studioAgents().then(setMeta).catch((e) => setErr(e.message));
    api.studioSummary().then(setSummary).catch(() => {});
  }, []);
  useEffect(muatMeta, [muatMeta]);

  // Navigasi antarlayar lewat sidebar; kartu widget juga membuka layar terkait (lewat router agar menu aktif ikut).
  const bukaLayar = (k) => navigate(k === "playground" ? "/ai-studio" : `/ai-studio/${k}`);
  const agent = meta?.agents?.[0];
  const live = agent?.versions?.find((v) => v.status === "LIVE");

  return (
    <PageContainer fluid className="as-halaman">
      <PageHeader
        title={JUDUL[aktif]}
        subtitle={`${agent?.name || "Mattress Consultant"} · latih, uji, dan sempurnakan bersama tim sales`}
        actions={(
          <>
            {live && <span className="ap-pil"><span className="ap-titik ap-titik-hijau" aria-hidden="true" />Versi {live.versionNumber} · Live</span>}
            <InfoI label="Tentang AI Studio">AI hanya menjawab di Playground ini — belum ada balasan ke customer sungguhan. Koreksi sales ditinjau Owner/Admin lalu menjadi test case.</InfoI>
            {aktif === "playground" && (
              <button type="button" className="ap-tombol ap-tombol-utama" onClick={() => sesiBaru.current?.()}><Plus size={15} /> Sesi baru</button>
            )}
          </>
        )}
      />
      <PageBody>
        {err && <div role="alert" className="ap-panel" style={{ color: "var(--red)", fontSize: 13.5 }}>{err}</div>}
        <Widgets summary={summary} biaya={meta ? { terpakai: meta.biayaBulanIni || 0, batas: meta.batasBiaya } : null} bisaTinjau={bisaTinjau} onBuka={bukaLayar} />
        {aktif === "playground" && <Playground meta={meta} onChanged={muatMeta} sesiBaruRef={sesiBaru} />}
        {aktif === "tinjauan" && <Tinjauan onChanged={muatMeta} menunggu={summary?.menungguTinjauan || 0} />}
        {aktif === "test-case" && <TestCases />}
      </PageBody>
    </PageContainer>
  );
}
