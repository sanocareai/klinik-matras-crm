import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Camera, CheckCircle2, CloudOff, Eraser, Loader2, MapPin,
  Navigation, Phone, RefreshCw, Truck, Wallet, WifiOff, X,
} from "lucide-react";
import { api } from "../api.js";
import { compressImage } from "../utils/compressImage.js";
import { formatRupiah } from "../utils/format.js";
import { getQueue, removeAction } from "../utils/offlineQueue.js";
import { submitOrQueue } from "../utils/submitJobAction.js";
import { processQueue } from "../utils/syncQueue.js";
import { useDriverTracking } from "../hooks/useDriverTracking.js";
import { mapsUrl } from "@/features/armada/jobStatus.js";
import { Card } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

// Tampilan driver — daftar job HARI INI ±1 (PRD §9.3: "drivers read only
// jobs assigned to them, dated today ±1"). Backend (GET /armada/my-jobs)
// yang menegakkan batas tanggal ini, halaman ini cuma menampilkan apa
// adanya, tidak menghitung ulang.
//
// SATU TAP untuk tiap langkah — sama seperti Bengkel.jsx (D-014): mulai,
// tiba, selesai (dengan foto WAJIB), gagal (alasan + foto WAJIB, FR-D-07
// "tanpa kecuali"). Tidak ada peta, tidak ada rute — PRD §1.5 Phase 1
// sengaja manual, driver dapat link Google Maps per-stop (deep link native,
// bukan peta custom di dalam app).
//
// OFFLINE QUEUE (Phase 2) — driver sering kerja di area sinyal lemah. Setiap
// aksi (mulai/tiba/selesai/gagal/pembayaran) DICOBA LANGSUNG dulu; kalau
// gagal karena JARINGAN (bukan validasi), diantre di IndexedDB (lihat
// utils/offlineQueue.js) dan otomatis dikirim ulang begitu online lagi.
// Foto & tanda tangan TIDAK diupload saat diambil — disimpan sebagai Blob
// lokal dan baru diupload saat submit BENAR-benar berhasil terkirim (baik
// langsung maupun lewat antrean), supaya kerja driver di lapangan tidak
// pernah terhenti menunggu jaringan di tengah proses.

const STATUS_LABEL = {
  ASSIGNED: "Siap Dimulai", EN_ROUTE: "Dalam Perjalanan", ARRIVED: "Tiba di Lokasi",
  COMPLETED: "Selesai", FAILED: "Gagal",
};

// ── Kapsul foto (dipakai form Selesai & Gagal & Pembayaran) — foto disimpan
// LOKAL (File, sudah dikompres), belum diupload. Preview pakai object URL.
function PhotoCapture({ photos, setPhotos }) {
  const [busy, setBusy] = useState(false);
  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      setPhotos((p) => [...p, ...compressed]);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed
                        border-border text-sm font-medium text-ink2 hover:border-accent hover:text-accent">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        {photos.length > 0 ? `${photos.length} foto siap` : "Ambil Foto"}
        <input type="file" accept="image/*" capture="environment" multiple hidden onChange={handleFiles} disabled={busy} />
      </label>
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {photos.map((f, i) => (
            <img key={i} src={URL.createObjectURL(f)} alt="" className="h-14 w-14 rounded-md object-cover" />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tanda tangan (Phase 2) — canvas polos, TANPA library baru (CLAUDE.md:
// jangan tambah dependency tanpa bertanya). OPSIONAL, bukan syarat blocking
// untuk menyelesaikan job (lihat catatan di schema.prisma) — kalau customer
// tidak di tempat saat serah terima (titip satpam/tetangga, nyata di
// lapangan), driver tetap bisa lanjut tanpa tanda tangan. Disimpan sebagai
// Blob lokal, belum diupload — sama alasannya dengan PhotoCapture di atas.
function SignaturePad({ signatureBlob, setSignatureBlob }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [err, setErr] = useState("");

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches?.[0] || e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawingRef.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function move(e) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const { x, y } = getPos(e, canvas);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111827";
    ctx.lineTo(x, y);
    ctx.stroke();
    hasStrokeRef.current = true;
  }
  function end() {
    drawingRef.current = false;
  }

  function handleClear() {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasStrokeRef.current = false;
    setSignatureBlob(null);
    setErr("");
  }

  async function handleConfirm() {
    if (!hasStrokeRef.current) { setErr("Belum ada tanda tangan"); return; }
    setErr("");
    const canvas = canvasRef.current;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    setSignatureBlob(blob);
  }

  if (signatureBlob) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-inset px-3 py-2">
        <span className="text-xs font-medium text-ink2">Tanda tangan siap</span>
        <button type="button" className="text-xs font-medium text-accent" onClick={handleClear}>Ulangi</button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <canvas
        ref={canvasRef} width={300} height={120}
        className="w-full touch-none rounded-lg border-2 border-dashed border-border bg-white"
        onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
      />
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink2">Tanda tangan customer (opsional)</p>
        <div className="flex gap-2">
          <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-ink2" onClick={handleClear}>
            <Eraser className="h-3 w-3" /> Hapus
          </button>
          <button type="button" className="flex items-center gap-1 text-[11px] font-medium text-accent" onClick={handleConfirm}>
            Simpan
          </button>
        </div>
      </div>
      {err && <p className="text-[11px] text-red">{err}</p>}
    </div>
  );
}

const PAYMENT_METHODS = [
  { value: "CASH", label: "Tunai" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "QRIS", label: "QRIS" },
];

// ── Catat Pembayaran (D-011) — HANYA untuk job DELIVERY yang sudah selesai.
// Customer kadang bayar cash langsung ke driver saat kasur diantar; ini
// satu-satunya jejak audit kas yang ada sekarang, jadi dibuat semudah
// mungkin — jumlah + metode, foto opsional (WAJIB kalau tunai, supaya ada
// bukti serah terima uang, sama semangatnya dengan foto bukti job).
function PaymentSection({ job, onChanged, onQueued }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [justQueued, setJustQueued] = useState(false);
  const [err, setErr] = useState("");

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file).then(setPhoto);
    e.target.value = "";
  }

  async function handleSave() {
    const amountInt = parseInt(amount, 10);
    if (!amountInt || amountInt <= 0) { setErr("Jumlah wajib diisi"); return; }
    if (method === "CASH" && !photo) { setErr("Foto bukti wajib untuk pembayaran tunai"); return; }
    setBusy(true);
    setErr("");
    try {
      const { queued } = await submitOrQueue(job.id, "payment", { amount: amountInt, method }, photo ? [photo] : []);
      setOpen(false);
      setAmount(""); setMethod("CASH"); setPhoto(null);
      if (queued) {
        setJustQueued(true);
        onQueued();
      } else {
        onChanged();
      }
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {job.payments?.length > 0 && (
        <div className="mb-2 space-y-1.5">
          {job.payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg bg-inset px-3 py-2 text-xs">
              <span className="font-semibold text-ink">{formatRupiah(p.amount)}</span>
              <div className="flex items-center gap-1.5">
                <Badge variant="neutral">{PAYMENT_METHODS.find((m) => m.value === p.method)?.label || p.method}</Badge>
                {p.verifications?.length > 0 && <Badge variant="green">Terverifikasi</Badge>}
              </div>
            </div>
          ))}
        </div>
      )}

      {justQueued && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-orangebg px-3 py-2 text-xs text-orange">
          <CloudOff className="h-3.5 w-3.5 shrink-0" /> Tersimpan offline — akan terkirim otomatis
        </div>
      )}

      {!open && (
        <Button variant="neutral" className="h-10 w-full text-xs" onClick={() => { setOpen(true); setJustQueued(false); }}>
          <Wallet className="h-3.5 w-3.5" /> Catat Pembayaran
        </Button>
      )}

      {open && (
        <div className="space-y-2">
          <input
            type="number" inputMode="numeric" placeholder="Jumlah diterima (Rp)"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3 text-sm outline-none focus:border-accent"
          />
          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value} type="button" onClick={() => setMethod(m.value)}
                className={`h-9 rounded-lg border-2 text-xs font-medium ${
                  method === m.value ? "border-accent bg-accentbg text-accent" : "border-border text-ink2"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed
                            border-border text-xs font-medium text-ink2 hover:border-accent hover:text-accent">
            <Camera className="h-3.5 w-3.5" />
            {photo ? "Foto siap" : "Foto Bukti (opsional untuk non-tunai)"}
            <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} />
          </label>
          {err && <p className="text-[11px] text-red">{err}</p>}
          <div className="flex gap-2">
            <Button variant="neutral" className="h-10 flex-1 text-xs" onClick={() => { setOpen(false); setErr(""); }}>Batal</Button>
            <Button className="h-10 flex-1 text-xs" disabled={busy} onClick={handleSave}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Simpan"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const FAIL_REASONS_PICKUP = [
  { value: "Customer tidak ada di rumah", label: "Customer Tidak Ada" },
  { value: "Akses ditolak", label: "Akses Ditolak" },
  { value: "Customer menolak", label: "Customer Menolak" },
];
const FAIL_REASONS_DELIVERY = [
  { value: "Customer tidak ada di rumah", label: "Customer Tidak Ada" },
  { value: "Akses ditolak", label: "Akses Ditolak" },
  { value: "Customer minta reschedule", label: "Minta Reschedule" },
];

// ── Kartu satu job ────────────────────────────────────────────────────────
function JobCard({ job, onChanged, onQueued, pending }) {
  const [mode, setMode] = useState("idle"); // idle | completing | failing
  const [photos, setPhotos] = useState([]);
  const [signatureBlob, setSignatureBlob] = useState(null);
  const [note, setNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const customer = job.units[0]?.unit?.order?.customer;
  const maps = mapsUrl(job);
  const failReasons = job.type === "PICKUP" ? FAIL_REASONS_PICKUP : FAIL_REASONS_DELIVERY;

  function resetForm() {
    setMode("idle");
    setPhotos([]);
    setSignatureBlob(null);
    setNote("");
    setFailReason("");
  }

  async function run(action, payload, files, sig) {
    setBusy(true);
    setErr("");
    try {
      const { queued } = await submitOrQueue(job.id, action, payload, files, sig);
      resetForm();
      if (queued) onQueued(); else onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <Card className="p-4 opacity-70">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{customer?.name || "—"}</p>
            <p className="font-mono text-xs text-ink2">{job.units[0]?.unit?.order?.orderNumber}</p>
          </div>
          <Badge variant={job.type === "PICKUP" ? "accent" : "green"}>
            {job.type === "PICKUP" ? "Ambil" : "Kirim"}
          </Badge>
        </div>
        <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-orangebg px-3 py-2 text-xs text-orange">
          <CloudOff className="h-3.5 w-3.5 shrink-0" /> Menunggu sinkron — akan terkirim otomatis begitu online
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{customer?.name || "—"}</p>
          <p className="font-mono text-xs text-ink2">{job.units[0]?.unit?.order?.orderNumber}</p>
        </div>
        <Badge variant={job.type === "PICKUP" ? "accent" : "green"}>
          {job.type === "PICKUP" ? "Ambil" : "Kirim"}
        </Badge>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {job.units.map((ju) => (
          <span key={ju.id} className="rounded bg-inset px-1.5 py-0.5 font-mono text-[10px] text-ink2">
            {ju.unit.unitCode}
          </span>
        ))}
      </div>

      <div className="mt-2 space-y-1 text-xs text-ink2">
        {customer?.phone && (
          <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 text-accent">
            <Phone className="h-3 w-3" /> {customer.phone}
          </a>
        )}
        {job.addressText && (
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" /> {job.addressText}
          </p>
        )}
        {job.accessNotes && <p className="pl-[18px] italic text-ink3">{job.accessNotes}</p>}
      </div>

      {maps && mode === "idle" && (
        <a href={maps} target="_blank" rel="noreferrer"
          className="mt-2 flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accentbg text-xs font-semibold text-accent">
          <Navigation className="h-3.5 w-3.5" /> Buka di Google Maps
        </a>
      )}

      {err && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-redbg px-3 py-2 text-xs text-red">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
        </div>
      )}

      {mode === "idle" && job.status === "ASSIGNED" && (
        <Button className="mt-3 h-12 w-full text-sm" disabled={busy} onClick={() => run("start", {}, [], null)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mulai Perjalanan"}
        </Button>
      )}

      {mode === "idle" && job.status === "EN_ROUTE" && (
        <div className="mt-3 space-y-2">
          <Button className="h-12 w-full text-sm" disabled={busy} onClick={() => run("arrive", {}, [], null)}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tiba di Lokasi"}
          </Button>
          <div className="flex gap-2">
            <Button variant="neutral" className="h-11 flex-1 text-xs" onClick={() => setMode("failing")}>Gagal</Button>
            <Button className="h-11 flex-1 text-xs" onClick={() => setMode("completing")}>Selesai Langsung</Button>
          </div>
        </div>
      )}

      {mode === "idle" && job.status === "ARRIVED" && (
        <div className="mt-3 flex gap-2">
          <Button variant="neutral" className="h-12 flex-1 text-sm" onClick={() => setMode("failing")}>Gagal</Button>
          <Button className="h-12 flex-1 text-sm" onClick={() => setMode("completing")}>Selesai</Button>
        </div>
      )}

      {mode === "idle" && job.status === "COMPLETED" && (
        <>
          <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-green">
            <CheckCircle2 className="h-4 w-4" /> Selesai
            {job.signatureUrl && <span className="text-ink2">· bertanda tangan</span>}
          </div>
          {job.type === "DELIVERY" && <PaymentSection job={job} onChanged={onChanged} onQueued={onQueued} />}
        </>
      )}
      {mode === "idle" && job.status === "FAILED" && (
        <div className="mt-3 rounded-lg bg-redbg px-2.5 py-2 text-xs text-red">{job.failureReason}</div>
      )}

      {mode === "completing" && (
        <div className="mt-3 space-y-2">
          <PhotoCapture photos={photos} setPhotos={setPhotos} />
          <SignaturePad signatureBlob={signatureBlob} setSignatureBlob={setSignatureBlob} />
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)"
            className="h-14 w-full rounded-lg border border-border p-2 text-xs outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <Button variant="neutral" className="h-11 flex-1 text-xs" onClick={() => setMode("idle")}>Batal</Button>
            <Button
              className="h-11 flex-1 text-xs" disabled={busy || photos.length === 0}
              onClick={() => run("complete", { note }, photos, signatureBlob)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Simpan"}
            </Button>
          </div>
          {photos.length === 0 && <p className="text-center text-[11px] text-ink2">Foto bukti wajib diisi</p>}
        </div>
      )}

      {mode === "failing" && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-1 gap-2">
            {failReasons.map((r) => (
              <button
                key={r.value} type="button" onClick={() => setFailReason(r.value)}
                className={`h-11 rounded-lg border-2 px-3 text-left text-xs font-medium ${
                  failReason === r.value ? "border-accent bg-accentbg text-accent" : "border-border text-ink2"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <PhotoCapture photos={photos} setPhotos={setPhotos} />
          <div className="flex gap-2">
            <Button variant="neutral" className="h-11 flex-1 text-xs" onClick={() => setMode("idle")}>Batal</Button>
            <Button
              variant="destructive" className="h-11 flex-1 text-xs"
              disabled={busy || !failReason || photos.length === 0}
              onClick={() => run("fail", { failureReason: failReason, note }, photos, null)}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tandai Gagal"}
            </Button>
          </div>
          {(!failReason || photos.length === 0) && (
            <p className="text-center text-[11px] text-ink2">Alasan dan foto wajib diisi (tanpa kecuali)</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Bar status sinkron (Phase 2) — online/offline + jumlah aksi menunggu +
// sinkron manual. Muncul terus (bukan cuma pas offline) supaya driver tahu
// PASTI kalau ada aksi yang belum benar-benar sampai ke server, bukan
// diam-diam mengira semua sudah tersimpan.
function SyncBar({ queueCount, syncing, offline, onSyncNow }) {
  if (queueCount === 0 && !offline) return null;
  return (
    <div className={`mb-3 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
      offline ? "bg-redbg text-red" : "bg-orangebg text-orange"
    }`}>
      <div className="flex items-center gap-1.5">
        {offline ? <WifiOff className="h-3.5 w-3.5" /> : <CloudOff className="h-3.5 w-3.5" />}
        {offline
          ? `Tidak ada koneksi${queueCount > 0 ? ` — ${queueCount} aksi menunggu` : ""}`
          : `${queueCount} aksi menunggu dikirim`}
      </div>
      {!offline && queueCount > 0 && (
        <button type="button" onClick={onSyncNow} disabled={syncing} className="flex items-center gap-1 underline">
          {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Kirim Sekarang
        </button>
      )}
    </div>
  );
}

export default function DriverJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  const load = useCallback(async () => {
    try {
      const r = await api.getMyJobs();
      setJobs(r.jobs);
      setError("");
    } catch (e) {
      // SENGAJA TIDAK menimpa `jobs` yang sudah ada — kalau driver offline
      // dan reload gagal, daftar job TERAKHIR yang berhasil dimuat tetap
      // tampil (lebih berguna daripada layar error kosong di lapangan).
      // Hanya tampilkan error kalau memang belum pernah berhasil sama sekali.
      if (!jobs) setError(e.message);
    }
  }, [jobs]);

  const refreshQueue = useCallback(async () => {
    setQueue(await getQueue());
  }, []);

  const syncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await processQueue();
    } finally {
      await refreshQueue();
      setSyncing(false);
      load();
    }
  }, [refreshQueue, load]);

  useEffect(() => { load(); refreshQueue(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // D-034 — Live Tracking nyata: kirim ping GPS selama ADA job berstatus
  // EN_ROUTE. Tidak melakukan apa pun (tidak minta izin lokasi sekalipun)
  // kalau tidak ada job yang sedang berjalan — lihat catatan di hook.
  useDriverTracking(jobs);

  useEffect(() => {
    function handleOnline() { setOffline(false); syncNow(); }
    function handleOffline() { setOffline(true); }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    // Fallback: event 'online' tidak selalu terpicu di semua browser mobile
    // (mis. WiFi menyala tapi tanpa internet asli, lalu pulih) — polling
    // ringan tiap 30 detik menjaga antrean tidak macet selamanya.
    const interval = setInterval(() => { if (navigator.onLine) syncNow(); }, 30_000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [syncNow]);

  async function handleDismissFailed(id) {
    await removeAction(id);
    await refreshQueue();
  }

  if (error) {
    return (
      <div className="py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-red" />
        <p className="text-sm text-ink2">{error}</p>
      </div>
    );
  }
  if (!jobs) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink2">
        <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-sm">Memuat job…</span>
      </div>
    );
  }

  const pendingJobIds = new Set(queue.map((q) => q.jobId));
  const failedEntries = queue.filter((q) => q.lastError);

  return (
    <div>
      <SyncBar queueCount={queue.length} syncing={syncing} offline={offline} onSyncNow={syncNow} />

      {failedEntries.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {failedEntries.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-redbg px-3 py-2 text-xs text-red">
              <span className="min-w-0 flex-1">Gagal kirim aksi "{f.action}": {f.lastError}</span>
              <button type="button" onClick={() => handleDismissFailed(f.id)} className="shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {jobs.length === 0 ? (
        <Card className="p-8 text-center">
          <Truck className="mx-auto mb-3 h-10 w-10 text-ink2" strokeWidth={1.5} />
          <h3 className="text-base font-semibold text-ink">Tidak ada job hari ini</h3>
          <p className="mt-1 text-sm text-ink2">Job baru akan muncul di sini begitu dispatcher menugaskan.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <JobCard
              key={job.id} job={job} onChanged={load} onQueued={refreshQueue}
              pending={pendingJobIds.has(job.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
