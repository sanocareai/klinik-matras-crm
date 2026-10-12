import React, { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, RotateCw, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { api } from "@/api.js";
import { formatUang } from "@/features/finance/shared.jsx";
import { LinkBukti } from "@/features/finance/receiptMedia.jsx";
import { BerkasBukti, AreaUnggahBukti, useUnggahBukti } from "@/features/finance/BuktiUnggah.jsx";
import { KALIMAT_LAMPIR, bodyLampirBukti, kesiapanLampir } from "@/features/finance/refundKoreksiLogic.js";

// LAMPIRKAN BUKTI (Admin Keuangan) — menambah bukti transfer pada refund yang nominal/tanggal/rekening/jurnalnya sudah benar, TANPA koreksi.
// Tidak ada dokumen pengganti, tidak ada jurnal baru, tidak ada perubahan saldo. Bukti yang sudah terlampir tidak bisa diganti/dihapus (server menolak).
// `refund`: { id, refundNumber, amount, transferFeeAmount, cashAccount?: { name }, order?: { orderNumber }, status, replacedBy? } — dari daftar refund ATAU dari Riwayat versi.

const kunciBaru = () => (globalThis.crypto?.randomUUID ? `lampir-bukti-${globalThis.crypto.randomUUID()}` : `lampir-bukti-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export default function LampirkanBuktiDialog({ refund, onClose, onSaved }) {
  const [bukti, setBukti] = useState({ memuat: true, galat: "", data: null });
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunciRef = useRef(null); // { tanda, kunci } — kunci idempotensi dipakai ulang selama isi (alasan + bukti) sama, supaya retry/klik ganda tidak melampirkan dua kali
  const { unggahan, tambahBerkas, kirim, buang, saatPaste, tandaiDipakai, idsBaru, sedangUnggah } = useUnggahBukti({ saatUbah: () => setGalat("") });

  const muat = useCallback(async () => {
    setBukti({ memuat: true, galat: "", data: null });
    try { setBukti({ memuat: false, galat: "", data: await api.getBuktiRefund(refund.id) }); }
    catch (e) { setBukti({ memuat: false, galat: e.message || "Gagal memuat bukti", data: null }); }
  }, [refund.id]);
  useEffect(() => { muat(); }, [muat]);

  const jumlahSudah = bukti.data?.jumlah ?? 0;
  const siap = kesiapanLampir({ jumlahSudah, jumlahBaru: idsBaru.length, sedangUnggah, alasan });
  const nominal = Number(refund.amount) || 0;
  const biaya = Number(refund.transferFeeAmount) || 0;
  const diganti = refund.replacedBy?.refundNumber ?? null;

  async function simpan() {
    setGalat(""); setSibuk(true);
    try {
      const body = bodyLampirBukti({ alasan, ids: idsBaru });
      const tanda = JSON.stringify(body);
      if (kunciRef.current?.tanda !== tanda) kunciRef.current = { tanda, kunci: kunciBaru() };
      await api.lampirkanBuktiRefund(refund.id, body, kunciRef.current.kunci);
      tandaiDipakai();
      onSaved();
    } catch (e) { setGalat(e.message); } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Lampirkan Bukti ${refund.refundNumber}`}
      description={`Refund${diganti ? ` (versi lama — sudah digantikan ${diganti})` : " disetujui"}${refund.order?.orderNumber ? ` · order ${refund.order.orderNumber}` : ""}`}
      className="w-[640px]"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <Button onClick={simpan} disabled={!siap.siap || sibuk || bukti.memuat || Boolean(bukti.galat)} className="max-sm:min-h-11 max-sm:px-4" data-testid="konfirmasi-lampir">
            {sibuk ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}{galat ? "Coba Lagi" : "Lampirkan Bukti"}
          </Button>
        </>
      }
    >
      <div className="space-y-3" onPaste={saatPaste} data-testid="lampirkan-bukti">
        <p className="rounded-lg bg-accentbg px-3 py-2 text-[12.5px] font-medium leading-relaxed text-ink" data-testid="kalimat-lampir">{KALIMAT_LAMPIR}</p>

        <dl className="space-y-1 rounded-lg bg-inset px-3 py-2.5 text-[13px]" data-testid="ringkasan-lampir">
          <div className="flex justify-between gap-3"><dt className="text-ink2">Rekening</dt><dd className="text-right text-ink">{refund.cashAccount?.name || "—"}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink2">Nominal refund pelanggan</dt><dd className="tabular-nums text-ink">{formatUang(nominal)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-ink2">Biaya admin bank</dt><dd className="tabular-nums text-ink">{formatUang(biaya)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold"><dt className="text-ink">Total keluar rekening</dt><dd className="tabular-nums text-ink">{formatUang(nominal + biaya)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-line pt-1.5"><dt className="text-ink2">Dampak keuangan</dt><dd className="font-semibold tabular-nums text-green" data-testid="dampak-nol">Rp0 — jurnal & saldo tidak berubah</dd></div>
        </dl>

        <section aria-labelledby="judul-bukti-lampir" className="space-y-2.5">
          <div className="flex items-center gap-1.5"><Paperclip size={14} className="text-ink3" aria-hidden="true" /><h3 id="judul-bukti-lampir" className="m-0 text-[13px] font-semibold text-ink">Bukti yang sudah terlampir ({jumlahSudah})</h3></div>
          {bukti.memuat && <p className="flex items-center gap-2 text-[12.5px] text-ink3" role="status"><Loader2 size={14} className="animate-spin" />Memuat bukti…</p>}
          {bukti.galat && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red" role="alert">
              <span>{bukti.galat}</span><Button size="sm" variant="neutral" onClick={muat}><RotateCw size={12} />Coba lagi</Button>
            </div>
          )}
          {bukti.data && (jumlahSudah === 0
            ? <p className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" role="status">Refund ini belum punya bukti transfer.</p>
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
            ))}
          <p className="m-0 text-[12px] text-ink3">Bukti yang sudah terlampir tidak bisa diganti atau dihapus. Anda bisa menambah bukti lagi kapan saja.</p>
        </section>

        <section aria-labelledby="judul-bukti-baru" className="space-y-2.5">
          <h3 id="judul-bukti-baru" className="m-0 text-[13px] font-semibold text-ink">Bukti yang akan dilampirkan <span className="text-red">*</span></h3>
          <AreaUnggahBukti unggahan={unggahan} tambahBerkas={tambahBerkas} kirim={kirim} buang={buang} />
        </section>

        <Field label="Alasan" required hint="Minimal 5 karakter — tercatat di riwayat audit">
          <Input value={alasan} onChange={(e) => { setAlasan(e.target.value); setGalat(""); }} maxLength={500} placeholder="mis. bukti transfer baru diterima dari bank" data-testid="alasan-lampir" />
        </Field>
        {!siap.siap && <p className="m-0 text-[12px] text-ink3" role="status" data-testid="pesan-siap">{siap.pesan}</p>}
        {galat && <p className="text-[13px] text-red" role="alert" data-testid="galat-lampir">{galat}</p>}
      </div>
    </Modal>
  );
}
