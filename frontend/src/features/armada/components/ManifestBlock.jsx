import React, { useState } from "react";
import { Boxes, ChevronDown, ChevronRight, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { manifestOf, teksBaris, produkRingkasKartu, angkaManifest } from "@/features/armada/manifest.js";

// MANIFEST BARANG — memisahkan JUMLAH STOP, JUMLAH UNIT, dan JUMLAH JENIS PRODUK. Dua bentuk:
//   <ManifestChip>  : satu chip untuk kartu stop yang sempit ("3 unit · 3× Kasur Sorong 3in1 custom — 100 × 200 cm").
//   <ManifestBlock> : blok lengkap (drawer/detail): ringkas, baris produk (qty, nama, ukuran, spesifikasi), Unit ID, sumber. Set/bundel = komponen fisik.
// Sumber data = job.manifest dari server (unit tertaut ke job). Tanpa harga.

export function ManifestChip({ job, className }) {
  const a = angkaManifest(job);
  const teks = produkRingkasKartu(job);
  if (!a || !teks) return null;
  return (
    <span
      className={cn("inline-flex w-fit max-w-full items-center gap-1 truncate rounded-md border border-line bg-surface px-1.5 py-px text-[11px] font-semibold text-ink2", className)}
      title={`${a.stop} stop • ${a.unit} unit • ${a.jenisProduk} jenis produk — ${teks}`}
      data-testid="manifest-chip"
    >
      <Boxes size={11} className="shrink-0 text-ink3" aria-hidden="true" />
      <span className="shrink-0 text-accent">{a.unit} unit</span>
      <span className="truncate">· {teks}</span>
    </span>
  );
}

export function ManifestBlock({ job, className, bukaAwal = true, judul = "Barang yang dibawa" }) {
  const m = manifestOf(job);
  const [buka, setBuka] = useState(bukaAwal);
  if (!m) return null;
  const Ikon = buka ? ChevronDown : ChevronRight;
  let setAktif = null;
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)} data-testid="manifest-block">
      <button
        type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <PackageOpen size={14} className="shrink-0 text-ink3" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-ink3">{judul}</span>
            <span className="block text-[13px] font-semibold text-ink" data-testid="manifest-ringkas">{m.ringkas}</span>
          </span>
        </span>
        <Ikon size={14} className="shrink-0 text-ink3" aria-hidden="true" />
      </button>
      {buka && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          {m.baris.length === 0 && <p className="m-0 text-[12.5px] text-ink3">Belum ada unit tertaut pada job ini.</p>}
          {m.baris.map((b, i) => {
            const kepalaSet = b.bundel && setAktif !== b.bundel.no;
            setAktif = b.bundel ? b.bundel.no : null;
            return (
              <div key={`${b.nama}-${i}`}>
                {kepalaSet && <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Set {b.bundel.nama}</p>}
                <div className={cn("rounded-md bg-inset px-2.5 py-1.5 text-[12.5px]", b.bundel && "ml-3")} data-testid="manifest-baris">
                  <p className="m-0 font-semibold text-ink">{teksBaris(b)}</p>
                  <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1 text-ink2">
                    <span className="text-ink3">Unit:</span>
                    {b.unit.map((u) => (
                      <span key={u.id ?? u.kode} className="rounded-full bg-surface px-1.5 py-px font-mono text-[10.5px] font-semibold text-ink" title={u.kode}>{u.label}</span>
                    ))}
                  </p>
                </div>
              </div>
            );
          })}
          {m.sumber && <p className="m-0 text-[12px] text-ink2" data-testid="manifest-sumber">Sumber: {m.sumber.label}</p>}
          {m.sumber?.picLead && <p className="m-0 text-[12px] text-ink3" data-testid="manifest-pic-lead">PIC lead: {m.sumber.picLead}</p>}
        </div>
      )}
    </section>
  );
}

// Manifest SELURUH rute: satu blok per stop (urut stop). Dipakai di Checklist Persiapan Perjalanan (driver & admin) supaya "barang yang harus dibawa"
// dibaca dari unit nyata tiap job — sama dengan kartu stop, pesan grup, dan POD.
export function ManifestRute({ jobs = [], className, judul = "Barang yang dibawa per stop" }) {
  const daftar = (jobs || []).filter((j) => j?.manifest && j.type !== "PICKUP");
  if (daftar.length === 0) return null;
  const totalUnit = daftar.reduce((n, j) => n + (j.manifest.unit || 0), 0);
  return (
    <section className={cn("space-y-1.5", className)} data-testid="manifest-rute" aria-label={judul}>
      <p className="m-0 text-[10.5px] font-bold uppercase tracking-wide text-ink3">{judul} · {daftar.length} stop • {totalUnit} unit</p>
      {daftar.map((j, i) => {
        const nama = j.order?.customer?.name || j.units?.[0]?.unit?.order?.customer?.name || "Stop";
        return <ManifestBlock key={j.id} job={j} bukaAwal={daftar.length <= 2} judul={`Stop ${j.sequence ?? i + 1} — ${nama}`} />;
      })}
    </section>
  );
}
