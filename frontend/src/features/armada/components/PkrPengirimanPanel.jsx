import React, { useCallback, useEffect, useRef, useState } from "react";
import { PackageCheck } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";

// DELIVERY — order Penjualan Karyawan yang unitnya sebagian sudah siap kirim tetapi menunggu unit lain.
// Aturan (keputusan Owner): job pengiriman dibuat OTOMATIS hanya setelah SEMUA unit yang dikirim siap, dan hanya SATU. Pengiriman sebagian = aksi eksplisit di sini:
// pilih unit yang siap, tulis alasan, kirim dengan Idempotency-Key. Tidak ada job kedua otomatis.

const AREA = "min-h-[72px] w-full rounded-lg bg-surface px-2.5 py-2 text-sm leading-normal text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40 max-sm:min-h-[96px]";
const kunciBaru = () => (globalThis.crypto?.randomUUID ? `pkr-kirim-${globalThis.crypto.randomUUID()}` : `pkr-kirim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
export const alasanKirimValid = (a) => String(a ?? "").trim().replace(/\s+/g, " ").length >= 5;

export function ModalKirimSebagian({ orderId, onClose, onSelesai }) {
  const [d, setD] = useState(null);
  const [pilih, setPilih] = useState([]);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kunci = useRef(kunciBaru()); // satu kunci per niat; dipakai ulang bila kirim diulang (jaringan putus) supaya tidak terbentuk job ganda
  useEffect(() => {
    let batal = false;
    api.getPkrPengirimanOrder(orderId).then((r) => { if (!batal) setD(r); }).catch((e) => { if (!batal) setGalat(e.message || "Gagal memuat unit order"); });
    return () => { batal = true; };
  }, [orderId]);
  if (!orderId) return null;
  const siap = (d?.unit ?? []).filter((u) => u.siap && !u.jobId);
  const toggle = (id) => setPilih((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function kirim() {
    setGalat(""); setSibuk(true);
    try {
      await api.kirimSebagianPkr(orderId, { unitIds: pilih, alasan: alasan.trim() }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal membuat job pengiriman sebagian"); } finally { setSibuk(false); }
  }
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()}
      title={`Kirim sebagian — ${d?.nomorOrder || "order PKR"}`}
      description="Buat SATU job pengiriman untuk unit yang sudah siap. Unit lain menyusul lewat aksi yang sama. Tidak ada job lain yang dibuat otomatis."
      className="w-[560px]"
      footer={(
        <div className="flex w-full flex-col gap-2">
          {galat && <p role="alert" className="rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="kirim-sebagian-galat">{galat}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
            <Button disabled={sibuk || pilih.length === 0 || !alasanKirimValid(alasan)} onClick={kirim} className="max-sm:min-h-11 max-sm:px-4" data-testid="aksi-kirim-sebagian">Buat Job Pengiriman</Button>
          </div>
        </div>
      )}
    >
      {!d && !galat && <p className="text-[12.5px] text-ink3" role="status">Memuat unit…</p>}
      {d && (
        <div className="space-y-4" data-testid="kirim-sebagian-isi">
          <p className="m-0 text-[12.5px] text-ink2" data-testid="kirim-sebagian-petunjuk">{d.petunjuk}</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {d.unit.map((u) => {
              const bisa = u.siap && !u.jobId;
              return (
                <li key={u.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[12.5px]">
                  <input
                    type="checkbox" className="h-4 w-4 shrink-0 max-sm:h-5 max-sm:w-5" checked={pilih.includes(u.id)} disabled={!bisa}
                    onChange={() => toggle(u.id)} aria-label={`Pilih unit ${u.unitCode}`} data-testid="pilih-unit"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-[12px] font-semibold text-ink">{u.unitCode}</span>
                    {u.itemNama ? <span className="ml-2 text-ink2">{u.itemNama}</span> : null}
                  </span>
                  {u.jobId ? <Badge variant="neutral">Sudah di job</Badge> : u.siap ? <Badge variant="green">Siap kirim</Badge> : <Badge variant="orange">Belum siap</Badge>}
                </li>
              );
            })}
          </ul>
          {siap.length === 0 && <p className="m-0 text-[12.5px] text-ink3">Belum ada unit yang siap dan belum di job pengiriman.</p>}
          <Field label="Alasan kirim sebagian" required hint="Wajib (minimal 5 karakter). Tercatat bersama unit yang dipilih dan unit yang ditunda.">
            <textarea className={AREA} value={alasan} maxLength={500} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan kirim sebagian" data-testid="kirim-sebagian-alasan" />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/** Panel ringkas di halaman Job Delivery: order PKR yang menunggu unit lain. Tidak tampil bila kosong atau pengguna tidak berhak (403 diam-diam). */
export default function PkrPengirimanPanel({ className = "" }) {
  const [daftar, setDaftar] = useState([]);
  const [aktif, setAktif] = useState(null);
  const muat = useCallback(async () => {
    try { const r = await api.getPkrPengirimanMenunggu(); setDaftar(r.menunggu || []); } catch { setDaftar([]); }
  }, []);
  useEffect(() => { muat(); }, [muat]);
  if (!daftar.length && !aktif) return null;
  return (
    <>
      {daftar.length > 0 && (
        <Card className={`space-y-2 p-3 ${className}`} data-testid="pkr-menunggu-panel">
          <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-ink"><PackageCheck size={15} /> Order Penjualan Karyawan menunggu unit lain ({daftar.length})</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {daftar.map((o) => (
              <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid="pkr-menunggu-baris">
                <span className="min-w-0">
                  <span className="font-mono font-semibold text-ink">{o.nomorOrder}</span>
                  <span className="ml-2 text-ink2">{o.ringkas.siap} dari {o.ringkas.dikirim} unit siap · menunggu {o.ringkas.menunggu}</span>
                </span>
                <Button size="sm" variant="neutral" onClick={() => setAktif(o.orderId)} className="max-sm:min-h-11" data-testid="buka-kirim-sebagian">Kirim sebagian…</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {aktif && <ModalKirimSebagian orderId={aktif} onClose={() => setAktif(null)} onSelesai={async () => { setAktif(null); await muat(); }} />}
    </>
  );
}
