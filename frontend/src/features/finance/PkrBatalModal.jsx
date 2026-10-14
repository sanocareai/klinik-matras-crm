import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Field } from "@/components/ui/field.jsx";
import { formatUang } from "@/features/finance/shared.jsx";
import { ALASAN_MIN, ALASAN_MAKS, alasanValid, kelompokHambatan, kunciBaru } from "@/features/finance/pkrBatalLogic.js";

// PEMBATALAN PENJUALAN KARYAWAN — modal (bukan window.prompt). Alur: pratinjau server (baca-saja) -> penjelasan -> alasan -> batalkan.
//  • Transaksi ber-DP: pembatalan DITAHAN dan DP TIDAK dibatalkan/dikembalikan otomatis — Finance menanganinya dulu lewat Riwayat Pembayaran (tautan di sini).
//  • Produksi/Delivery sudah berjalan: pembatalan DITAHAN (alur pembatalan order resmi). Galat server selalu tampil di modal ini.
const AREA = "min-h-[84px] w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";

export function ModalBatalPkr({ penjualan, onClose, onBukaRiwayat, onSelesai }) {
  const [pv, setPv] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(kunciBaru("pkr-batal"));

  const muat = useCallback(async () => {
    setMemuat(true);
    try { setPv(await api.pratinjauPembatalanPkr(penjualan.id)); setGalat(""); }
    catch (e) { setGalat(e.message || "Gagal memuat pratinjau pembatalan"); }
    finally { setMemuat(false); }
  }, [penjualan.id]);
  useEffect(() => { muat(); }, [muat]);

  const h = kelompokHambatan(pv);
  const boleh = pv?.boleh === true;

  async function batalkan() {
    setSibuk(true); setGalat("");
    try {
      await api.batalPenjualanKaryawan(penjualan.id, alasan.trim().replace(/\s+/g, " "), kunci.current);
      await onSelesai?.();
    } catch (e) {
      setGalat(e.message || "Gagal membatalkan penjualan");
      kunci.current = kunciBaru("pkr-batal");
      await muat(); // keadaan bisa berubah (mis. pembayaran baru masuk) — penjelasan ikut diperbarui; pesan galat tetap terlihat
      setGalat(e.message || "Gagal membatalkan penjualan");
    } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()}
      title={`Batalkan penjualan — ${penjualan.nomor}`}
      description="Pembatalan membalik jurnal penjualan dan membatalkan order CRM beserta unitnya yang belum diproses. Riwayat tetap tersimpan."
      className="w-[560px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="batal-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="batal-tutup">Tutup</Button>
            {boleh && (
              <Button variant="destructive" disabled={sibuk || !alasanValid(alasan)} onClick={batalkan} className="max-sm:min-h-11 max-sm:px-4" data-testid="batal-konfirmasi">
                {sibuk ? "Membatalkan…" : "Batalkan Penjualan"}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {memuat && !pv && <p className="m-0 text-[13px] text-ink3" data-testid="batal-memuat">Memeriksa apakah penjualan ini bisa dibatalkan…</p>}
      {pv && (
        <div className="space-y-4" data-testid="batal-isi">
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
            <dt className="text-ink3">Pembeli</dt><dd className="m-0 text-right font-medium text-ink">{pv.pembeli || "—"}</dd>
            <dt className="text-ink3">Nilai penjualan</dt><dd className="m-0 text-right font-medium text-ink">{formatUang(pv.total)}</dd>
            <dt className="text-ink3">Order CRM</dt><dd className="m-0 text-right font-mono text-ink" data-testid="batal-order">{pv.order?.nomor || "belum ada"}</dd>
            <dt className="text-ink3">Pembayaran aktif</dt>
            <dd className="m-0 text-right font-medium text-ink" data-testid="batal-bayar">{pv.pembayaranAktif.jumlah > 0 ? `${pv.pembayaranAktif.jumlah} pembayaran · ${formatUang(pv.pembayaranAktif.total)}` : "tidak ada"}</dd>
          </dl>

          {h.sudah.length > 0 && <p role="note" className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="batal-sudah">{h.sudah[0].pesan}</p>}

          {h.bayar.length > 0 && (
            <section className="space-y-2 rounded-lg border border-orange/40 bg-orangebg px-3 py-3" data-testid="batal-hambatan-bayar" aria-label="Pembayaran harus ditangani Finance dahulu">
              <p className="m-0 flex items-start gap-2 text-[13px] font-semibold text-orange"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> Pembayaran harus ditangani Finance dahulu</p>
              <p className="m-0 text-[12.5px] leading-relaxed text-ink" data-testid="batal-pesan-bayar">{h.bayar[0].pesan}</p>
              {onBukaRiwayat && (
                <Button size="sm" variant="secondary" className="min-h-[40px]" data-testid="batal-buka-riwayat" onClick={() => onBukaRiwayat(penjualan.id)}>
                  <History size={13} aria-hidden /> Buka Riwayat Pembayaran
                </Button>
              )}
            </section>
          )}

          {h.produksi.length > 0 && (
            <section className="space-y-1.5 rounded-lg border border-red/30 bg-redbg px-3 py-3" data-testid="batal-hambatan-produksi" aria-label="Produksi atau pengiriman sudah berjalan">
              <p className="m-0 flex items-start gap-2 text-[13px] font-semibold text-red"><AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> Produksi atau pengiriman sudah berjalan</p>
              {h.produksi.map((x, i) => <p key={i} className="m-0 text-[12.5px] leading-relaxed text-ink">{x.pesan}</p>)}
              <p className="m-0 text-[12px] text-ink2">Pembatalan lewat sini ditahan supaya pekerjaan yang sedang dikerjakan tidak hilang diam-diam.</p>
            </section>
          )}

          {h.lain.map((x, i) => <p key={i} role="note" className="m-0 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">{x.pesan}</p>)}

          {boleh && (
            <>
              <section aria-label="Yang akan terjadi">
                <p className="m-0 mb-1 text-[12px] font-semibold text-ink2">Yang akan terjadi</p>
                <ul className="m-0 space-y-1 pl-4 text-[12.5px] text-ink" data-testid="batal-akan">
                  {pv.akanTerjadi.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </section>
              <Field label="Alasan pembatalan" required hint={`Wajib (minimal ${ALASAN_MIN} karakter). Tercatat di riwayat dokumen dan order.`}>
                <textarea className={AREA} value={alasan} maxLength={ALASAN_MAKS} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan pembatalan" data-testid="batal-alasan" />
              </Field>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Modal alasan umum (pengganti window.prompt) — dipakai untuk membatalkan pembayaran di Riwayat Pembayaran. Galat server tampil di modal. */
export function ModalAlasan({ judul, deskripsi, tombol = "Konfirmasi", destruktif = true, onSubmit, onClose }) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  async function kirim() {
    setSibuk(true); setGalat("");
    try { await onSubmit(alasan.trim().replace(/\s+/g, " ")); }
    catch (e) { setGalat(e.message || "Gagal"); }
    finally { setSibuk(false); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && onClose()} title={judul} description={deskripsi} className="w-[480px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="alasan-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <Button variant={destruktif ? "destructive" : "primary"} disabled={sibuk || !alasanValid(alasan)} onClick={kirim} className="max-sm:min-h-11 max-sm:px-4" data-testid="alasan-konfirmasi">{sibuk ? "Memproses…" : tombol}</Button>
          </div>
        </div>
      )}
    >
      <Field label="Alasan" required hint={`Wajib (minimal ${ALASAN_MIN} karakter).`}>
        <textarea className={AREA} value={alasan} maxLength={ALASAN_MAKS} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan" data-testid="alasan-teks" />
      </Field>
    </Modal>
  );
}
