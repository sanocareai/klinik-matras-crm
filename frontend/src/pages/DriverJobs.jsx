import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Camera, CheckCircle2, Eraser, Loader2, MapPin, Navigation, Phone, Truck, Wallet, X,
} from "lucide-react";
import { api } from "../api.js";
import { compressImage } from "../utils/compressImage.js";
import { formatRupiah } from "../utils/format.js";
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

const STATUS_LABEL = {
  ASSIGNED: "Siap Dimulai", EN_ROUTE: "Dalam Perjalanan", ARRIVED: "Tiba di Lokasi",
  COMPLETED: "Selesai", FAILED: "Gagal",
};

function mapsUrl(job) {
  if (job.lat && job.lng) return `https://www.google.com/maps/dir/?api=1&destination=${job.lat},${job.lng}`;
  if (job.addressText) return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.addressText)}`;
  return null;
}

// ── Kapsul foto (dipakai form Selesai & Gagal) ───────────────────────────
function PhotoCapture({ jobId, photos, setPhotos }) {
  const [busy, setBusy] = useState(false);
  async function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const compressed = await Promise.all(files.map((f) => compressImage(f)));
      const fd = new FormData();
      compressed.forEach((f) => fd.append("photos", f));
      const { urls } = await api.uploadJobPhotos(jobId, fd);
      setPhotos((p) => [...p, ...urls]);
    } catch (err) {
      alert("Gagal upload foto: " + err.message);
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
          {photos.map((u) => <img key={u} src={u} alt="" className="h-14 w-14 rounded-md object-cover" />)}
        </div>
      )}
    </div>
  );
}

// ── Tanda tangan (Phase 2) — canvas polos, TANPA library baru (CLAUDE.md:
// jangan tambah dependency tanpa bertanya). OPSIONAL, bukan syarat blocking
// untuk menyelesaikan job (lihat catatan di schema.prisma) — kalau customer
// tidak di tempat saat serah terima (titip satpam/tetangga, nyata di
// lapangan), driver tetap bisa lanjut tanpa tanda tangan.
function SignaturePad({ jobId, signatureUrl, setSignatureUrl }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);
  const [uploading, setUploading] = useState(false);
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
    setSignatureUrl(null);
    setErr("");
  }

  async function handleSave() {
    if (!hasStrokeRef.current) { setErr("Belum ada tanda tangan"); return; }
    setUploading(true);
    setErr("");
    try {
      const canvas = canvasRef.current;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      const file = new File([blob], "signature.png", { type: "image/png" });
      const fd = new FormData();
      fd.append("photos", file);
      const { urls } = await api.uploadJobPhotos(jobId, fd);
      setSignatureUrl(urls[0]);
    } catch (e2) {
      setErr("Gagal simpan tanda tangan: " + e2.message);
    } finally {
      setUploading(false);
    }
  }

  if (signatureUrl) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-inset px-3 py-2">
        <span className="text-xs font-medium text-ink2">Tanda tangan tersimpan</span>
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
          <button type="button" disabled={uploading} className="flex items-center gap-1 text-[11px] font-medium text-accent" onClick={handleSave}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Simpan"}
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
function PaymentSection({ job, onChanged }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [err, setErr] = useState("");

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("photos", compressed);
      const { urls } = await api.uploadJobPhotos(job.id, fd);
      setPhoto(urls[0]);
    } catch (e2) {
      setErr("Gagal upload foto: " + e2.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  }

  async function handleSave() {
    const amountInt = parseInt(amount, 10);
    if (!amountInt || amountInt <= 0) { setErr("Jumlah wajib diisi"); return; }
    if (method === "CASH" && !photo) { setErr("Foto bukti wajib untuk pembayaran tunai"); return; }
    setBusy(true);
    setErr("");
    try {
      await api.recordJobPayment(job.id, { amount: amountInt, method, proofPhotoUrl: photo });
      setOpen(false);
      setAmount(""); setMethod("CASH"); setPhoto(null);
      onChanged();
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

      {!open && (
        <Button variant="neutral" className="h-10 w-full text-xs" onClick={() => setOpen(true)}>
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
            {uploadingPhoto ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            {photo ? "Foto tersimpan" : "Foto Bukti (opsional untuk non-tunai)"}
            <input type="file" accept="image/*" capture="environment" hidden onChange={handlePhoto} disabled={uploadingPhoto} />
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
function JobCard({ job, onChanged }) {
  const [mode, setMode] = useState("idle"); // idle | completing | failing
  const [photos, setPhotos] = useState([]);
  const [signatureUrl, setSignatureUrl] = useState(null);
  const [note, setNote] = useState("");
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const customer = job.units[0]?.unit?.order?.customer;
  const maps = mapsUrl(job);
  const failReasons = job.type === "PICKUP" ? FAIL_REASONS_PICKUP : FAIL_REASONS_DELIVERY;

  async function guard(fn) {
    setBusy(true);
    setErr("");
    try {
      await fn();
      setMode("idle");
      setPhotos([]);
      setSignatureUrl(null);
      setNote("");
      setFailReason("");
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
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
        <Button className="mt-3 h-12 w-full text-sm" disabled={busy} onClick={() => guard(() => api.startArmadaJob(job.id))}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mulai Perjalanan"}
        </Button>
      )}

      {mode === "idle" && job.status === "EN_ROUTE" && (
        <div className="mt-3 space-y-2">
          <Button className="h-12 w-full text-sm" disabled={busy} onClick={() => guard(() => api.arriveArmadaJob(job.id))}>
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
          {job.type === "DELIVERY" && <PaymentSection job={job} onChanged={onChanged} />}
        </>
      )}
      {mode === "idle" && job.status === "FAILED" && (
        <div className="mt-3 rounded-lg bg-redbg px-2.5 py-2 text-xs text-red">{job.failureReason}</div>
      )}

      {mode === "completing" && (
        <div className="mt-3 space-y-2">
          <PhotoCapture jobId={job.id} photos={photos} setPhotos={setPhotos} />
          <SignaturePad jobId={job.id} signatureUrl={signatureUrl} setSignatureUrl={setSignatureUrl} />
          <textarea
            value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (opsional)"
            className="h-14 w-full rounded-lg border border-border p-2 text-xs outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <Button variant="neutral" className="h-11 flex-1 text-xs" onClick={() => setMode("idle")}>Batal</Button>
            <Button
              className="h-11 flex-1 text-xs" disabled={busy || photos.length === 0}
              onClick={() => guard(() => api.completeArmadaJob(job.id, { proofPhotoUrls: photos, signatureUrl, note }))}
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
          <PhotoCapture jobId={job.id} photos={photos} setPhotos={setPhotos} />
          <div className="flex gap-2">
            <Button variant="neutral" className="h-11 flex-1 text-xs" onClick={() => setMode("idle")}>Batal</Button>
            <Button
              variant="destructive" className="h-11 flex-1 text-xs"
              disabled={busy || !failReason || photos.length === 0}
              onClick={() => guard(() => api.failArmadaJob(job.id, { failureReason: failReason, failurePhotoUrls: photos, note }))}
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

export default function DriverJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api.getMyJobs();
      setJobs(r.jobs);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
  if (jobs.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Truck className="mx-auto mb-3 h-10 w-10 text-ink2" strokeWidth={1.5} />
        <h3 className="text-base font-semibold text-ink">Tidak ada job hari ini</h3>
        <p className="mt-1 text-sm text-ink2">Job baru akan muncul di sini begitu dispatcher menugaskan.</p>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {jobs.map((job) => <JobCard key={job.id} job={job} onChanged={load} />)}
    </div>
  );
}
