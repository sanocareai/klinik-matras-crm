import React, { useEffect, useMemo, useState } from "react";
import { Sparkles, Users, Wallet, ThumbsUp, Loader2, Check, MessageSquareQuote } from "lucide-react";
import { api } from "@/api.js";
import { KartuWidget, Ubin } from "@/components/apple/Apple.jsx";

// ─── AI STUDIO — COPILOT (MVP 2, Owner/Admin) ───────────────────────────────
// Pantau pemakaian "Saran AI" di Inbox, atur pilot Tahap B, dan kurasi contoh gaya
// (gold standard) yang dipakai agent. Lihat docs/AI-STUDIO-MVP2-COPILOT.md §8.

const LABEL_NASIB = { SHOWN: "Belum diputuskan", USED_AS_IS: "Dipakai apa adanya", USED_EDITED: "Dipakai + diedit", IGNORED: "Diabaikan" };
const LABEL_ABAIKAN = { SALAH_INFO: "Salah info", TERLALU_PANJANG: "Terlalu panjang", TIDAK_NATURAL: "Tidak natural", SALAH_TAHAP: "Salah tahap", LAINNYA: "Lainnya" };
const usd = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 4)}`;

function Ringkasan() {
  const [hari, setHari] = useState(14);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null);
    api.studioCopilotStats(hari).then(setData).catch((e) => setErr(e.message));
  }, [hari]);
  if (err) return <div role="alert" style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>;
  if (!data) return <Loader2 className="animate-spin" />;
  const t = data.total;
  return (
    <div className="as-daftar">
      <div role="group" aria-label="Periode" className="as-segmen" style={{ alignSelf: "flex-start" }}>
        {[7, 14, 30].map((h) => <button key={h} type="button" aria-pressed={hari === h} onClick={() => setHari(h)}>{h} hari</button>)}
      </div>
      <section aria-label="Ringkasan Copilot" className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <KartuWidget nada="ungu" Glif={Sparkles} judul="Saran dibuat" className="ap-w-ringkas" info="Berapa kali sales menekan Saran AI di Inbox dalam periode ini.">
          <div className="ap-w-angka">{t.total}</div>
          <p className="ap-w-label">{t.SHOWN ? `${t.SHOWN} belum diputuskan` : `${hari} hari terakhir`}</p>
        </KartuWidget>
        <KartuWidget nada="hijau" Glif={ThumbsUp} judul="Dipakai" className="ap-w-ringkas" info="Persentase draft yang dikirim (apa adanya atau diedit) dari draft yang sudah diputuskan. Target pilot ≥ 50%.">
          <div className="ap-w-angka">{t.persenDipakai != null ? `${t.persenDipakai}%` : "—"}</div>
          <p className="ap-w-label">{t.USED_AS_IS} apa adanya · {t.USED_EDITED} diedit</p>
        </KartuWidget>
        <KartuWidget nada="jingga" Glif={MessageSquareQuote} judul="Diabaikan" className="ap-w-ringkas" info="Draft yang tidak dipakai sales. Alasannya terlihat di daftar di bawah.">
          <div className="ap-w-angka">{t.IGNORED}</div>
          <p className="ap-w-label">{hari} hari terakhir</p>
        </KartuWidget>
        <KartuWidget nada="biru" Glif={Wallet} judul="Biaya" className="ap-w-ringkas" info="Biaya model untuk Copilot. Plafon harian berlaku untuk semua sales bersama.">
          <div className="ap-w-angka">{usd(t.costUsd)}</div>
          <p className="ap-w-label">hari ini {usd(data.biayaHariIni)} / {usd(data.plafonHarian)}</p>
        </KartuWidget>
      </section>

      {data.perSales.length > 0 && (
        <section className="ap-panel">
          <h2 className="ap-judul-kecil"><Ubin nada="ungu" ukuran={30}><Users size={16} strokeWidth={1.9} /></Ubin> Per sales</h2>
          {data.perSales.map((s) => (
            <div key={s.salesUserId} className="as-baris">
              <span>{s.nama}</span>
              <span className="as-petunjuk">{s.total} saran · {s.persenDipakai != null ? `${s.persenDipakai}% dipakai` : "belum diputuskan"} · {s.IGNORED} diabaikan · {usd(s.costUsd)}</span>
            </div>
          ))}
        </section>
      )}

      {data.terbaru.length === 0 && (
        <section className="ap-panel">
          <h2 className="ap-judul-kecil"><Ubin nada="ungu" ukuran={30}><Sparkles size={16} strokeWidth={1.9} /></Ubin> Belum ada saran</h2>
          <p className="as-petunjuk" style={{ margin: 0 }}>Draft muncul di sini setelah user pilot menekan Saran AI di Inbox (menu “+” di kolom ketik).</p>
        </section>
      )}
      {data.terbaru.map((d) => (
        <article key={d.id} className="ap-panel as-kartu">
          <div className="as-kartu-kepala">
            <span><b>{d.salesNama}</b> · {LABEL_NASIB[d.outcome]}{d.ignoreReason ? ` (${LABEL_ABAIKAN[d.ignoreReason] || d.ignoreReason})` : ""}</span>
            <span>{new Date(d.createdAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} · {usd(d.costUsd)}</span>
          </div>
          <div className="as-banding">
            <div className="as-kotak"><small>Draft AI</small>{(d.output?.bubbles || []).join("\n\n") || (d.output?.handover?.perlu ? `(diserahkan ke sales) ${d.output.handover.alasan || ""}` : "—")}</div>
            <div className={`as-kotak ${d.sentText ? "as-kotak-biru" : ""}`}><small>Yang dikirim sales</small>{d.sentText || "—"}</div>
          </div>
          {d.crmSaved && <div className="as-baris-chip">{Object.entries(d.crmSaved).map(([k, v]) => <span key={k} className="as-chip as-chip-tint">CRM {k}: {v}</span>)}</div>}
        </article>
      ))}
    </div>
  );
}

function Pilot() {
  const [data, setData] = useState(null);
  const [pilih, setPilih] = useState(new Set());
  const [status, setStatus] = useState("");
  useEffect(() => {
    api.studioCopilotUsers().then((r) => { setData(r); setPilih(new Set(r.copilotUsers)); }).catch((e) => setStatus(e.message));
  }, []);
  if (!data) return status ? <div role="alert" style={{ color: "var(--red)" }}>{status}</div> : <Loader2 className="animate-spin" />;
  const simpan = async () => {
    setStatus("…");
    try {
      const r = await api.studioCopilotSetUsers([...pilih]);
      setPilih(new Set(r.copilotUsers));
      setStatus("Tersimpan");
    } catch (e) {
      setStatus(e.message);
    }
  };
  const nonAdmin = data.users.filter((u) => !["ADMIN", "OWNER"].includes(u.role));
  return (
    <section className="ap-panel as-kartu">
      <h2 className="ap-judul-kecil" style={{ margin: 0 }}><Ubin nada="ungu" ukuran={30}><Users size={16} strokeWidth={1.9} /></Ubin> Pilot Tahap B</h2>
      <p className="as-petunjuk" style={{ margin: 0 }}>Akun ADMIN/OWNER selalu bisa memakai Copilot. Centang sales yang ikut pilot; sisanya tetap memakai Saran AI lama.</p>
      <div className="as-baris-chip">
        {nonAdmin.map((u) => (
          <label key={u.id} className="as-chip" style={{ background: pilih.has(u.id) ? "var(--ap-biru-tint)" : undefined }}>
            <input type="checkbox" checked={pilih.has(u.id)} onChange={(e) => setPilih((p) => { const n = new Set(p); e.target.checked ? n.add(u.id) : n.delete(u.id); return n; })} />
            {u.name} <span className="as-petunjuk" style={{ fontSize: 12 }}>{u.role}</span>
          </label>
        ))}
      </div>
      <div className="as-aksi">
        {status && <span className="as-petunjuk">{status === "Tersimpan" ? <><Check size={14} /> Tersimpan</> : status}</span>}
        <button type="button" className="ap-tombol ap-tombol-utama" onClick={simpan}>Simpan daftar pilot ({pilih.size})</button>
      </div>
    </section>
  );
}

function ContohGaya() {
  const [data, setData] = useState(null);
  const [pilih, setPilih] = useState(new Set());
  const [status, setStatus] = useState("");
  useEffect(() => {
    api.studioCopilotContohGaya().then((r) => { setData(r); setPilih(new Set(r.terpilih)); }).catch((e) => setStatus(e.message));
  }, []);
  const perKategori = useMemo(() => {
    const m = {};
    for (const k of data?.kandidat || []) (m[k.category] ||= []).push(k);
    return Object.entries(m);
  }, [data]);
  if (!data) return status ? <div role="alert" style={{ color: "var(--red)" }}>{status}</div> : <Loader2 className="animate-spin" />;
  const simpan = async () => {
    setStatus("…");
    try {
      const r = await api.studioCopilotSetContohGaya([...pilih]);
      setPilih(new Set(r.terpilih));
      setStatus("Tersimpan");
    } catch (e) {
      setStatus(e.message);
    }
  };
  return (
    <div className="as-daftar">
      <section className="ap-panel as-kartu">
        <h2 className="ap-judul-kecil" style={{ margin: 0 }}><Ubin nada="hijau" ukuran={30}><MessageSquareQuote size={16} strokeWidth={1.9} /></Ubin> Contoh gaya terkurasi</h2>
        <p className="as-petunjuk" style={{ margin: 0 }}>
          Kutipan terbaik sales (sudah disamarkan) yang dipakai AI untuk meniru nada bicara — bukan sebagai sumber fakta atau harga.
          Pilih 6–10 yang paling mewakili, maksimal 40. Kosong = AI berjalan tanpa contoh.
        </p>
        <div className="as-aksi">
          {status && <span className="as-petunjuk">{status === "Tersimpan" ? <><Check size={14} /> Tersimpan</> : status}</span>}
          <button type="button" className="ap-tombol ap-tombol-utama" onClick={simpan} disabled={pilih.size > 40}>Simpan ({pilih.size} dipilih)</button>
        </div>
      </section>
      {perKategori.length === 0 && <p className="as-petunjuk">Belum ada kandidat gold standard di database.</p>}
      {perKategori.map(([kat, items]) => (
        <section key={kat} className="ap-panel as-kartu">
          <h3 className="ap-judul-kecil" style={{ margin: 0 }}>{kat}</h3>
          {items.map((k) => (
            <label key={k.id} className="as-cek" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={pilih.has(k.id)} onChange={(e) => setPilih((p) => { const n = new Set(p); e.target.checked ? n.add(k.id) : n.delete(k.id); return n; })} />
              <span>“{k.quote}” <span className="as-petunjuk" style={{ fontSize: 12 }}>— {k.salesName} · skor {k.relatedScore}</span></span>
            </label>
          ))}
        </section>
      ))}
    </div>
  );
}

export default function CopilotStudio() {
  const [bagian, setBagian] = useState("ringkasan");
  return (
    <div className="as-daftar">
      <div role="group" aria-label="Bagian Copilot" className="as-segmen" style={{ alignSelf: "flex-start" }}>
        {[["ringkasan", "Ringkasan"], ["pilot", "Pilot"], ["contoh", "Contoh gaya"]].map(([k, l]) => (
          <button key={k} type="button" aria-pressed={bagian === k} onClick={() => setBagian(k)}>{l}</button>
        ))}
      </div>
      {bagian === "ringkasan" && <Ringkasan />}
      {bagian === "pilot" && <Pilot />}
      {bagian === "contoh" && <ContohGaya />}
    </div>
  );
}
