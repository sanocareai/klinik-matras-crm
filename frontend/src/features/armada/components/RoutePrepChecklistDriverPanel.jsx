// Checklist Persiapan Perjalanan — sisi DRIVER (web). Dipakai di
// DriverJobs.jsx (RouteStartBanner) SEBELUM tombol "Mulai Perjalanan" bisa
// ditekan — gerbang SEBENARNYA ada di backend (POST /routes/:id/start,
// 409 CHECKLIST_BELUM_LENGKAP), panel ini murni supaya driver tahu APA yang
// kurang tanpa harus menebak dari error mentah. Padanan driver-mobile:
// src/screens/PersiapanPerjalananScreen.js (pola sama, beda platform).
import React, { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/api.js";
import { compressImage } from "@/utils/compressImage.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";

function ItemRow({ item, routeId, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  async function kirim(file) {
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      if (file) fd.append("photo", await compressImage(file), "foto.jpg");
      if (note.trim()) fd.append("note", note.trim());
      await api.submitRoutePrepChecklistProof(routeId, item.id, fd);
      setNote("");
      onUploaded();
    } catch (e) {
      setErr(e.message || "Gagal mengirim bukti");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await kirim(file);
  }

  return (
    <div className={`rounded-lg border p-2.5 ${item.terpenuhi ? "border-green/40 bg-green/5" : "border-border"}`}>
      <div className="flex items-start gap-2">
        {item.terpenuhi ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />
        ) : (
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink3" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {item.title}
            {item.required && <span className="ml-1 text-[10px] font-bold text-red">WAJIB</span>}
          </p>
          {item.detail && <p className="mt-0.5 text-xs text-ink2">{item.detail}</p>}
          {item.quantity != null && <p className="mt-0.5 text-[11px] text-ink3">Jumlah: {item.quantity}</p>}
          {item.customerName && <p className="mt-0.5 text-[11px] text-ink3">Stop: {item.customerName}{item.orderNumber ? ` (${item.orderNumber})` : ""}</p>}
          {item.buktiBasi && (
            <p className="mt-1 text-[11px] font-medium text-orange">Instruksi diperbarui admin — bukti lama tidak berlaku, unggah ulang.</p>
          )}
        </div>
      </div>

      {!item.terpenuhi && (
        <div className="mt-2 space-y-1.5">
          {item.photoRequired ? (
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs font-medium text-ink2 hover:border-accent hover:text-accent">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              Ambil / Pilih Foto
              <input type="file" accept="image/*" hidden onChange={handleFile} disabled={busy} />
            </label>
          ) : (
            <div className="flex gap-1.5">
              <input
                type="text" value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan (opsional)" disabled={busy}
                className="h-9 flex-1 rounded-md border border-border bg-transparent px-2 text-xs"
              />
              <Button className="h-9 px-3 text-xs" disabled={busy} onClick={() => kirim(null)}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Selesai"}
              </Button>
            </div>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-red">{err}</p>}
    </div>
  );
}

// Bukti Kelengkapan Standar (7 Okt 2026, permintaan owner) — TERPISAH dari
// item checklist admin di atas: SELALU wajib minimal 1 foto, TIDAK
// bergantung admin menyusun apa pun (lihat evaluateChecklistGate di
// backend). Maksimal 2 foto; catatan bebas opsional (mis. "plastik 2
// gulung, tali rafia, kunci L"). Submit ulang MENIMPA seluruh set.
const MAX_KELENGKAPAN_FOTO = 2;

// Object URL dibuat lewat efek (bukan langsung di JSX, yang bikin blob baru
// tiap render tanpa pernah dilepas — lihat tests/architecture.test.js
// "cleanup: tiap file yang membuat object URL juga melepasnya") dan dilepas
// saat `files` berubah atau komponen unmount.
function useObjectUrls(files) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

function KelengkapanSection({ routeId, kelengkapan, locked, onSubmitted }) {
  const [files, setFiles] = useState([]);
  const previewUrls = useObjectUrls(files);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const sudahKirim = (kelengkapan?.photoUrls?.length || 0) > 0;

  function pickFile(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setFiles((prev) => [...prev, f].slice(0, MAX_KELENGKAPAN_FOTO));
  }
  function removeFile(i) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function kirim() {
    if (files.length === 0) { setErr("Foto wajib diisi (minimal 1)"); return; }
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      for (const f of files) fd.append("photos", await compressImage(f), "foto.jpg");
      if (note.trim()) fd.append("note", note.trim());
      await api.submitRouteKelengkapan(routeId, fd);
      setFiles([]); setNote("");
      onSubmitted();
    } catch (e) {
      setErr(e.message || "Gagal mengirim bukti kelengkapan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-lg border p-2.5 ${sudahKirim ? "border-green/40 bg-green/5" : "border-accent/40"}`}>
      <div className="flex items-start gap-2">
        {sudahKirim ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green" />
        ) : (
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink3" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            Bukti Kelengkapan<span className="ml-1 text-[10px] font-bold text-red">WAJIB</span>
          </p>
          <p className="mt-0.5 text-xs text-ink2">Foto plastik/tali/tools/dll yang dibawa (1–2 foto) + catatan apa saja yang dibawa.</p>
          {sudahKirim && kelengkapan.note && <p className="mt-1 text-[11px] text-ink3">Catatan: {kelengkapan.note}</p>}
        </div>
      </div>

      {!locked && (
        <div className="mt-2 space-y-1.5">
          {(files.length > 0 || sudahKirim) && (
            <div className="flex gap-1.5">
              {files.map((f, i) => (
                <div key={i} className="relative h-12 w-12 overflow-hidden rounded border border-border">
                  <img src={previewUrls[i]} className="h-full w-full object-cover" alt="" />
                  <button type="button" onClick={() => removeFile(i)} className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-[10px] leading-4 text-white">×</button>
                </div>
              ))}
              {files.length === 0 && sudahKirim && kelengkapan.photoUrls.map((url) => (
                <img key={url} src={url} className="h-12 w-12 rounded border border-border object-cover" alt="" />
              ))}
            </div>
          )}
          {files.length < MAX_KELENGKAPAN_FOTO && (
            <label className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs font-medium text-ink2 hover:border-accent hover:text-accent">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              {files.length === 0 ? (sudahKirim ? "Ganti Foto" : "Ambil / Pilih Foto") : "Tambah Foto Kedua (opsional)"}
              <input type="file" accept="image/*" hidden onChange={pickFile} disabled={busy} />
            </label>
          )}
          {files.length > 0 && (
            <>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Catatan (opsional) — mis. bawa plastik 2 gulung, tali rafia, kunci L"
                disabled={busy} rows={2}
                className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs"
              />
              <Button className="h-9 w-full text-xs" disabled={busy} onClick={kirim}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sudahKirim ? "Kirim Ulang" : "Kirim"}
              </Button>
            </>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-[11px] text-red">{err}</p>}
    </div>
  );
}

// onReadyChange(siap: boolean) dipanggil setiap kali status gerbang lokal
// berubah — parent (RouteStartBanner) pakai ini HANYA untuk UX (nonaktifkan
// tombol lebih awal supaya tidak perlu bulak-balik ke server); backend
// TETAP yang menegakkan gerbang sesungguhnya. Panel SELALU dirender (tidak
// lagi return null kalau item admin kosong) — Bukti Kelengkapan selalu wajib
// terlepas dari apakah admin menyusun item checklist untuk rute ini.
export default function RoutePrepChecklistDriverPanel({ routeId, onReadyChange }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const res = await api.getRoutePrepChecklist(routeId);
      setData(res);
      const butuh = res.items.filter((i) => i.required);
      const kelengkapanSiap = (res.kelengkapan?.photoUrls?.length || 0) > 0;
      onReadyChange?.(kelengkapanSiap && butuh.every((i) => i.terpenuhi));
    } catch (e) {
      setErr(e.message || "Gagal memuat checklist");
    } finally {
      setLoading(false);
    }
  }, [routeId, onReadyChange]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-ink2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat checklist persiapan…
      </div>
    );
  }
  if (err) return <p className="py-2 text-xs text-red">{err}</p>;
  if (!data) return null;

  const kelengkapanSiap = (data.kelengkapan?.photoUrls?.length || 0) > 0;
  const belum = data.items.filter((i) => i.required && !i.terpenuhi).length + (kelengkapanSiap ? 0 : 1);

  return (
    <Card className="mb-2 border-accent/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-ink2">Checklist Persiapan Perjalanan</p>
        <button type="button" onClick={load} className="text-ink3 hover:text-accent">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      {belum > 0 && (
        <p className="mt-1 text-[11px] font-medium text-orange">{belum} item wajib belum lengkap — lengkapi sebelum berangkat.</p>
      )}
      <div className="mt-2 space-y-2">
        <KelengkapanSection routeId={routeId} kelengkapan={data.kelengkapan} locked={Boolean(data.lockedAt)} onSubmitted={load} />
        {data.items.map((item) => (
          <ItemRow key={item.id} item={item} routeId={routeId} onUploaded={load} />
        ))}
      </div>
    </Card>
  );
}
