import React, { useEffect, useState } from "react";
import { PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { friendlyError } from "@/features/production/experience.js";
import { kbjAlasanValid, kbjBolehKonfirmasi, kbjKunciBaru, KBJ_ALASAN_MIN } from "@/features/production/konfirmasiBarangJadiLogic.js";

// KONFIRMASI BARANG JADI (mode adaptasi) — pekerjaan fisik SUDAH selesai tetapi pencatatan tahap Meja/Corner tertinggal. Jalur resmi yang sama dengan "Selesaikan Produksi":
// tahap tersisa dicatat DILEWATI (bukan dikerjakan), QC tidak dilakukan (bukan lulus), tanpa serah terima/stok/foto/hasil uji karangan. Server menegakkan izin dan semua syarat;
// layar ini hanya mengumpulkan kode unit (identitas), lokasi barang jadi yang sah, alasan, dan pernyataan verifikasi fisik, setelah menampilkan pratinjau server.
export default function KonfirmasiBarangJadi({ d, canConfirm, onDone }) {
  const p = d.production;
  const [buka, setBuka] = useState(false);
  if (!kbjBolehKonfirmasi({ adaptation: !!p.adaptation, runStatus: p.runStatus, unitStatus: d.identity.status, canConfirm })) return null;
  return (
    <div data-testid="kbj-panel" className="rounded-btn border border-line p-3 text-[12.5px]">
      <p className="m-0 font-semibold text-ink">Pekerjaan fisik sudah selesai, tapi tahap belum tercatat?</p>
      <p className="m-0 mt-0.5 text-ink3">
        Konfirmasi barang jadi menutup pekerjaan lewat jalur resmi: tahap tersisa dicatat <b>dilewati</b>, QC <b>tidak dilakukan</b>, tanpa foto/hasil uji karangan. Unit lalu Siap Kirim.
      </p>
      <Button size="sm" variant="secondary" className="mt-2 min-h-[40px]" data-testid="kbj-buka" onClick={() => setBuka(true)}>
        <PackageCheck size={14} aria-hidden /> Konfirmasi Barang Jadi
      </Button>
      {buka && <DialogKbj d={d} onClose={() => setBuka(false)} onDone={() => onDone?.()} />}
    </div>
  );
}

function DialogKbj({ d, onClose, onDone }) {
  const p = d.production; const kode = d.identity.unitCode;
  const [pv, setPv] = useState(null); const [lokasi, setLokasi] = useState([]); const [muat, setMuat] = useState(true);
  const [kodeUnit, setKodeUnit] = useState(""); const [locationId, setLocationId] = useState(""); const [alasan, setAlasan] = useState(""); const [verif, setVerif] = useState(false);
  const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(""); const [hasil, setHasil] = useState(null);
  const [kunci, setKunci] = useState(() => kbjKunciBaru());

  useEffect(() => {
    let batal = false;
    (async () => {
      try {
        const [a, b] = await Promise.all([api.getProductionV2FinishPreview(p.runId), api.getProductionV2FinishedGoodsLocations(p.runId)]);
        if (!batal) { setPv(a); setLokasi(b.locations ?? []); }
      } catch (e) { if (!batal) setGalat(friendlyError(e)); }
      finally { if (!batal) setMuat(false); }
    })();
    return () => { batal = true; };
  }, [p.runId]);

  const bolehKirim = !sibuk && !!pv?.canFinish && kodeUnit.trim() === kode && !!locationId && kbjAlasanValid(alasan) && verif;
  // Panel induk hilang begitu unit Siap Kirim (data dimuat ulang) — muat ulang HANYA saat dialog ditutup supaya hasil konfirmasi sempat terbaca.
  const tutup = () => { onClose(); if (hasil?.completed) onDone?.(); };
  async function kirim() {
    setSibuk(true); setGalat("");
    try {
      const res = await api.confirmProductionV2FinishedGoods(p.runId, { expectedRevision: pv.revision, unitCode: kodeUnit.trim(), locationId, reason: alasan.trim().replace(/\s+/g, " "), physicalVerified: true }, kunci);
      setHasil(res);
    } catch (e) {
      setGalat(friendlyError(e));
      setKunci(kbjKunciBaru()); // kegagalan: percobaan berikutnya memakai kunci baru (jawaban lama tidak diputar balik)
    } finally { setSibuk(false); }
  }

  return (
    <Modal
      open onOpenChange={(v) => !v && !sibuk && tutup()}
      title={`Konfirmasi Barang Jadi — ${kode}`}
      description="Pekerjaan ditutup lewat jalur resmi Selesaikan Produksi. Hanya dilakukan setelah barang benar-benar dilihat selesai."
      className="w-[560px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" data-testid="kbj-galat" className="m-0 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={tutup} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4" data-testid="kbj-tutup">Tutup</Button>
            {!hasil?.completed && (
              <Button variant="primary" disabled={!bolehKirim} onClick={kirim} className="max-sm:min-h-11 max-sm:px-4" data-testid="kbj-konfirmasi">
                {sibuk ? "Mengonfirmasi…" : "Konfirmasi Barang Jadi"}
              </Button>
            )}
          </div>
        </div>
      )}
    >
      {muat && <p className="m-0 text-[13px] text-ink3" data-testid="kbj-memuat">Memeriksa keadaan pekerjaan…</p>}
      {!muat && pv && (
        <div className="space-y-3 text-[12.5px]" data-testid="kbj-isi">
          {hasil?.completed ? (
            <div role="status" data-testid="kbj-sukses" className="rounded-lg bg-greenbg px-3 py-2 text-green">
              <p className="m-0 font-semibold">Barang jadi dikonfirmasi — unit Siap Kirim.</p>
              <p className="m-0 mt-0.5">Lokasi: {hasil.lokasi?.code}. QC: tidak dilakukan. {hasil.skippedSteps?.length ?? 0} tahap dicatat dilewati.</p>
            </div>
          ) : (
            <>
              {!pv.canFinish && (
                <div className="rounded-lg bg-orangebg px-3 py-2 text-orange" data-testid="kbj-penghalang">
                  <p className="m-0 font-semibold">Belum bisa dikonfirmasi</p>
                  <ul className="m-0 mt-1 list-disc pl-4">{(pv.blockers ?? []).map((b) => <li key={b.code}>{b.text}</li>)}</ul>
                </div>
              )}
              <div className="rounded-lg bg-inset px-3 py-2" data-testid="kbj-pratinjau">
                <p className="m-0 font-semibold text-ink">Yang akan dicatat</p>
                <ul className="m-0 mt-1 list-disc pl-4 text-ink2">
                  <li>Tahap dilewati (bukan dikerjakan): {(pv.willSkipSteps ?? []).map((s) => `${s.no}. ${s.label}`).join(", ") || "—"}</li>
                  <li>QC: <b>tidak dilakukan</b> (bukan lulus). Tidak ada foto, hasil uji, stok, atau serah terima Gudang yang dibuat.</li>
                  {(pv.pendingReturns ?? []).length > 0 && <li className="text-orange">Sisa bahan harus diterima Gudang dulu: {pv.pendingReturns.map((r) => `${r.code} ${r.qty}`).join(", ")}</li>}
                </ul>
              </div>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Ketik ulang kode unit <span className="font-mono text-ink3">({kode})</span></span>
                <input data-testid="kbj-kode" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent" value={kodeUnit} onChange={(e) => setKodeUnit(e.target.value)} autoComplete="off" />
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Lokasi barang jadi</span>
                <select data-testid="kbj-lokasi" className="h-10 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">— pilih lokasi —</option>
                  {lokasi.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.warehouse?.name ?? l.zone}</option>)}
                </select>
                {lokasi.length === 0 && <span className="mt-1 block text-orange" data-testid="kbj-lokasi-kosong">Belum ada lokasi area barang jadi/dispatch aktif — minta Gudang menambahkannya.</span>}
              </label>
              <label className="block">
                <span className="mb-1 block font-semibold text-ink">Alasan <span className="font-normal text-ink3">(minimal {KBJ_ALASAN_MIN} karakter; tercatat bersama nama dan waktu Anda)</span></span>
                <textarea data-testid="kbj-alasan" className="min-h-[72px] w-full rounded-btn border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-accent" value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} />
              </label>
              <label className="flex min-h-[40px] items-start gap-2 text-ink">
                <input data-testid="kbj-verif" type="checkbox" className="mt-0.5 h-4 w-4" checked={verif} onChange={(e) => setVerif(e.target.checked)} />
                <span>Saya sudah melihat barangnya langsung dan pekerjaan fisik memang selesai.</span>
              </label>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
