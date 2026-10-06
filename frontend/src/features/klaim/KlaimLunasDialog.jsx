import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, FileText, Loader2, X, AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import {
  METODE_KLAIM, STATUS_KLAIM_LABEL, STATUS_BISA_DIEDIT, MAKS_BUKTI, TIPE_BUKTI_DITERIMA,
  bisaDiajukan, alasanNonaktif, cekBerkas, formDariKlaim, buktiDariKlaim, hariIniWIB,
  JENIS_BAYAR, nominalOtomatis, jenisDariNominal, dampakNominal,
  labelVerifikasi, FIELD_PEMBATAL_VERIFIKASI,
} from "./klaimLunasLogic.js";

// KLAIM LUNAS SALES (web). Sales TIDAK lagi menandai order "Lunas" sendiri: di sini Sales mengajukan klaim berisi tanggal, nominal, metode, rekening,
// catatan, dan minimal satu Bukti Pembayaran. Mengajukan klaim TIDAK mengubah status pembayaran — status baru berubah setelah Finance memverifikasi.
// Tombol "Ajukan Klaim Lunas" nonaktif sampai isian lengkap DAN semua bukti sudah dikonfirmasi tersimpan oleh server; server tetap menolak pengajuan
// yang tidak lengkap walau tombol ini dilewati (backend/src/services/finance/klaimLunas.js).

const inputCls = "h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60";
const labelCls = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink3";

function gambarDariEvent(e) {
  const dt = e.clipboardData || e.dataTransfer;
  if (!dt) return [];
  const hasil = [];
  for (const item of dt.items || []) {
    if (item.kind === "file" && /^image\//.test(item.type)) { const f = item.getAsFile(); if (f) hasil.push(f); }
  }
  if (hasil.length === 0) for (const file of dt.files || []) if (/^(image\/|application\/pdf)/.test(file.type)) hasil.push(file);
  return hasil;
}

// `resiGroupId` (opsional) = klaim level RESI: satu klaim untuk seluruh Resi (order = anchor untuk judul). Alokasi ke child dihitung SERVER saat Finance memverifikasi.
export default function KlaimLunasDialog({ open, order, resiGroupId = null, onClose, onChanged }) {
  const [info, setInfo] = useState(null);
  const [klaim, setKlaim] = useState(null); // klaim aktif milik pengguna (atau null = belum ada)
  const [form, setForm] = useState(() => formDariKlaim(null, { hariIni: hariIniWIB() }));
  const [bukti, setBukti] = useState([]);
  const [rekening, setRekening] = useState([]);
  const [memuat, setMemuat] = useState(true);
  const [mengirim, setMengirim] = useState(false);
  const [galat, setGalat] = useState("");
  const [sorot, setSorot] = useState(false);
  const [sudahVerifikasi, setSudahVerifikasi] = useState(false); // konfirmasi Sales: pembayaran sudah dicocokkan (lihat klaimLunasLogic.js)
  const idKlaim = useRef(null);
  const membuatDraft = useRef(null); // janji pembuatan draft yang sedang berjalan — unggahan paralel menunggu yang sama (tidak membuat dua draft)
  idKlaim.current = klaim?.id || null;

  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try {
      const d = resiGroupId ? await api.getKlaimLunasResi(resiGroupId) : await api.getKlaimLunasOrder(order.id);
      setInfo(d);
      // Klaim yang dikerjakan: yang aktif (draft / menunggu / diminta bukti); kalau tidak ada, klaim terakhir yang DITOLAK (diperbaiki lalu diajukan ulang).
      const sumber = (d.klaimAktifId && d.klaim.find((k) => k.id === d.klaimAktifId)) || d.klaim.find((k) => k.status === "REJECTED") || null;
      setKlaim(sumber);
      setForm(formDariKlaim(sumber, { sisa: d.sisa, dibayar: d.dibayar, dpTarget: resiGroupId ? null : (order?.dpTarget ?? null), hariIni: hariIniWIB() }));
      setBukti(buktiDariKlaim(sumber));
    } catch (e) {
      setGalat(e.message);
    } finally {
      setMemuat(false);
    }
  }, [order.id, resiGroupId]);

  useEffect(() => { if (open) { idKlaim.current = null; membuatDraft.current = null; muat(); } }, [open, muat]);

  // Rekening tujuan mengikuti metode (Tunai → hanya Sano KEM). Sama dengan alur catat pembayaran Sales lain.
  useEffect(() => {
    if (!open) return undefined;
    let batal = false;
    api.getPaymentAccounts(form.method).then((l) => {
      if (batal) return;
      setRekening(l);
      setForm((f) => (l.some((a) => a.id === f.cashAccountId) ? f : { ...f, cashAccountId: l.length === 1 ? l[0].id : "" }));
    }).catch(() => { if (!batal) setRekening([]); });
    return () => { batal = true; };
  }, [open, form.method]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  // Konfirmasi hanya berlaku untuk angka yang SAAT ITU tampil — mengubah nominal/tanggal/metode/rekening membatalkannya.
  const kunciVerifikasi = FIELD_PEMBATAL_VERIFIKASI.map((k) => String(form[k] ?? "")).join("|");
  useEffect(() => { setSudahVerifikasi(false); }, [kunciVerifikasi, klaim?.id]);
  const bisaDiedit = !klaim || STATUS_BISA_DIEDIT.includes(klaim.status);
  const menunggu = klaim?.status === "SUBMITTED";

  const bodyForm = () => ({
    paymentDate: form.paymentDate || null,
    amount: form.amount === "" ? null : Number(form.amount),
    method: form.method || null,
    cashAccountId: form.cashAccountId || null,
    note: form.note,
  });

  /** Pastikan ada draft di server (dibuat sekali, walau unggahan paralel). */
  async function pastikanDraft() {
    if (idKlaim.current) return idKlaim.current;
    if (!membuatDraft.current) {
      membuatDraft.current = (resiGroupId ? api.buatDraftKlaimLunasResi(resiGroupId, bodyForm()) : api.buatDraftKlaimLunas(order.id, bodyForm()))
        .then((r) => { setKlaim(r.klaim); idKlaim.current = r.klaim.id; return r.klaim.id; })
        .finally(() => { membuatDraft.current = null; });
    }
    return membuatDraft.current;
  }

  /** Kirim satu berkas ke server. "tersimpan" HANYA setelah server mengonfirmasi (respons 2xx berisi baris bukti); gagal → bisa dicoba lagi. */
  async function kirimItem(item) {
    setBukti((b) => b.map((x) => (x.key === item.key ? { ...x, status: "mengunggah", galat: undefined } : x)));
    try {
      const id = await pastikanDraft();
      const fd = new FormData();
      fd.append("berkas", item.file, item.file.name || "bukti");
      const r = await api.unggahBuktiKlaimLunas(id, fd);
      setBukti((b) => b.map((x) => (x.key === item.key ? { key: r.bukti.id, id: r.bukti.id, nama: r.bukti.nama, mime: r.bukti.mime, url: r.bukti.url, status: "tersimpan" } : x)));
      if (r.duplikat) setGalat("Bukti yang sama sudah terlampir — tidak ditambahkan dua kali.");
    } catch (e) {
      setBukti((b) => b.map((x) => (x.key === item.key ? { ...x, status: "gagal", galat: e.message } : x)));
      setGalat(`Unggahan ${item.nama} gagal: ${e.message}`);
    }
  }

  async function unggah(files) {
    setGalat("");
    const sisa = MAKS_BUKTI - bukti.length;
    if (sisa <= 0) { setGalat(`Maksimal ${MAKS_BUKTI} Bukti Pembayaran.`); return; }
    for (const file of files.slice(0, sisa)) {
      const salah = cekBerkas(file);
      if (salah) { setGalat(salah); continue; }
      const item = { key: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, nama: file.name || "bukti", mime: file.type, file, status: "mengunggah" };
      setBukti((b) => [...b, item]);
      await kirimItem(item);
    }
  }

  // Tempel (Ctrl+V) gambar dari clipboard — hanya saat dialog terbuka dan bisa diedit.
  useEffect(() => {
    if (!open || !bisaDiedit) return undefined;
    function saatTempel(e) {
      const files = gambarDariEvent(e);
      if (!files.length) return;
      e.preventDefault();
      unggah(files);
    }
    document.addEventListener("paste", saatTempel);
    return () => document.removeEventListener("paste", saatTempel);
  });

  async function hapus(b) {
    if (b.status === "gagal") { setBukti((l) => l.filter((x) => x.key !== b.key)); return; }
    try {
      await api.hapusBuktiKlaimLunas(idKlaim.current, b.id);
      setBukti((l) => l.filter((x) => x.key !== b.key));
    } catch (e) { setGalat(e.message); }
  }

  async function simpanDraft() {
    setMengirim(true); setGalat("");
    try {
      if (idKlaim.current) { const r = await api.ubahKlaimLunas(idKlaim.current, bodyForm()); setKlaim(r.klaim); }
      else await pastikanDraft();
      onChanged?.();
    } catch (e) { setGalat(e.message); } finally { setMengirim(false); }
  }

  async function ajukan() {
    if (!bisaDiajukan(form, bukti, { mengirim, sudahVerifikasi })) return;
    setMengirim(true); setGalat("");
    try {
      const id = await pastikanDraft();
      await api.ubahKlaimLunas(id, bodyForm());
      const r = await api.ajukanKlaimLunas(id);
      setKlaim(r.klaim);
      onChanged?.();
      onClose();
    } catch (e) { setGalat(e.message); } finally { setMengirim(false); }
  }

  async function tarik() {
    if (!window.confirm("Tarik klaim ini? Anda bisa mengajukan klaim baru setelahnya.")) return;
    setMengirim(true); setGalat("");
    try { await api.tarikKlaimLunas(klaim.id); onChanged?.(); onClose(); } catch (e) { setGalat(e.message); } finally { setMengirim(false); }
  }

  const sisaTagihan = info?.sisa ?? null;
  const aktifTombol = bisaDiedit && bisaDiajukan(form, bukti, { mengirim, sisa: sisaTagihan, sudahVerifikasi });
  const bantu = bisaDiedit ? alasanNonaktif(form, bukti, { mengirim, sisa: sisaTagihan, sudahVerifikasi }) : null;
  const dampak = dampakNominal(form.amount, { sisa: sisaTagihan ?? 0 });
  // Memilih jenis mengisi nominal otomatis (Pelunasan = sisa; DP = kekurangan DP disepakati bila ada); mengetik nominal menyesuaikan jenis.
  const pilihJenis = (j) => setForm((f) => ({ ...f, jenis: j, amount: nominalOtomatis(j, { sisa: info?.sisa ?? 0, dibayar: info?.dibayar ?? 0, dpTarget: resiGroupId ? null : (order?.dpTarget ?? null) }) }));
  const ubahNominal = (v) => setForm((f) => ({ ...f, amount: v, jenis: v === "" ? f.jenis : jenisDariNominal(v, { sisa: info?.sisa ?? 0 }) }));
  const tombolAjukan = form.jenis === "DP" ? "Ajukan Pembayaran DP" : "Ajukan Klaim Lunas";
  const adaUnggahan = bukti.some((b) => b.status === "mengunggah");

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!v && !mengirim) onClose(); }}
      title={resiGroupId ? "Ajukan Klaim Lunas Resi" : "Ajukan Pembayaran (DP / Lunas)"}
      description={order.orderNumber ? `Order ${order.orderNumber}${order.customerName ? ` — ${order.customerName}` : ""}` : undefined}
      className="w-[520px] max-h-[92vh]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {/* Galat & alasan tombol nonaktif SELALU terlihat di footer (tidak tersembunyi di bawah lipatan layar kecil). */}
          {galat && !memuat && info && <p className="flex items-start gap-1.5 text-[12px] text-red" role="alert"><AlertCircle size={14} className="mt-0.5 shrink-0" /> {galat}</p>}
          {bantu && <p className="text-[11.5px] text-ink3" data-testid="alasan-nonaktif">Belum bisa diajukan: {bantu}</p>}
          {menunggu && <p className="flex items-center gap-1.5 text-[12px] text-green"><CheckCircle2 size={14} /> Klaim sudah diajukan dan menunggu verifikasi Finance.</p>}
          <div className="flex justify-end gap-2">
            {menunggu ? (
              <>
                <Button variant="neutral" onClick={onClose}>Tutup</Button>
                <Button variant="neutral" disabled={mengirim} onClick={tarik}>Tarik Klaim</Button>
              </>
            ) : (
              <>
                <Button variant="neutral" onClick={onClose} disabled={mengirim}>Batal</Button>
                {bisaDiedit && <Button variant="secondary" disabled={mengirim || adaUnggahan || memuat || !info?.bolehDiklaim && !klaim} onClick={simpanDraft}>Simpan Draft</Button>}
                {bisaDiedit && <Button disabled={!aktifTombol} onClick={ajukan} data-testid="tombol-ajukan-klaim">{mengirim ? <Loader2 size={14} className="animate-spin" /> : tombolAjukan}</Button>}
              </>
            )}
          </div>
        </div>
      )}
    >
      {memuat ? (
        <p className="py-6 text-center text-[13px] text-ink3">Memuat…</p>
      ) : !info ? (
        <p className="text-[13px] text-red">{galat || "Gagal memuat"}</p>
      ) : !klaim && !info.bolehDiklaim ? (
        <p className="flex items-start gap-2 rounded-xl bg-inset px-3 py-3 text-[13px] text-ink2"><AlertCircle size={16} className="mt-0.5 shrink-0" /> {info.alasanTidakBisa || "Order ini tidak bisa diklaim."}</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <p className="rounded-xl bg-accentbg px-3 py-2.5 text-[12px] leading-relaxed text-accent">
            Mengajukan klaim <strong>tidak mengubah status pembayaran</strong> {resiGroupId ? "order dalam Resi ini" : "order ini"}. Status berubah (DP atau Lunas, sesuai nominal) setelah Finance memeriksa bukti dan uangnya.
            Sisa tagihan order: <strong>{formatRupiah(info.sisa)}</strong>.
          </p>

          {klaim && !(klaim.status === "DRAFT" && !klaim.reviewReason) && (
            <div className={cn("rounded-xl px-3 py-2.5 text-[12px]", klaim.status === "SUBMITTED" ? "bg-greenbg text-green" : "bg-orangebg text-orange")}>
              <p className="font-semibold">{STATUS_KLAIM_LABEL[klaim.status] || klaim.status}</p>
              {klaim.reviewReason && <p className="mt-0.5">Alasan Finance: {klaim.reviewReason}</p>}
            </div>
          )}

          {info.buktiBelumLengkap && !klaim && (
            <p className="rounded-xl bg-orangebg px-3 py-2.5 text-[12px] text-orange">
              Order ini sudah ditandai Lunas sebelumnya, tetapi <strong>bukti belum lengkap</strong> (belum ada pembayaran tercatat). Ajukan klaim berbukti agar Finance bisa memverifikasinya.
            </p>
          )}

          <div>
            <span className={labelCls}>Bukti Pembayaran</span>
            <div
              onDragOver={(e) => { if (bisaDiedit) { e.preventDefault(); setSorot(true); } }}
              onDragLeave={() => setSorot(false)}
              onDrop={(e) => { e.preventDefault(); setSorot(false); if (bisaDiedit) unggah(gambarDariEvent(e)); }}
              className={cn("rounded-lg border border-dashed p-2.5 transition-colors", sorot ? "border-accent bg-accentbg" : "border-line")}
            >
              <div className="flex flex-wrap items-center gap-2">
                {bukti.map((b) => (
                  <div key={b.key} className="relative" data-testid={`bukti-${b.status}`}>
                    <BuktiKecil b={b} onRetry={() => kirimItem(b)} />
                    {bisaDiedit && (
                      <button type="button" onClick={() => hapus(b)} aria-label={`Lepas ${b.nama}`} title="Lepas bukti ini"
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-surface text-ink3 shadow ring-1 ring-line hover:text-red">
                        <X size={11} />
                      </button>
                    )}
                  </div>
                ))}
                {bisaDiedit && (
                  <label className={cn("inline-flex h-12 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink2 hover:border-accent hover:text-accent", bukti.length >= MAKS_BUKTI && "pointer-events-none opacity-60")}>
                    <Camera size={14} />
                    {bukti.length ? "Tambah bukti" : "Foto / unggah bukti"}
                    <input type="file" accept={TIPE_BUKTI_DITERIMA} multiple className="hidden" onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) unggah(f); }} />
                  </label>
                )}
              </div>
              {bisaDiedit && <p className="mt-1.5 text-[11px] text-ink3">Foto transfer / struk QRIS / foto tunai, atau PDF. Bisa lebih dari satu; tempel dengan Ctrl+V. Maks. 8 MB per berkas.</p>}
            </div>
          </div>

          <div>
            <span className={labelCls}>Jenis pembayaran</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Jenis pembayaran" data-testid="jenis-bayar">
              {JENIS_BAYAR.map((j) => (
                <button
                  key={j.value} type="button" role="radio" aria-checked={form.jenis === j.value} disabled={!bisaDiedit} onClick={() => pilihJenis(j.value)}
                  className={cn("flex h-10 items-center justify-center rounded-lg border-2 text-center text-[12.5px] font-medium", form.jenis === j.value ? "border-accent bg-accentbg text-accent" : "border-transparent bg-inset text-ink2")}
                >{j.label}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="klaim-tanggal">Tanggal pembayaran</label>
              <DatePicker block allowFuture={false} placeholder="Pilih tanggal" clearLabel="Kosongkan" value={form.paymentDate} onChange={(v) => set("paymentDate", v)} disabled={!bisaDiedit} />
            </div>
            <div>
              <label className={labelCls} htmlFor="klaim-nominal">Nominal yang diklaim (Rp)</label>
              <input id="klaim-nominal" type="number" inputMode="numeric" min="1" className={inputCls} value={form.amount} onChange={(e) => ubahNominal(e.target.value)} disabled={!bisaDiedit} />
              {Number(form.amount) > 0 && <p className="mt-1 text-[11px] text-ink3" data-testid="nominal-terformat">{formatRupiah(Number(form.amount))}</p>}
              {dampak && <p className={cn("mt-1 text-[11.5px]", dampak.tingkat === "galat" ? "text-red" : "text-accent")} data-testid="dampak-nominal">{dampak.teks}</p>}
              {form.jenis === "DP" && form.amount === "" && <p className="mt-1 text-[11.5px] text-ink3">Isi nominal DP yang dibayar customer.</p>}
            </div>
          </div>

          <div>
            <span className={labelCls}>Metode pembayaran</span>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Metode pembayaran">
              {METODE_KLAIM.map((m) => (
                <button
                  key={m.value} type="button" role="radio" aria-checked={form.method === m.value} disabled={!bisaDiedit}
                  onClick={() => set("method", m.value)}
                  className={cn("flex h-10 items-center justify-center rounded-lg border-2 text-center text-[12.5px] font-medium", form.method === m.value ? "border-accent bg-accentbg text-accent" : "border-line text-ink2", !bisaDiedit && "opacity-60")}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="klaim-rekening">Rekening tujuan{form.method === "TRANSFER" ? "" : " (jika ada)"}</label>
            <select id="klaim-rekening" className={inputCls} value={form.cashAccountId} onChange={(e) => set("cashAccountId", e.target.value)} disabled={!bisaDiedit}>
              <option value="">{form.method === "TRANSFER" ? "Pilih rekening tujuan…" : "Tidak dipilih"}</option>
              {rekening.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            {form.method === "CASH" && <p className="mt-1 text-[11px] text-ink3">Pembayaran tunai hanya dicatat ke rekening Sano KEM.</p>}
          </div>

          <div>
            <label className={labelCls} htmlFor="klaim-catatan">Catatan pembayaran</label>
            <textarea id="klaim-catatan" rows={2} maxLength={1000} className={cn(inputCls, "h-auto py-2")} placeholder="Mis. transfer BCA a.n. pelanggan, dicek di mutasi pukul 10.15" value={form.note} onChange={(e) => set("note", e.target.value)} disabled={!bisaDiedit} />
          </div>

          {bisaDiedit && (
            <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors", sudahVerifikasi ? "border-accent bg-accentbg" : "border-line bg-surface")} data-testid="konfirmasi-verifikasi-label">
              <input
                type="checkbox" checked={sudahVerifikasi} onChange={(e) => setSudahVerifikasi(e.target.checked)} disabled={mengirim}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent,#2563eb)]" data-testid="konfirmasi-verifikasi"
              />
              <span className="text-[12.5px] leading-snug text-ink">
                <strong>{labelVerifikasi(form.method)}</strong>
                <span className="mt-0.5 block text-[11px] text-ink3">Ubah nominal, tanggal, metode, atau rekening akan mengosongkan centang ini.</span>
              </span>
            </label>
          )}

        </div>
      )}
    </Modal>
  );
}

function BuktiKecil({ b, onRetry }) {
  const pdf = b.mime === "application/pdf" || /\.pdf$/i.test(b.nama || "");
  const dasar = "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border";
  if (b.status === "mengunggah") return <span className={cn(dasar, "border-line bg-inset")} title={`Mengunggah ${b.nama}…`}><Loader2 size={16} className="animate-spin text-ink3" /></span>;
  if (b.status === "gagal") return <button type="button" onClick={onRetry} className={cn(dasar, "border-red bg-redbg text-red")} title={`${b.galat || "Unggahan gagal"} — ketuk untuk coba lagi`} aria-label={`Unggahan ${b.nama} gagal, coba lagi`}><RefreshCw size={16} /></button>;
  if (pdf) return <a href={b.url} target="_blank" rel="noreferrer" className={cn(dasar, "border-line bg-surface text-ink2")} title={b.nama}><FileText size={18} /></a>;
  return (
    <a href={b.url} target="_blank" rel="noreferrer" className={cn(dasar, "border-line")} title={b.nama}>
      <img src={b.url} alt={b.nama} className="h-full w-full object-cover" loading="lazy" />
    </a>
  );
}
