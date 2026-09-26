import React, { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { api } from "@/api.js";
import { formatRupiah } from "@/utils/format.js";
import { DP_PERSEN, MAKS_ITEM, formKosong, itemKosong, hitungRingkasan, galatForm, payloadResi } from "./logika.js";

// RESI GABUNGAN — Fase 1. Satu form membuat N order/item untuk customer yang sama dalam SATU transaksi (semua atau tidak sama sekali).
// Invoice tiap item digabung otomatis (mekanisme invoice bundle yang sudah ada); item pertama menjadi invoice anchor.
// Tidak membuat pembayaran/jurnal. Produksi & Delivery tetap per order.

const inputAngka = "h-9 w-full rounded-lg bg-surface px-3 text-right text-sm tabular-nums text-ink outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40";

function BarisAngka({ label, nilai, tebal = false, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={tebal ? "text-[13px] font-semibold text-ink" : "text-[12.5px] text-ink2"}>{label}</span>
      <span className={"tabular-nums " + (tebal ? "text-[14px] font-bold" : "text-[12.5px]") + (tone === "green" ? " text-green" : " text-ink")}>{formatRupiah(nilai)}</span>
    </div>
  );
}

export default function BuatResiModal({ open, onOpenChange, customer, onDibuat }) {
  const [form, setForm] = useState(formKosong());
  const [galat, setGalat] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState(null);

  useEffect(() => { if (open) { setForm(formKosong()); setGalat(""); setHasil(null); setSibuk(false); } }, [open]);

  const ringkasan = useMemo(() => hitungRingkasan(form), [form]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setItem = (i, k, v) => setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const tambah = () => setForm((f) => (f.items.length >= MAKS_ITEM ? f : { ...f, items: [...f.items, itemKosong()] }));
  const hapus = (i) => setForm((f) => (f.items.length <= 1 ? f : { ...f, items: f.items.filter((_, idx) => idx !== i) }));

  async function simpan() {
    const g = galatForm(form);
    if (g) { setGalat(g); return; }
    setSibuk(true); setGalat("");
    try {
      const r = await api.buatResi(payloadResi(customer.id, form));
      setHasil(r);
      onDibuat?.(r);
    } catch (e) {
      setGalat(e.message || "Resi gagal dibuat");
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Modal
      open={open} onOpenChange={onOpenChange}
      title={hasil ? "Resi Gabungan dibuat" : "Buat Resi Gabungan"}
      description={hasil ? undefined : "Beberapa item untuk " + (customer?.name || "customer") + " dalam satu transaksi. Invoice digabung otomatis."}
      className="w-[720px] max-w-[96vw]"
      footer={hasil ? (
        <Button onClick={() => onOpenChange(false)} className="max-sm:min-h-11 max-sm:px-4">Selesai</Button>
      ) : (
        <>
          <Button variant="neutral" onClick={() => onOpenChange(false)} disabled={sibuk} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <Button onClick={simpan} disabled={sibuk} data-testid="simpan-resi" className="max-sm:min-h-11 max-sm:px-4">{sibuk ? "Menyimpan…" : "Buat Resi"}</Button>
        </>
      )}
    >
      {hasil ? (
        <div className="space-y-3" data-testid="hasil-resi">
          <p className="flex items-center gap-2 text-[13px] text-ink"><CheckCircle2 size={16} className="text-green" /> {hasil.orders.length} order dibuat dalam satu resi.</p>
          <div className="rounded-xl bg-inset p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink3">Invoice anchor</p>
            <p className="font-mono text-[13px] font-semibold text-ink">{hasil.anchorInvoiceNumber}</p>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Item dalam Resi</p>
            {hasil.orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-2 py-0.5 text-[12.5px]">
                <span className="min-w-0 truncate"><span className="font-mono text-ink3">{o.orderNumber}</span> · {o.nama}</span>
                <span className="shrink-0 tabular-nums">{formatRupiah(o.harga)}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-inset p-3">
            <BarisAngka label="Subtotal" nilai={hasil.ringkasan.subtotal} />
            <BarisAngka label="Ongkir Tambahan" nilai={hasil.ringkasan.ongkirTambahan} />
            <BarisAngka label="Total Resi" nilai={hasil.ringkasan.totalResi} tebal />
            <BarisAngka label={"DP " + hasil.ringkasan.dpPersen + "%"} nilai={hasil.ringkasan.dp} tone="green" />
            <BarisAngka label="Sisa pelunasan" nilai={hasil.ringkasan.sisaSetelahDp} />
          </div>
        </div>
      ) : (
        <div className="space-y-4" data-testid="form-resi">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Alamat kirim" className="sm:col-span-2"><Input value={form.alamat} onChange={(e) => set("alamat", e.target.value)} placeholder="Alamat lengkap pengiriman" /></Field>
            <Field label="Kota"><Input value={form.kota} onChange={(e) => set("kota", e.target.value)} placeholder="mis. Jakarta Selatan" /></Field>
            <Field label="Tautan lokasi"><Input value={form.tautanLokasi} onChange={(e) => set("tautanLokasi", e.target.value)} placeholder="https://maps…" /></Field>
            <Field label="Tanggal kirim"><DatePicker block placeholder="Pilih tanggal" clearLabel="Kosongkan" value={form.tanggalKirim} onChange={(v) => set("tanggalKirim", v || "")} /></Field>
            <Field label="Ongkir Tambahan" hint="Harga item sudah termasuk ongkir. Isi hanya bila ada biaya tambahan (mis. jarak jauh). Default Rp0.">
              <input type="number" inputMode="numeric" min="0" step="1" value={form.ongkirTambahan} onChange={(e) => set("ongkirTambahan", e.target.value)} className={inputAngka} aria-label="Ongkir Tambahan" />
            </Field>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ink">Item dalam Resi ({form.items.length})</p>
              <Button size="sm" variant="secondary" onClick={tambah} disabled={form.items.length >= MAKS_ITEM}><Plus size={13} /> Tambah Item</Button>
            </div>
            <div className="space-y-3">
              {form.items.map((it, i) => (
                <div key={i} className="rounded-xl bg-inset p-3" data-testid="item-resi">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-bold uppercase tracking-wide text-ink3">Item {i + 1}</span>
                    {form.items.length > 1 && (
                      <button type="button" onClick={() => hapus(i)} className="flex min-h-9 items-center gap-1 rounded-lg px-2 text-[12px] text-red hover:bg-redbg" aria-label={"Hapus item " + (i + 1)}><Trash2 size={13} /> Hapus</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Merk"><Input value={it.merk} onChange={(e) => setItem(i, "merk", e.target.value)} placeholder="mis. Sano" /></Field>
                    <Field label="Ukuran"><Input value={it.ukuran} onChange={(e) => setItem(i, "ukuran", e.target.value)} placeholder="mis. 84x195x12" /></Field>
                    <Field label="Keluhan" className="sm:col-span-2"><Input value={it.keluhan} onChange={(e) => setItem(i, "keluhan", e.target.value)} placeholder="Keluhan customer" /></Field>
                    <Field label="Nominal (Rp)" required>
                      <input type="number" inputMode="numeric" min="0" step="1" value={it.nominal} onChange={(e) => setItem(i, "nominal", e.target.value)} className={inputAngka} aria-label={"Nominal item " + (i + 1)} />
                    </Field>
                    <Field label="Jumlah unit">
                      <input type="number" inputMode="numeric" min="1" max="10" step="1" value={it.unitCount} onChange={(e) => setItem(i, "unitCount", e.target.value)} className={inputAngka} aria-label={"Jumlah unit item " + (i + 1)} />
                    </Field>
                    <Field label="Catatan" className="sm:col-span-2"><Input value={it.catatan} onChange={(e) => setItem(i, "catatan", e.target.value)} placeholder="Catatan tambahan (opsional)" /></Field>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-inset p-3" data-testid="ringkasan-resi">
            <BarisAngka label="Subtotal semua item" nilai={ringkasan.subtotal} />
            <BarisAngka label="Ongkir Tambahan" nilai={ringkasan.ongkirTambahan} />
            <BarisAngka label="Total Resi" nilai={ringkasan.totalResi} tebal />
            <BarisAngka label={"DP " + DP_PERSEN + "%"} nilai={ringkasan.dp} tone="green" />
            <BarisAngka label="Sisa pelunasan" nilai={ringkasan.sisaSetelahDp} />
            <p className="mt-1 text-[11px] text-ink3">DP {DP_PERSEN}% dihitung dari Total Resi termasuk Ongkir Tambahan. Semua item dibuat sekaligus; bila satu gagal, tidak ada yang tersimpan.</p>
          </div>

          {galat && <p role="alert" data-testid="galat-resi" className="rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">{galat}</p>}
        </div>
      )}
    </Modal>
  );
}
