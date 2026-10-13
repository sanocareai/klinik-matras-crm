import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileMinus, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { InputUang, Pilihan, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import {
  JENIS_NOTA, SUMBER_NOTA, KALIMAT_MANDIRI, KALIMAT_TERTAUT, KALIMAT_KONFIRMASI, TANPA_JURNAL, KALIMAT_BATAL,
  kesiapanNotaKredit, paramPratinjau, bodySimpanNota, barisDampak, hariIniWIB, labelStatusBayar, pesanGalatNota,
} from "@/features/finance/notaKreditLogic.js";

// NOTA KREDIT / KERINGANAN ORDER — dialog membuat & membatalkan. Semua angka dampak dihitung SERVER (pratinjau memakai jalur simpan yang sama lalu dibatalkan);
// layar hanya menampilkan. Idempotency-Key dipakai ulang selama isi sama, supaya klik ganda/retry tidak membuat dua nota.

const kunciBaru = (p) => (globalThis.crypto?.randomUUID ? `${p}-${globalThis.crypto.randomUUID()}` : `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function Uang({ v }) { return <span className="tabular-nums">{formatUang(Number(v) || 0)}</span>; }

function TabelDampak({ pratinjau, uji = "dampak-nota" }) {
  const baris = barisDampak(pratinjau);
  if (!baris.length) return null;
  const sel = (b, nilai) => (b.uang ? <Uang v={nilai} /> : b.tanggal ? (nilai ? tanggalPendek(nilai) : "—") : nilai);
  return (
    <div className="overflow-x-auto rounded-lg border border-line" data-testid={uji}>
      <table className="w-full min-w-[320px] text-[13px]">
        <thead>
          <tr className="bg-inset text-left text-[11.5px] uppercase tracking-wide text-ink3">
            <th className="px-2.5 py-1.5 font-semibold">Dampak</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Sebelum</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Sesudah</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((b) => (
            <tr key={b.kunci} className="border-t border-line">
              <td className="px-2.5 py-1.5 text-ink2">{b.label}</td>
              <td className="px-2.5 py-1.5 text-right text-ink" data-testid={`sebelum-${b.kunci}`}>{sel(b, b.sebelum)}</td>
              <td className="px-2.5 py-1.5 text-right font-semibold text-ink" data-testid={`sesudah-${b.kunci}`}>{sel(b, b.sesudah)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlokJurnal({ pratinjau, refundNomor }) {
  if (!pratinjau) return null;
  if (!pratinjau.jurnal) {
    return (
      <p className="m-0 rounded-lg bg-greenbg px-3 py-2 text-[12.5px] font-medium text-green" data-testid="tanpa-jurnal">
        {TANPA_JURNAL}{refundNomor ? ` (${refundNomor})` : ""}. Tidak ada jurnal baru; Kas/Bank, Piutang, dan Pendapatan tidak berubah.
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-line px-3 py-2 text-[12.5px]" data-testid="jurnal-nota">
      <p className="m-0 mb-1 font-semibold text-ink">Jurnal yang akan dibuat</p>
      <ul className="m-0 list-none space-y-0.5 p-0">
        {pratinjau.jurnal.baris.map((b) => (
          <li key={b.akun} className="flex justify-between gap-3"><span className="text-ink2">{b.akun}</span><span className="tabular-nums text-ink">{Number(b.debit) > 0 ? `Dr ${formatUang(Number(b.debit))}` : `Cr ${formatUang(Number(b.kredit))}`}</span></li>
        ))}
      </ul>
    </div>
  );
}

export function BuatNotaKreditDialog({ orderId, refundAwal = null, onClose, onSaved }) {
  const [info, setInfo] = useState({ memuat: true, galat: "", data: null });
  const [f, setF] = useState({ sumber: refundAwal ? "TERTAUT_REFUND" : "MANDIRI", jenis: "POTONGAN_HARGA", amount: "", alasan: "", refundId: refundAwal || "", date: hariIniWIB(), konfirmasi: false });
  const [pratinjau, setPratinjau] = useState({ memuat: false, galat: "", data: null });
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunciRef = useRef(null);
  const hitungKe = useRef(0);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v, ...(k !== "konfirmasi" && k !== "alasan" ? { konfirmasi: false } : {}) })); setGalat(""); };

  const muat = useCallback(async () => {
    setInfo({ memuat: true, galat: "", data: null });
    try {
      const data = await api.getNotaKreditOrder(orderId);
      setInfo({ memuat: false, galat: "", data });
      const awal = refundAwal && data.refundKandidat.find((k) => k.id === refundAwal);
      if (awal?.layak) setF((s) => ({ ...s, amount: s.amount || String(awal.potongan) }));
    } catch (e) { setInfo({ memuat: false, galat: e.message || "Gagal memuat data order", data: null }); }
  }, [orderId, refundAwal]);
  useEffect(() => { muat(); }, [muat]);

  const kandidat = info.data?.refundKandidat ?? [];
  const param = useMemo(() => paramPratinjau(f), [f.sumber, f.jenis, f.amount, f.refundId, f.date]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pratinjau server (debounce) — selalu terhadap data TERKINI; token revisi yang dipakai menyimpan berasal dari sini.
  useEffect(() => {
    if (!param || info.memuat || info.galat) { setPratinjau({ memuat: false, galat: "", data: null }); return undefined; }
    const nomorHitung = ++hitungKe.current;
    setPratinjau((s) => ({ memuat: true, galat: "", data: s.data }));
    const t = setTimeout(async () => {
      try {
        const data = await api.pratinjauNotaKredit(orderId, param);
        if (hitungKe.current === nomorHitung) setPratinjau({ memuat: false, galat: "", data });
      } catch (e) {
        if (hitungKe.current === nomorHitung) setPratinjau({ memuat: false, galat: pesanGalatNota(e), data: null });
      }
    }, 350);
    return () => clearTimeout(t);
  }, [orderId, param, info.memuat, info.galat]);

  const siap = kesiapanNotaKredit(f, { kandidat, pratinjau: pratinjau.data, memuatPratinjau: pratinjau.memuat, galatPratinjau: pratinjau.galat });
  const ringkasan = info.data?.ringkasan;
  const refundTerpilih = kandidat.find((k) => k.id === f.refundId);

  async function simpan() {
    setGalat(""); setSibuk(true);
    try {
      const body = bodySimpanNota(f, pratinjau.data.revisi);
      const tanda = JSON.stringify(body);
      if (kunciRef.current?.tanda !== tanda) kunciRef.current = { tanda, kunci: kunciBaru("nota-kredit") };
      await api.buatNotaKredit(orderId, body, kunciRef.current.kunci);
      onSaved();
    } catch (e) {
      setGalat(pesanGalatNota(e));
      if (e.code === "REVISI_BERUBAH") setF((s) => ({ ...s, konfirmasi: false }));
    } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title="Buat Nota Kredit"
      description={ringkasan ? `Order ${ringkasan.nomor || "—"} · ${ringkasan.pelanggan || "—"}` : "Memuat data order…"}
      className="w-[680px]"
      footer={(
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <Button onClick={simpan} disabled={!siap.siap || sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="simpan-nota-kredit">
            {sibuk ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{galat ? "Coba Lagi" : "Simpan Nota Kredit"}
          </Button>
        </>
      )}
    >
      <div className="space-y-3" data-testid="dialog-nota-kredit">
        {info.memuat && <p className="flex items-center gap-2 text-[12.5px] text-ink3" role="status"><Loader2 size={14} className="animate-spin" />Memuat data order…</p>}
        {info.galat && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">
            <span>{info.galat}</span><Button size="sm" variant="neutral" onClick={muat}><RotateCw size={12} />Coba lagi</Button>
          </div>
        )}

        {ringkasan && (
          <dl className="space-y-1 rounded-lg bg-inset px-3 py-2.5 text-[13px]" data-testid="ringkasan-order-nota">
            <div className="flex justify-between gap-3"><dt className="text-ink2">Tagihan kotor (nilai + ongkir)</dt><dd className="text-ink"><Uang v={ringkasan.tagihanKotor} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink2">Nota kredit aktif</dt><dd className="text-ink">−<Uang v={ringkasan.notaKredit} /></dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><dt className="text-ink">Tagihan bersih</dt><dd className="text-ink"><Uang v={ringkasan.tagihanBersih} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink2">Diterima (terverifikasi)</dt><dd className="text-ink"><Uang v={ringkasan.diterima} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink2">Refund disetujui</dt><dd className="text-ink">−<Uang v={ringkasan.refundDisetujui} /></dd></div>
            <div className="flex justify-between gap-3 border-t border-line pt-1 font-semibold"><dt className="text-ink">Pembayaran bersih</dt><dd className="text-ink"><Uang v={ringkasan.pembayaranBersih} /></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink2">Sisa</dt><dd className="font-semibold text-ink"><Uang v={ringkasan.sisa} /></dd></div>
            <div className="flex flex-wrap justify-between gap-3"><dt className="text-ink2">Status bayar sekarang</dt><dd><Badge variant={ringkasan.statusTersimpan === "LUNAS" ? "green" : "accent"}>{labelStatusBayar(ringkasan.statusTersimpan)}</Badge></dd></div>
          </dl>
        )}

        {ringkasan && !ringkasan.cocok && (
          <p className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" role="status" data-testid="status-tidak-cocok">
            Status tersimpan ({labelStatusBayar(ringkasan.statusTersimpan)}) berbeda dari hitungan server ({labelStatusBayar(ringkasan.statusServer)}).
          </p>
        )}

        <fieldset className="m-0 space-y-1.5 border-0 p-0">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Jenis nota kredit</legend>
          {SUMBER_NOTA.map(([nilai, label]) => {
            const tertaut = nilai === "TERTAUT_REFUND";
            const adaLayak = kandidat.some((k) => k.layak);
            const mati = tertaut && !adaLayak;
            return (
              <label key={nilai} className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[13px] ${f.sumber === nilai ? "border-accent bg-accentbg" : "border-line"} ${mati ? "opacity-60" : ""}`}>
                <input type="radio" name="sumber-nota" value={nilai} checked={f.sumber === nilai} disabled={mati}
                  onChange={() => { set("sumber", nilai); if (tertaut) { const k = kandidat.find((x) => x.layak); if (k) { set("refundId", k.id); set("amount", String(k.potongan)); } } }}
                  className="mt-0.5" data-testid={`sumber-${nilai}`} />
                <span>
                  <span className="font-medium text-ink">{label}</span>
                  <span className="block text-[12px] text-ink3">
                    {tertaut ? (mati ? "Tidak ada refund disetujui yang layak ditautkan pada order ini." : "Mengakui refund yang sudah ada sebagai potongan atas tagihan — tanpa jurnal baru.") : "Potongan/keringanan yang belum dibayar pelanggan — mengurangi sisa piutang order."}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {f.sumber === "TERTAUT_REFUND" && (
          <Field label="Refund sumber" required hint="Hanya refund disetujui yang mendebet Retur & Potongan (potongan atas tagihan) dan belum tertaut nota aktif.">
            <Pilihan value={f.refundId} onChange={(v) => { set("refundId", v); const k = kandidat.find((x) => x.id === v); if (k) set("amount", String(k.potongan)); }}>
              <option value="">— pilih refund —</option>
              {kandidat.map((k) => (
                <option key={k.id} value={k.id} disabled={!k.layak}>
                  {k.nomor} · {formatUang(k.nominal)} · {tanggalPendek(k.tanggal)}{k.layak ? "" : ` — ${k.alasanTidakLayak}`}
                </option>
              ))}
            </Pilihan>
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jenis potongan" required>
            <Pilihan value={f.jenis} onChange={(v) => set("jenis", v)}>
              {JENIS_NOTA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Pilihan>
          </Field>
          <Field label="Tanggal nota" required hint="Tidak boleh di masa depan atau sebelum pengakuan pendapatan">
            <DatePicker block placeholder="Pilih tanggal" value={f.date} onChange={(v) => set("date", v)} />
          </Field>
        </div>
        <Field label="Nominal" required hint={refundTerpilih ? `Maksimal ${formatUang(refundTerpilih.potongan)} (bagian refund yang menjadi potongan)` : "Tidak boleh melebihi sisa piutang order di buku besar"}>
          <InputUang value={f.amount} onChange={(v) => set("amount", v)} data-testid="nominal-nota" />
        </Field>
        <Field label="Alasan" required hint="Minimal 5 karakter — tercatat di riwayat audit">
          <Input value={f.alasan} onChange={(e) => set("alasan", e.target.value)} maxLength={500} placeholder="mis. triplek tambahan tidak jadi dipakai" data-testid="alasan-nota" />
        </Field>

        <section aria-labelledby="judul-dampak-nota" className="space-y-2" data-testid="pratinjau-nota">
          <div className="flex items-center gap-1.5">
            <FileMinus size={14} className="text-ink3" aria-hidden="true" />
            <h3 id="judul-dampak-nota" className="m-0 text-[13px] font-semibold text-ink">Dampak (dihitung server)</h3>
            {pratinjau.memuat && <Loader2 size={13} className="animate-spin text-ink3" aria-label="Menghitung" />}
          </div>
          {!param && <p className="m-0 text-[12.5px] text-ink3" role="status">Isi nominal{f.sumber === "TERTAUT_REFUND" ? " dan pilih refund" : ""} untuk melihat dampaknya.</p>}
          {pratinjau.galat && <p className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert" data-testid="galat-pratinjau">{pratinjau.galat}</p>}
          {pratinjau.data && !pratinjau.galat && (
            <>
              <TabelDampak pratinjau={pratinjau.data} />
              <BlokJurnal pratinjau={pratinjau.data} refundNomor={refundTerpilih?.nomor} />
            </>
          )}
        </section>

        <p className="m-0 rounded-lg bg-accentbg px-3 py-2 text-[12.5px] font-medium leading-relaxed text-ink" data-testid="kalimat-sumber">
          {f.sumber === "TERTAUT_REFUND" ? KALIMAT_TERTAUT : KALIMAT_MANDIRI}
        </p>
        <label className="flex items-start gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={f.konfirmasi} onChange={(e) => set("konfirmasi", e.target.checked)} className="mt-0.5" data-testid="konfirmasi-nota" />
          <span>{KALIMAT_KONFIRMASI[f.sumber]}</span>
        </label>
        {!siap.siap && <p className="m-0 text-[12px] text-ink3" role="status" data-testid="pesan-siap-nota">{siap.pesan}</p>}
        {galat && <p className="m-0 text-[13px] text-red" role="alert" data-testid="galat-nota">{galat}</p>}
      </div>
    </Modal>
  );
}

export function BatalNotaKreditDialog({ nota, onClose, onDone }) {
  const [p, setP] = useState({ memuat: true, galat: "", data: null });
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunciRef = useRef(null);

  const muat = useCallback(async () => {
    setP({ memuat: true, galat: "", data: null });
    try { setP({ memuat: false, galat: "", data: await api.pratinjauBatalNotaKredit(nota.id) }); }
    catch (e) { setP({ memuat: false, galat: pesanGalatNota(e), data: null }); }
  }, [nota.id]);
  useEffect(() => { muat(); }, [muat]);

  const alasanOk = alasan.trim().length >= 5;
  async function batalkan() {
    setGalat(""); setSibuk(true);
    try {
      const body = { reason: alasan.trim(), revisi: p.data.revisi };
      const tanda = JSON.stringify(body);
      if (kunciRef.current?.tanda !== tanda) kunciRef.current = { tanda, kunci: kunciBaru("batal-nota") };
      await api.batalNotaKredit(nota.id, body, kunciRef.current.kunci);
      onDone();
    } catch (e) { setGalat(pesanGalatNota(e)); } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Batalkan ${nota.nomor}`}
      description={`Nota kredit ${formatUang(nota.jumlah)}`}
      className="w-[600px]"
      footer={(
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Kembali</Button>
          <Button variant="destructive" onClick={batalkan} disabled={!alasanOk || sibuk || p.memuat || Boolean(p.galat)} className="max-sm:min-h-11 max-sm:px-4" data-testid="konfirmasi-batal-nota">
            {sibuk ? <Loader2 size={14} className="animate-spin" /> : null}Batalkan Nota Kredit
          </Button>
        </>
      )}
    >
      <div className="space-y-3" data-testid="dialog-batal-nota">
        <p className="m-0 rounded-lg bg-accentbg px-3 py-2 text-[12.5px] font-medium leading-relaxed text-ink">{KALIMAT_BATAL}</p>
        {p.memuat && <p className="flex items-center gap-2 text-[12.5px] text-ink3" role="status"><Loader2 size={14} className="animate-spin" />Menghitung dampak…</p>}
        {p.galat && <p className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">{p.galat}</p>}
        {p.data && (
          <>
            <TabelDampak pratinjau={p.data} uji="dampak-batal" />
            <p className="m-0 text-[12.5px] text-ink2" data-testid="jurnal-batal">
              {p.data.jurnalDibalik ? "Jurnal nota akan dibalik dengan jurnal pembalik (dokumen lama tidak dihapus)." : "Nota ini tidak punya jurnal (tertaut refund) — tidak ada jurnal yang dibalik."}
            </p>
          </>
        )}
        <Field label="Alasan pembatalan" required hint="Minimal 5 karakter — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalat(""); }} maxLength={500} data-testid="alasan-batal-nota" />
        </Field>
        {galat && <p className="m-0 text-[13px] text-red" role="alert" data-testid="galat-batal-nota">{galat}</p>}
      </div>
    </Modal>
  );
}
