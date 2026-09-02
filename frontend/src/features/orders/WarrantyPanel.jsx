import React, { useState } from "react";
import { ShieldCheck, Eye, FileText, Send, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";

// ─── PANEL KARTU GARANSI E-WARRANTY (2 Sep 2026) ────────────────────────────
// Jauh lebih tipis dari InvoicePanel — tidak ada lifecycle draft/sent/viewed,
// cuma pilih varian (10/20 tahun) lalu preview/download/kirim. "Terakhir
// dikirim" dibaca langsung dari `order.warrantyYears`/`warrantySentAt` (props
// dari drawer, sudah ikut ter-refresh lewat onChanged — TIDAK fetch state
// terpisah, supaya tidak ada 2 sumber kebenaran soal order yang sama).

const WARRANTY_YEARS = [10, 20];

export default function WarrantyPanel({ orderId, order, onChanged }) {
  const [tahun, setTahun] = useState(order?.warrantyYears || 10);
  const [aksi, setAksi] = useState(null);
  const [error, setError] = useState(null);

  async function previewPdf() {
    setAksi("PREVIEW");
    try {
      const { blob } = await api.getOrderWarrantyPdf(orderId, tahun);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  async function downloadPdf() {
    setAksi("DOWNLOAD");
    try {
      const { blob, namaFile } = await api.getOrderWarrantyPdf(orderId, tahun);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = namaFile; a.click();
      URL.revokeObjectURL(url);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  async function kirimWa() {
    setAksi("KIRIM");
    try {
      await api.sendOrderWarranty(orderId, tahun);
      setError(null);
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setAksi(null);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface p-3.5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">
          <ShieldCheck size={13} /> Kartu Garansi E-Warranty
        </p>
        {order?.warrantySentAt && (
          <span className="text-[11px] text-ink3">
            Terakhir dikirim {formatTanggalPendek(order.warrantySentAt)} · {order.warrantyYears} th
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {WARRANTY_YEARS.map((th) => (
          <button
            key={th}
            type="button"
            onClick={() => setTahun(th)}
            className={
              tahun === th
                ? "rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white"
                : "rounded-lg bg-inset px-3 py-1.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint"
            }
          >
            {th} Tahun
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-lg bg-redbg px-3 py-2 text-[11.5px] text-red">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={aksi === "PREVIEW"}
          onClick={previewPdf}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        >
          {aksi === "PREVIEW" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          Preview PDF
        </button>
        <button
          type="button"
          disabled={aksi === "DOWNLOAD"}
          onClick={downloadPdf}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-inset px-3 py-2.5 text-[12.5px] font-semibold text-ink2 transition-colors hover:bg-hovertint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
        >
          {aksi === "DOWNLOAD" ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
          Download PDF
        </button>
        <button
          type="button"
          disabled={aksi === "KIRIM"}
          onClick={kirimWa}
          className="col-span-2 flex items-center justify-center gap-1.5 rounded-xl bg-green px-3 py-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-green/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green/40 disabled:opacity-60"
        >
          {aksi === "KIRIM" ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Kirim Kartu Garansi ke WhatsApp
        </button>
      </div>
    </div>
  );
}
