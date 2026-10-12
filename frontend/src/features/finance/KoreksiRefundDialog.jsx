import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FileText, Loader2, Paperclip, RotateCw, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { InputUang, Pilihan, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import CaraBayarTransfer from "@/features/finance/CaraBayarTransfer.jsx";
import { biayaTransferLengkap } from "@/features/finance/biayaTransfer.js";
import { PratinjauKoreksi } from "@/features/finance/KoreksiAman.jsx";
import { LinkBukti } from "@/features/finance/receiptMedia.jsx";
import { BerkasBukti, AreaUnggahBukti, useUnggahBukti } from "@/features/finance/BuktiUnggah.jsx";
import {
  MODE_BUKTI, kesiapanBukti, modeBawaan, nilaiAwalRefund, adaPerubahanRefund, bodyKoreksiRefund, ringkasUangRefund,
} from "@/features/finance/refundKoreksiLogic.js";

// KOREKSI REFUND (Admin Keuangan) — bukti transfer + biaya admin bank. Dua langkah: isi form → pratinjau (server menjalankan kode yang SAMA dengan simpan lalu ROLLBACK).
// Berkas: diunggah dulu (status "belum dipakai" di server), baru dirujuk koreksi. Batal/tutup dialog = bukti yang belum dipakai dihapus lagi (server juga menyapu yang basi).

const kunciBaru = () => (globalThis.crypto?.randomUUID ? `koreksi-refund-${globalThis.crypto.randomUUID()}` : `koreksi-refund-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

function BarisUang({ label, nilai, tebal = false, tone }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 text-[13px]", tebal && "border-t border-line pt-1.5 font-semibold")}>
      <dt className={tebal ? "text-ink" : "text-ink2"}>{label}</dt>
      <dd className={cn("tabular-nums", tone === "orange" ? "text-orange" : "text-ink")}>{formatUang(nilai)}</dd>
    </div>
  );
}

export default function KoreksiRefundDialog({ refund, rekening, onClose, onSaved }) {
  const awal = useMemo(() => nilaiAwalRefund(refund), [refund]);
  const [f, setF] = useState(awal);
  const [alasan, setAlasan] = useState("");
  const [bukti, setBukti] = useState({ memuat: true, galat: "", data: null });
  const [mode, setMode] = useState(null);
  const [pratinjau, setPratinjau] = useState(null);
  const [setuju, setSetuju] = useState(false);
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunciRef = useRef(null);
  const kotakRef = useRef(null);
  // Unggahan bukti dipakai bersama dengan "Lampirkan Bukti" — perubahan daftar membatalkan pratinjau & kunci idempotensi.
  const { unggahan, tambahBerkas, kirim, buang, saatPaste: tempel, tandaiDipakai, idsBaru, sedangUnggah } = useUnggahBukti({
    saatUbah: () => { setPratinjau(null); setSetuju(false); kunciRef.current = null; },
  });

  const rek = rekening.find((r) => r.id === f.cashAccountId);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPratinjau(null); setSetuju(false); kunciRef.current = null; };

  const muatBukti = useCallback(async () => {
    setBukti({ memuat: true, galat: "", data: null });
    try {
      const d = await api.getBuktiRefund(refund.id);
      setBukti({ memuat: false, galat: "", data: d });
      setMode((m) => m ?? modeBawaan(d.jumlah));
    } catch (e) { setBukti({ memuat: false, galat: e.message || "Gagal memuat bukti", data: null }); }
  }, [refund.id]);
  useEffect(() => { muatBukti(); }, [muatBukti]);

  // Ctrl+V: tempel gambar/berkas dari clipboard ke area bukti (tidak berlaku untuk mode "gunakan bukti lama").
  const saatPaste = (e) => { if (mode !== "LAMA") tempel(e); };

  const jumlahLama = bukti.data?.jumlah ?? 0;
  const modeAktif = mode ?? modeBawaan(jumlahLama);
  const siapBukti = kesiapanBukti({ jumlahLama, mode: modeAktif, jumlahBaru: idsBaru.length, sedangUnggah });
  const valid = adaPerubahanRefund(awal, f) && Number(f.amount) > 0 && f.date && f.cashAccountId && biayaTransferLengkap(rek, f) && alasan.trim() && siapBukti.siap && !bukti.memuat && !bukti.galat;
  const uang = ringkasUangRefund({ nominal: f.amount, biayaAdmin: pratinjau?.refund?.biayaAdminBaru ?? (f.paymentMethod === "TRANSFER" && f.transferFeeType === "LAINNYA" ? f.transferFeeAmount : 0) });

  const body = (extra = {}) => bodyKoreksiRefund({ awal, form: f, alasan, mode: modeAktif, idsBaru, expectedUpdatedAt: bukti.data?.updatedAt ?? refund.updatedAt, ...extra });

  async function tinjau() {
    setGalat(""); setSibuk(true);
    try {
      const r = await api.koreksiFinanceDoc("refunds", refund.id, body({ preview: true }), null);
      setPratinjau(r.pratinjau); setSetuju(false);
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  async function simpan() {
    setGalat(""); setSibuk(true);
    try {
      kunciRef.current ||= kunciBaru();
      await api.koreksiFinanceDoc("refunds", refund.id, body({ konfirmasiBiayaGanda: setuju }), null, kunciRef.current);
      tandaiDipakai();
      onSaved();
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  const tutup = () => { onClose(); };
  const r = pratinjau?.refund;

  return (
    <Modal
      open onOpenChange={(v) => !v && tutup()}
      title={`Koreksi ${refund.refundNumber}`}
      description={`Refund disetujui · order ${refund.order?.orderNumber || ""} · ${formatUang(refund.amount)}`}
      className="w-[680px]"
      footer={
        <>
          <Button variant="neutral" onClick={pratinjau ? () => { setPratinjau(null); setSetuju(false); } : tutup} className="max-sm:min-h-11 max-sm:px-4">{pratinjau ? "Kembali" : "Batal"}</Button>
          {pratinjau
            ? <Button onClick={simpan} disabled={sibuk || !pratinjau.seimbang || (r?.perluKonfirmasi && !setuju)} className="max-sm:min-h-11 max-sm:px-4" data-testid="konfirmasi-koreksi"><ShieldCheck size={14} />{galat ? "Coba Lagi" : "Konfirmasi Koreksi"}</Button>
            : <Button onClick={tinjau} disabled={!valid || sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="lihat-pratinjau">{sibuk && <Loader2 size={14} className="animate-spin" />}Lihat Pratinjau</Button>}
        </>
      }
    >
      <div ref={kotakRef} className="space-y-3" onPaste={saatPaste} data-testid="koreksi-refund">
        {pratinjau ? (
          <>
            <p className="text-[12.5px] text-ink2"><strong>Alasan:</strong> {alasan}</p>
            <div className="rounded-lg bg-inset p-3" data-testid="ringkasan-refund">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]"><span className="font-mono">{r.dokumenLama}</span><ArrowRight size={12} className="text-ink3" /><span className="font-mono">{r.dokumenPengganti}</span><Badge variant="neutral">dokumen pengganti</Badge></div>
              <div className="grid gap-2 text-[12.5px] sm:grid-cols-[130px_1fr]">
                {[
                  ["Nominal refund", formatUang(r.nominalLama), formatUang(r.nominalBaru)],
                  ["Biaya admin bank", formatUang(r.biayaAdminLama), formatUang(r.biayaAdminBaru)],
                  ["Total keluar rekening", formatUang(r.totalKeluarLama), formatUang(r.totalKeluarBaru)],
                  ["Rekening", r.rekeningLama, r.rekeningBaru],
                  ["Tanggal", tanggalPendek(r.tanggalLama), tanggalPendek(r.tanggalBaru)],
                  ["Referensi transfer", r.referensiLama || "—", r.referensiBaru || "—"],
                ].map(([k, a, b]) => (
                  <React.Fragment key={k}>
                    <div className="text-ink3">{k}</div>
                    <div className="flex flex-wrap items-center gap-x-2">{a === b ? <span>{b}</span> : <><span className="text-ink3 line-through">{a}</span><ArrowRight size={12} className="shrink-0 text-ink3" /><span className="font-medium">{b}</span></>}</div>
                  </React.Fragment>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-ink3">Nominal refund = yang diterima pelanggan. Biaya admin bank = beban perusahaan (bukan pengurang refund, bukan omzet). Total keluar = nominal refund + biaya admin.</p>
            </div>
            <div className="rounded-lg bg-inset p-3" data-testid="ringkasan-bukti">
              <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.05em] text-ink3">Bukti transfer</div>
              <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
                <div><div className="text-ink3">Dokumen lama ({r.bukti.lama.length}) — tetap melekat</div><ul className="m-0 list-none space-y-0.5 p-0">{r.bukti.lama.map((b, i) => <li key={`${b.id}-${i}`} className="truncate">{b.nama}</li>)}{!r.bukti.lama.length && <li className="text-ink3">Tidak ada</li>}</ul></div>
                <div><div className="text-ink3">Dokumen pengganti ({r.bukti.pengganti.length})</div><ul className="m-0 list-none space-y-0.5 p-0">{r.bukti.pengganti.map((b, i) => <li key={`${b.id}-${i}`} className="truncate">{b.nama}{b.origin === "BARU" ? <span className="text-green"> · baru</span> : ""}</li>)}</ul></div>
              </div>
            </div>
            {r.peringatan.length > 0 && (
              <div className={cn("rounded-lg px-3 py-2.5 text-[12.5px]", r.perluKonfirmasi ? "bg-redbg text-red" : "bg-orangebg text-orange")} role="alert" data-testid="peringatan-biaya-ganda">
                <div className="mb-1 flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} />Potensi biaya admin tercatat dua kali</div>
                <ul className="m-0 list-disc space-y-1 pl-5">{r.peringatan.map((p) => <li key={p.jurnal}><strong>{p.tingkat === "KUAT" ? "Kecocokan kuat" : "Kecocokan lemah"}:</strong> {p.pesan}</li>)}</ul>
                <p className="mt-1.5 text-ink2">Sistem hanya menunjukkan kandidat — tidak menghapus atau mengubah transaksi apa pun.</p>
                {r.perluKonfirmasi && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-ink">
                    <input type="checkbox" checked={setuju} onChange={(e) => setSetuju(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" data-testid="setuju-biaya-ganda" />
                    <span>Saya sudah memeriksa jurnal tersebut dan biaya admin ini <strong>bukan duplikat</strong>. Lanjutkan koreksi.</span>
                  </label>
                )}
              </div>
            )}
            <PratinjauKoreksi pratinjau={pratinjau} />
            <p className="text-[12px] text-ink3">Menyimpan membuat dokumen pengganti dan membalik jurnal lama sekali saja (aman dari klik ganda). Bukti dokumen lama tidak diubah.</p>
          </>
        ) : (
          <>
            <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] leading-relaxed text-ink2">
              Refund ini sudah masuk buku besar. Koreksi MEMBALIK jurnal lama (termasuk biaya admin lama) dan membuat dokumen serta jurnal pengganti. Dokumen dan bukti lama tidak diubah atau dihapus.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Nominal refund (diterima pelanggan)" required><InputUang value={f.amount} onChange={(v) => set("amount", v)} /></Field>
              <Field label="Tanggal refund" required><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={f.date} onChange={(v) => set("date", v)} /></Field>
            </div>
            <Field label="Rekening sumber pengembalian" required>
              <Pilihan value={f.cashAccountId} onChange={(v) => set("cashAccountId", v)}>
                <option value="">— pilih —</option>
                {rekening.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Pilihan>
            </Field>
            <CaraBayarTransfer rekening={rek} nominal={f.amount} value={f} onChange={(b) => { setF((s) => ({ ...s, ...b })); setPratinjau(null); setSetuju(false); kunciRef.current = null; }} />
            <Field label="Nomor referensi transfer" hint="Opsional — membantu mendeteksi biaya admin yang sudah tercatat di tempat lain">
              <Input value={f.transferReference} maxLength={120} onChange={(e) => set("transferReference", e.target.value)} placeholder="mis. nomor referensi di mutasi bank" />
            </Field>
            <dl className="space-y-1 rounded-lg bg-inset px-3 py-2.5" data-testid="ringkasan-uang" aria-live="polite">
              <BarisUang label="Nominal refund pelanggan" nilai={uang.nominalRefund} />
              <BarisUang label="Biaya admin bank" nilai={uang.biayaAdmin} tone={uang.biayaAdmin > 0 ? "orange" : undefined} />
              <BarisUang label="Total keluar rekening" nilai={uang.totalKeluar} tebal />
            </dl>

            <section aria-labelledby="judul-bukti" className="space-y-2.5" data-testid="bagian-bukti">
              <div className="flex items-center gap-1.5"><Paperclip size={14} className="text-ink3" aria-hidden="true" /><h3 id="judul-bukti" className="m-0 text-[13px] font-semibold text-ink">Bukti transfer <span className="text-red">*</span></h3></div>
              {bukti.memuat && <p className="flex items-center gap-2 text-[12.5px] text-ink3" role="status"><Loader2 size={14} className="animate-spin" />Memuat bukti dokumen lama…</p>}
              {bukti.galat && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">
                  <span>{bukti.galat}</span><Button size="sm" variant="neutral" onClick={muatBukti}><RotateCw size={12} />Coba lagi</Button>
                </div>
              )}
              {bukti.data && (
                <>
                  <div>
                    <div className="mb-1 text-[12px] text-ink3">Bukti dokumen lama ({jumlahLama})</div>
                    {jumlahLama === 0
                      ? <p className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" role="status">Refund ini belum punya bukti transfer. Unggah minimal satu bukti agar dokumen pengganti bisa dibuat.</p>
                      : (
                        <ul className="m-0 list-none space-y-1.5 p-0">
                          {bukti.data.lampiranLama && (
                            <li className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2" data-testid="berkas-bukti">
                              <FileText size={18} className="text-ink3" aria-hidden="true" />
                              <LinkBukti url={bukti.data.lampiranLama} className="text-[13px] font-medium text-accent hover:underline">Lampiran lama (buka)</LinkBukti>
                            </li>
                          )}
                          {bukti.data.berkas.map((b) => <BerkasBukti key={b.id} nama={b.nama} ukuran={b.ukuranByte} pdf={b.pdf} url={b.url} origin={b.origin} />)}
                        </ul>
                      )}
                  </div>
                  <fieldset className="m-0 border-0 p-0" disabled={bukti.memuat}>
                    <legend className="sr-only">Pilihan bukti untuk dokumen pengganti</legend>
                    <div className="space-y-1.5">
                      {MODE_BUKTI.map((m) => {
                        const nonaktif = m.kode === "LAMA" && jumlahLama === 0;
                        return (
                          <label key={m.kode} className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 max-sm:min-h-11", modeAktif === m.kode ? "border-accent bg-accentbg" : "border-line", nonaktif && "cursor-not-allowed opacity-50")}>
                            <input type="radio" name="mode-bukti" value={m.kode} checked={modeAktif === m.kode} disabled={nonaktif} onChange={() => { setMode(m.kode); setPratinjau(null); setSetuju(false); kunciRef.current = null; }} className="mt-1 h-4 w-4 shrink-0" />
                            <span><span className="block text-[13px] font-medium text-ink">{m.label}</span><span className="block text-[12px] text-ink3">{m.bantu}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  {modeAktif !== "LAMA" && (
                    <AreaUnggahBukti unggahan={unggahan} tambahBerkas={tambahBerkas} kirim={kirim} buang={buang} />
                  )}
                  {!siapBukti.siap && <p className="m-0 text-[12px] text-ink3" role="status">{siapBukti.pesan}</p>}
                </>
              )}
            </section>

            <Field label="Alasan koreksi" required hint="Wajib — tercatat di riwayat audit">
              <Input value={alasan} onChange={(e) => { setAlasan(e.target.value); setPratinjau(null); kunciRef.current = null; }} placeholder="mis. biaya admin bank berubah / salah rekening" />
            </Field>
            {!adaPerubahanRefund(awal, f) && <p className="text-[12px] text-ink3">Ubah minimal satu data refund (nominal, tanggal, rekening, biaya admin, atau referensi) untuk melanjutkan.</p>}
          </>
        )}
        {galat && <p className="text-[13px] text-red" role="alert" data-testid="galat-koreksi">{galat}</p>}
      </div>
    </Modal>
  );
}
