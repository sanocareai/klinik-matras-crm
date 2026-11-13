import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, RefreshCw, AlertTriangle, UserRound, Loader2, Check, Image as ImageIcon } from "lucide-react";
import { api } from "../../../../api.js";
import { LABEL_TAHAP, ALASAN_ABAIKAN, usulanCrm, gabungBubble, peringatan } from "./copilotLogic.js";
import "./copilotPanel.css";

// ─── COPILOT (AI Studio MVP 2) ───────────────────────────────────────────────
// Panel draft dari Mattress Consultant untuk user pilot. Panel ini TIDAK PERNAH
// mengirim pesan sendiri: "Pakai" mengisi kolom ketik, "Kirim semua" meminta
// Composer mengirim lewat jalur kirim Inbox yang sudah ada (useSendMessage).
// Lihat docs/AI-STUDIO-MVP2-COPILOT.md §3.
export default function CopilotPanel({ conversation, onPakai, onKirimSemua, onOpenProduct, onClose }) {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState("");
  const [draft, setDraft] = useState(null);
  const [bubbles, setBubbles] = useState([]);
  const [pilihCrm, setPilihCrm] = useState({});
  const [crmStatus, setCrmStatus] = useState(""); // "" | saving | saved | error
  const [modeAbaikan, setModeAbaikan] = useState(false);
  const [mengirim, setMengirim] = useState(false);
  const ref = useRef(null);

  const buat = useCallback(() => {
    setStatus("loading");
    setModeAbaikan(false);
    setCrmStatus("");
    api.studioCopilotDraft(conversation.id)
      .then((r) => {
        const out = r.draft.output || {};
        setDraft(r.draft);
        setBubbles(out.bubbles || []);
        setPilihCrm(Object.fromEntries(usulanCrm(out.dataTerkumpul, conversation.customer).map((u) => [u.kunci, true])));
        setStatus("ready");
      })
      .catch((err) => { setErrorMsg(err.message || "Gagal membuat saran AI"); setStatus("error"); });
  }, [conversation.id, conversation.customer]);

  useEffect(buat, [buat]);

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const out = draft?.output || {};
  const usulan = usulanCrm(out.dataTerkumpul, conversation.customer);
  const warn = peringatan(out.checks);
  const teksAsli = gabungBubble(out.bubbles || []);
  const adaBubble = bubbles.some((b) => b.trim());

  async function simpanCrm() {
    const data = Object.fromEntries(usulan.filter((u) => pilihCrm[u.kunci]).map((u) => [u.kunci, u.nilai]));
    if (!Object.keys(data).length) return;
    setCrmStatus("saving");
    try {
      await api.studioCopilotCrm(draft.id, data);
      setCrmStatus("saved");
    } catch (err) {
      setErrorMsg(err.message);
      setCrmStatus("error");
    }
  }

  async function abaikan(alasan) {
    try { await api.studioCopilotOutcome(draft.id, { outcome: "IGNORED", ignoreReason: alasan }); } catch { /* catatan nasib draft tidak boleh menghalangi sales */ }
    onClose();
  }

  async function kirimSemua() {
    setMengirim(true);
    try {
      await onKirimSemua(bubbles.map((b) => b.trim()).filter(Boolean), draft.id, teksAsli);
      onClose();
    } catch (err) {
      setErrorMsg(err.message || "Gagal mengirim");
      setMengirim(false);
    }
  }

  return (
    <div ref={ref} className="template-picker-popup copilot-panel" role="dialog" aria-label="Saran AI">
      <div className="template-picker-header">
        <span className="copilot-judul">
          <Sparkles size={14} /> Saran AI
          {status === "ready" && out.tahap && <span className="copilot-pil">{LABEL_TAHAP[out.tahap] || out.tahap}</span>}
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          {status !== "loading" && (
            <button type="button" onClick={buat} className="btn-icon" title="Buat saran baru" aria-label="Buat saran baru"><RefreshCw size={14} /></button>
          )}
          <button type="button" onClick={onClose} className="btn-icon" title="Tutup" aria-label="Tutup"><X size={14} /></button>
        </span>
      </div>

      <div className="copilot-isi">
        {status === "loading" && (
          <p className="copilot-muted"><Loader2 size={14} className="animate-spin" /> Membaca chat & menyusun saran…</p>
        )}
        {status === "error" && <p className="copilot-error">{errorMsg}</p>}

        {status === "ready" && (
          <>
            {out.handover?.perlu && (
              <div className="copilot-banner">
                <UserRound size={14} />
                <span><b>Sebaiknya kamu yang menjawab.</b> {out.handover.alasan || ""}</span>
              </div>
            )}
            {out.catatanInternal && <div className="copilot-catatan"><small>Catatan untuk kamu</small>{out.catatanInternal}</div>}
            {warn.length > 0 && (
              <ul className="copilot-warn">
                {warn.map((w) => <li key={w}><AlertTriangle size={12} /> {w}</li>)}
              </ul>
            )}

            {bubbles.length === 0 && <p className="copilot-muted">Tidak ada draft untuk pesan ini — jawab sendiri.</p>}
            {bubbles.map((b, i) => (
              <textarea
                key={i}
                className="copilot-bubble"
                value={b}
                rows={Math.min(6, Math.max(2, Math.ceil(b.length / 48)))}
                onChange={(e) => setBubbles((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))}
                aria-label={`Bubble ${i + 1}`}
              />
            ))}

            {out.kirimKatalog?.length > 0 && (
              <div className="copilot-katalog">
                <ImageIcon size={13} /> Saran kirim foto: {out.kirimKatalog.join(", ")}
                {onOpenProduct && <button type="button" className="copilot-link" onClick={onOpenProduct}>Buka katalog</button>}
              </div>
            )}

            {usulan.length > 0 && (
              <div className="copilot-crm">
                <small>Simpan ke CRM</small>
                {usulan.map((u) => (
                  <label key={u.kunci} className="copilot-chip">
                    <input type="checkbox" checked={!!pilihCrm[u.kunci]} disabled={crmStatus === "saved"}
                      onChange={(e) => setPilihCrm((p) => ({ ...p, [u.kunci]: e.target.checked }))} />
                    <span><b>{u.label}:</b> {u.nilai}</span>
                  </label>
                ))}
                <button type="button" className="copilot-tombol copilot-tombol-abu" onClick={simpanCrm}
                  disabled={crmStatus === "saving" || crmStatus === "saved" || !usulan.some((u) => pilihCrm[u.kunci])}>
                  {crmStatus === "saved" ? <><Check size={13} /> Tersimpan</> : crmStatus === "saving" ? "Menyimpan…" : "Simpan ke CRM"}
                </button>
                {crmStatus === "error" && <span className="copilot-error">{errorMsg}</span>}
              </div>
            )}

            {modeAbaikan ? (
              <div className="copilot-aksi">
                <span className="copilot-muted">Kenapa diabaikan?</span>
                {ALASAN_ABAIKAN.map(([k, l]) => (
                  <button key={k} type="button" className="copilot-tombol copilot-tombol-abu" onClick={() => abaikan(k)}>{l}</button>
                ))}
                <button type="button" className="copilot-tombol copilot-tombol-abu" onClick={() => abaikan(null)}>Lewati</button>
              </div>
            ) : (
              <div className="copilot-aksi">
                <button type="button" className="copilot-tombol copilot-tombol-abu" onClick={() => setModeAbaikan(true)}>Abaikan</button>
                {adaBubble && (
                  <>
                    <button type="button" className="copilot-tombol copilot-tombol-abu" disabled={mengirim}
                      onClick={() => { onPakai(gabungBubble(bubbles), draft.id, teksAsli); onClose(); }}>Pakai</button>
                    <button type="button" className="copilot-tombol copilot-tombol-utama" disabled={mengirim} onClick={kirimSemua}>
                      {mengirim ? "Mengirim…" : bubbles.filter((b) => b.trim()).length > 1 ? "Kirim semua bubble" : "Kirim"}
                    </button>
                  </>
                )}
              </div>
            )}
            <p className="copilot-kaki">AI bisa salah — baca dulu sebelum kirim. ${(draft?.costUsd || 0).toFixed(4)} · {((draft?.latencyMs || 0) / 1000).toFixed(1)} dtk</p>
          </>
        )}
      </div>
    </div>
  );
}
