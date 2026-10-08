// Checklist Persiapan Perjalanan — BUILDER admin/dispatcher (Route Planner).
// Dibuka dari RouteCard. Susun/edit item (ROUTE_WRITE di backend), lihat
// progres + bukti driver. Setelah rute berangkat (prepChecklistLockedAt
// terisi), modal ini jadi READ-ONLY murni — checklist keberangkatan sudah
// dibekukan (lihat catatan panjang POST /routes/:id/start di armada.js).
import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { customerOf, orderOf } from "../jobStatus.js";

const KOSONG_FORM = { title: "", detail: "", quantity: "", scope: "ROUTE", jobId: "", required: true, photoRequired: true };

function ItemBaris({ item, locked, onEdited, onArchived }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({ title: item.title, detail: item.detail || "", quantity: item.quantity ?? "", required: item.required, photoRequired: item.photoRequired });

  async function simpan() {
    setBusy(true); setErr("");
    try {
      await onEdited(item.id, {
        title: form.title, detail: form.detail || null,
        quantity: form.quantity === "" ? null : Number(form.quantity),
        required: form.required, photoRequired: form.photoRequired,
      });
      setEditing(false);
    } catch (e) {
      setErr(e.message || "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  }

  async function hapus() {
    if (!window.confirm(`Hapus item "${item.title}" dari checklist aktif?`)) return;
    setBusy(true); setErr("");
    try { await onArchived(item.id); } catch (e) { setErr(e.message || "Gagal menghapus"); } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="space-y-1.5 rounded-lg border border-accent/40 p-2.5">
        <input className="h-8 w-full rounded-md border border-border bg-transparent px-2 text-xs" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Judul" />
        <textarea className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs" rows={2} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} placeholder="Detail instruksi (opsional)" />
        <div className="flex items-center gap-3">
          <input type="number" min="0" className="h-8 w-24 rounded-md border border-border bg-transparent px-2 text-xs" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="Jumlah" />
          <label className="flex items-center gap-1 text-[11px] text-ink2"><input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} /> Wajib sebelum berangkat</label>
          <label className="flex items-center gap-1 text-[11px] text-ink2"><input type="checkbox" checked={form.photoRequired} onChange={(e) => setForm((f) => ({ ...f, photoRequired: e.target.checked }))} /> Foto wajib</label>
        </div>
        {err && <p className="text-[11px] text-red">{err}</p>}
        <div className="flex gap-1.5">
          <Button variant="neutral" className="h-7 flex-1 text-[11px]" disabled={busy} onClick={() => setEditing(false)}>Batal</Button>
          <Button className="h-7 flex-1 text-[11px]" disabled={busy || !form.title.trim()} onClick={simpan}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Simpan"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border p-2.5 ${item.terpenuhi ? "border-green/40 bg-green/5" : "border-border"}`}>
      <div className="flex items-start gap-2">
        {item.terpenuhi ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink3" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {item.title}
            {item.required && <span className="ml-1 text-[10px] font-bold text-red">WAJIB</span>}
            {item.photoRequired && <span className="ml-1 text-[10px] text-ink3">· foto wajib</span>}
          </p>
          {item.detail && <p className="mt-0.5 text-xs text-ink2">{item.detail}</p>}
          {item.quantity != null && <p className="mt-0.5 text-[11px] text-ink3">Jumlah: {item.quantity}</p>}
          {item.scope === "STOP" && <p className="mt-0.5 text-[11px] text-ink3">Stop: {item.customerName || "—"}{item.orderNumber ? ` (${item.orderNumber})` : ""}</p>}
          {item.bukti && (
            <div className="mt-1.5 flex items-center gap-2">
              {item.bukti.photoUrl && (
                <a href={item.bukti.photoUrl} target="_blank" rel="noreferrer">
                  <img src={item.bukti.photoUrl} alt="Bukti driver" className="h-12 w-12 rounded-md object-cover" />
                </a>
              )}
              <p className="text-[10.5px] text-ink3">
                {item.bukti.uploadedByName || "Driver"} · {new Date(item.bukti.createdAt).toLocaleString("id-ID")}
                {item.bukti.note && ` — "${item.bukti.note}"`}
              </p>
            </div>
          )}
          {item.buktiBasi && <p className="mt-1 text-[11px] font-medium text-orange">Bukti lama (instruksi sudah diedit) — menunggu unggah ulang driver.</p>}
        </div>
        {!locked && (
          <div className="flex shrink-0 gap-1">
            <button type="button" className="text-ink3 hover:text-accent" onClick={() => setEditing(true)} title="Edit">Edit</button>
            <button type="button" className="text-ink3 hover:text-red" onClick={hapus} disabled={busy} title="Hapus"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
      {err && <p className="mt-1 text-[11px] text-red">{err}</p>}
    </div>
  );
}

export default function RoutePrepChecklistAdminModal({ route, open, onOpenChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [form, setForm] = useState(KOSONG_FORM);
  const [addBusy, setAddBusy] = useState(false);

  const load = useCallback(async () => {
    setErr("");
    try { setData(await api.getRoutePrepChecklist(route.id)); }
    catch (e) { setErr(e.message || "Gagal memuat checklist"); }
    finally { setLoading(false); }
  }, [route.id]);

  useEffect(() => { if (open) { setLoading(true); load(); } }, [open, load]);

  const locked = Boolean(data?.lockedAt);

  async function tambahItem() {
    setAddBusy(true); setErr("");
    try {
      await api.addRoutePrepChecklistItem(route.id, {
        title: form.title.trim(), detail: form.detail.trim() || null,
        quantity: form.quantity === "" ? null : Number(form.quantity),
        scope: form.scope, jobId: form.scope === "STOP" ? form.jobId : null,
        required: form.required, photoRequired: form.photoRequired,
        expectedRevision: data.revision,
      });
      setForm(KOSONG_FORM);
      await load();
    } catch (e) {
      setErr(e.message || "Gagal menambah item");
    } finally {
      setAddBusy(false);
    }
  }

  async function editItem(itemId, patch) {
    await api.updateRoutePrepChecklistItem(route.id, itemId, { ...patch, expectedRevision: data.revision });
    await load();
  }

  async function archiveItem(itemId) {
    await api.updateRoutePrepChecklistItem(route.id, itemId, { archived: true, expectedRevision: data.revision });
    await load();
  }

  const stops = (route.jobs || []).map((j) => ({ id: j.id, label: `${customerOf(j) || "—"}${orderOf(j)?.orderNumber ? ` (${orderOf(j).orderNumber})` : ""}` }));

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Checklist Persiapan — Rute ${route.code}`}
      description="Item yang ditandai wajib harus dilengkapi driver (foto/tanda selesai) sebelum tombol Mulai Perjalanan aktif."
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-ink2"><Loader2 className="h-4 w-4 animate-spin" /> Memuat…</div>
      ) : (
        <div className="space-y-3">
          {locked && (
            <div className="flex items-center gap-2 rounded-lg bg-orange/10 px-3 py-2 text-[11.5px] font-medium text-orange">
              <Lock className="h-3.5 w-3.5 shrink-0" /> Rute sudah berangkat — checklist keberangkatan dibekukan (tidak bisa diedit lagi).
            </div>
          )}
          {err && <p className="text-xs text-red">{err}</p>}

          <div className="space-y-2">
            {data.items.length === 0 ? (
              <p className="text-xs text-ink3">Belum ada item checklist untuk rute ini.</p>
            ) : (
              data.items.map((item) => (
                <ItemBaris key={item.id} item={item} locked={locked} onEdited={editItem} onArchived={archiveItem} />
              ))
            )}
          </div>

          {!locked && (
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
              <p className="text-xs font-bold text-ink2">Tambah Item</p>
              <input className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-xs" placeholder="Judul (mis. Plastik pembungkus, Tali pengikat, Kaki/roda kasur)" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
              <textarea className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs" rows={2} placeholder="Detail instruksi untuk driver (opsional)" value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} />
              <div className="flex flex-wrap items-center gap-3">
                <input type="number" min="0" className="h-9 w-24 rounded-md border border-border bg-transparent px-2 text-xs" placeholder="Jumlah" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
                <select className="h-9 rounded-md border border-border bg-transparent px-2 text-xs" value={form.scope} onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value, jobId: "" }))}>
                  <option value="ROUTE">Seluruh rute</option>
                  <option value="STOP">Satu order/stop</option>
                </select>
                {form.scope === "STOP" && (
                  <select className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-xs" value={form.jobId} onChange={(e) => setForm((f) => ({ ...f, jobId: e.target.value }))}>
                    <option value="">Pilih stop…</option>
                    {stops.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-[11px] text-ink2"><input type="checkbox" checked={form.required} onChange={(e) => setForm((f) => ({ ...f, required: e.target.checked }))} /> Wajib sebelum berangkat</label>
                <label className="flex items-center gap-1 text-[11px] text-ink2"><input type="checkbox" checked={form.photoRequired} onChange={(e) => setForm((f) => ({ ...f, photoRequired: e.target.checked }))} /> Foto wajib</label>
              </div>
              <Button
                className="h-9 w-full text-xs"
                disabled={addBusy || !form.title.trim() || (form.scope === "STOP" && !form.jobId)}
                onClick={tambahItem}
              >
                {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Plus className="mr-1 h-3.5 w-3.5 inline" /> Tambah Item</>}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
