import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, GitMerge } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";

// GABUNGKAN ORDER DUPLIKAT (Admin/Owner). Alur: pilih kandidat → pratinjau bukti + hambatan + dampak → alasan (≥5) → gabungkan. Order duplikat TIDAK dihapus:
// hanya diberi relasi "digabungkan ke order utama"; unit/job/POD/pembayaran/jurnal tidak dipindah. Dua job aktif = diblokir (pilih job yang dipertahankan lebih dulu).
const kunciBaru = () => (globalThis.crypto?.randomUUID ? `gabung-${globalThis.crypto.randomUUID()}` : `gabung-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const idr = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
const BUKTI = [["customerAtauTeleponSama", "Customer/HP sama"], ["barangSerupa", "Barang serupa"], ["konteksPkr", "Konteks Penjualan Karyawan"]];

function KartuOrder({ judul, o }) {
  return (
    <div className="min-w-0 rounded-lg border border-line p-3 text-[12.5px]" data-testid={`gabung-${judul.toLowerCase()}`}>
      <p className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">{judul}</p>
      <p className="m-0 mt-0.5 break-all font-mono text-[12px] font-semibold text-ink">{o.nomor}</p>
      <p className="m-0 truncate text-ink">{o.customer.nama} <span className="text-ink3">· {o.customer.telepon || "tanpa HP"}</span></p>
      <p className="m-0 mt-1 text-ink2">{o.unit.length} unit{o.pkr ? ` · PKR ${o.pkr.nomor} · dijual oleh ${o.pkr.penjual}` : ` · Sales lead: ${o.customer.salesLead || "—"}`}</p>
      <p className="m-0 text-ink2">Pembayaran: {o.pembayaran.jumlah} ({idr(o.pembayaran.total)}) · Nilai {idr(o.nilai)}</p>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-ink3">
        {o.job.length === 0 && <li>Belum ada job pengiriman</li>}
        {o.job.map((j) => <li key={j.id}>{j.tipe === "DELIVERY" ? "Pengiriman" : "Pengambilan"} · {j.status}{j.rute ? ` · ${j.rute}` : ""}{j.punyaFotoBukti ? " · ada foto bukti" : ""}{j.aktif ? " · AKTIF" : ""}</li>)}
      </ul>
    </div>
  );
}

export function GabungOrderDialog({ order, onClose, onSelesai }) {
  const [kandidat, setKandidat] = useState(null);
  const [pilih, setPilih] = useState(null);
  const [pra, setPra] = useState(null);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState("");
  const [memuat, setMemuat] = useState(false);
  const kunci = useRef(kunciBaru());

  useEffect(() => {
    let batal = false;
    api.getKandidatDuplikatOrder(order.id).then((r) => { if (!batal) { setKandidat(r.kandidat ?? []); if ((r.kandidat ?? []).length === 1) setPilih(r.kandidat[0].duplikat.id); } })
      .catch((e) => !batal && setGalat(e.message || "Gagal memuat kandidat"));
    return () => { batal = true; };
  }, [order.id]);
  useEffect(() => {
    if (!pilih) { setPra(null); return undefined; }
    let batal = false; setMemuat(true); setGalat("");
    kunci.current = kunciBaru();
    api.pratinjauGabungOrder(order.id, pilih).then((r) => !batal && setPra(r)).catch((e) => !batal && setGalat(e.message || "Gagal membuat pratinjau")).finally(() => !batal && setMemuat(false));
    return () => { batal = true; };
  }, [pilih, order.id]);

  async function gabungkan() {
    setMemuat(true); setGalat("");
    try {
      await api.gabungkanOrder({ utama: order.id, duplikat: pilih, alasan: alasan.trim(), sidikJari: pra.sidikJari }, kunci.current);
      await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menggabungkan order"); } finally { setMemuat(false); }
  }

  return (
    <Modal
      open onOpenChange={(o) => !o && onClose?.()}
      title={`Gabungkan Order Duplikat — ${order.orderNumber}`}
      description="Order duplikat tidak dihapus: ia ditandai digabungkan ke order utama. Unit, job, POD, pembayaran, invoice, dan jurnal tidak dipindah dan tidak berlipat."
      className="w-[820px] max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!rounded-none"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {galat && <p role="alert" className="mr-auto rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="galat-gabung">{galat}</p>}
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <Button disabled={!pra?.bolehDigabung || alasan.trim().length < 5 || memuat} onClick={gabungkan} className="max-sm:min-h-11 max-sm:px-4" data-testid="gabung-terapkan">
            <GitMerge size={14} aria-hidden="true" /> {memuat ? "Memproses…" : "Gabungkan Order"}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        {!kandidat && !galat && <p className="m-0 text-[13px] text-ink3">Mencari kandidat duplikat…</p>}
        {kandidat && kandidat.length === 0 && (
          <p className="m-0 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2" data-testid="gabung-tanpa-kandidat">
            Tidak ada kandidat duplikat. Kandidat hanya muncul bila customer/HP sama dan bukan order Penjualan Karyawan lain — nama yang sama saja tidak cukup.
          </p>
        )}
        {kandidat && kandidat.length > 0 && (
          <div className="space-y-1.5" role="radiogroup" aria-label="Order duplikat">
            {kandidat.map((k) => (
              <label key={k.duplikat.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] ${pilih === k.duplikat.id ? "border-accent bg-accentbg" : "border-line bg-surface"}`}>
                <input type="radio" name="duplikat" checked={pilih === k.duplikat.id} onChange={() => setPilih(k.duplikat.id)} className="mt-0.5 accent-[var(--accent)]" />
                <span className="min-w-0"><strong className="font-mono text-ink">{k.duplikat.nomor}</strong> <span className="text-ink3">· {k.duplikat.unit.length} unit · {k.duplikat.status}</span>
                  {!k.bolehDigabung && <Badge variant="orange" className="ml-1.5">Ada hambatan</Badge>}</span>
              </label>
            ))}
          </div>
        )}

        {pra && (
          <div className="space-y-3" data-testid="gabung-pratinjau">
            <div className="grid gap-3 sm:grid-cols-2">
              <KartuOrder judul="Utama" o={pra.utama} />
              <KartuOrder judul="Duplikat" o={pra.duplikat} />
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-[12px]" data-testid="gabung-bukti">
              {BUKTI.map(([k, label]) => (
                <li key={k}><Badge variant={pra.bukti[k] ? "green" : "orange"}>{pra.bukti[k] ? "✓" : "✗"} {label}</Badge></li>
              ))}
              <li><Badge variant="neutral">Nama sama: {pra.bukti.namaSama ? "ya (bukan bukti)" : "tidak"}</Badge></li>
            </ul>
            {pra.hambatan.length > 0 && (
              <ul className="m-0 list-none space-y-1 rounded-lg bg-orangebg p-3 text-[12.5px] text-orange" role="alert" data-testid="gabung-hambatan">
                {pra.hambatan.map((h) => <li key={h.kode}><AlertTriangle size={13} className="mr-1 inline" aria-hidden="true" />{h.pesan}</li>)}
              </ul>
            )}
            {pra.peringatan.length > 0 && (
              <ul className="m-0 list-none space-y-1 rounded-lg bg-inset p-3 text-[12.5px] text-ink2" data-testid="gabung-peringatan">
                {pra.peringatan.map((t) => <li key={t}>• {t}</li>)}
              </ul>
            )}
            {pra.bolehDigabung && (
              <div className="space-y-2 rounded-lg border border-line p-3 text-[12.5px]" data-testid="gabung-dampak">
                <p className="m-0 font-semibold text-ink"><CheckCircle2 size={13} className="mr-1 inline text-green" aria-hidden="true" />Dampak</p>
                <ul className="m-0 list-none space-y-0.5 p-0 text-ink2">{pra.dampak.perubahan.map((t) => <li key={t}>• {t}</li>)}</ul>
                <p className="m-0 text-ink3">Tidak dibuat/dihapus/dipindah: unit, job, route, POD, Payment, invoice, jurnal, order.</p>
              </div>
            )}
            <Field label="Alasan penggabungan" required hint="Minimal 5 karakter — tercatat bersama pelaku dan keadaan sebelum/sesudah">
              <Input value={alasan} onChange={(e) => setAlasan(e.target.value)} aria-label="Alasan penggabungan" placeholder="mis. Duplikat workaround Admin saat integrasi PKR–Delivery belum benar" />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
