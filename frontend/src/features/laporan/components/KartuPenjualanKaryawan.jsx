import React, { useEffect, useState } from "react";
import { UserRound, ChevronDown, ShoppingBag, PenLine } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { formatRupiah } from "@/utils/format.js";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { toApiParams } from "@/lib/dateRange.js";
import { rolesOf } from "@/lib/roles.js";

// PENJUALAN KARYAWAN (di luar tim Sales) — penjualan karyawan non-Sales ke kerabat. Masuk omzet/total perusahaan, TIDAK masuk angka Tim Sales (performa, target, ranking).
// Dua sumber digabung SERVER (GET /api/orders/penjualan-karyawan/ringkasan → `gabungan`): order bertanda penjual karyawan + dokumen manual Finance. Layar ini hanya MENAMPILKAN —
// tidak ada penjumlahan uang di sini. Hanya Admin/Owner/Finance dan hanya bila ada datanya.
function bacaUser() { try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; } }

const lebarPersen = (terbayar, nilai) => (nilai > 0 ? Math.max(0, Math.min(100, Math.round((terbayar / nilai) * 100))) : 0);

function Ringkas({ label, value, tone, sub }) {
  return (
    <div className="rounded-xl bg-inset px-3.5 py-3">
      <p className="m-0 text-[11.5px] font-medium text-ink3">{label}</p>
      <p className={cn("m-0 mt-1 text-[18px] font-bold leading-tight tabular-nums", tone === "hijau" ? "text-green" : tone === "oranye" ? "text-orange" : "text-ink")}>{value}</p>
      {sub && <p className="m-0 mt-0.5 text-[11px] text-ink3">{sub}</p>}
    </div>
  );
}

function BarProgres({ terbayar, nilai, className }) {
  const persen = lebarPersen(terbayar, nilai);
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-inset", className)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={persen} aria-label="Persentase sudah dibayar">
      <div className={cn("h-full rounded-full transition-all", persen >= 100 ? "bg-green" : "bg-accent")} style={{ width: `${persen}%` }} />
    </div>
  );
}

function BarisKaryawan({ k, bukaAwal }) {
  const [buka, setBuka] = useState(bukaAwal);
  const persen = lebarPersen(k.terbayar, k.nilai);
  const lunas = k.sisa <= 0;
  return (
    <div className={cn("rounded-xl border border-line", buka ? "bg-inset" : "bg-surface")} data-testid="baris-karyawan">
      <button type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} className="flex w-full items-center gap-3 px-3.5 py-3 text-left">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accentbg text-[13px] font-bold text-accent" aria-hidden>{(k.nama || "?").trim().charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[14px] font-semibold text-ink">{k.nama}</span>
            <span className="text-[12px] text-ink3">{k.jumlah} penjualan</span>
          </span>
          <BarProgres terbayar={k.terbayar} nilai={k.nilai} className="mt-1.5" />
          <span className="mt-1 block text-[11.5px] text-ink3 tabular-nums">{formatRupiah(k.terbayar)} dari {formatRupiah(k.nilai)} dibayar · {persen}%</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[11px] text-ink3">Sisa tagihan</span>
          <span className={cn("block text-[15px] font-bold tabular-nums", lunas ? "text-green" : "text-orange")}>{lunas ? "Lunas" : formatRupiah(k.sisa)}</span>
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-ink3 transition-transform", buka && "rotate-180")} aria-hidden />
      </button>
      {buka && (
      <ul className="px-3.5 pb-1.5">
        {k.transaksi.map((t) => (
          <li key={`${t.jenis}-${t.nomor}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line py-2 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-2">
              <Badge variant={t.jenis === "ORDER" ? "accent" : "neutral"} className={cn("shrink-0 gap-1 normal-case", t.jenis !== "ORDER" && "border border-line")}>
                {t.jenis === "ORDER" ? <ShoppingBag size={11} /> : <PenLine size={11} />}{t.jenis === "ORDER" ? "Order" : "Manual"}
              </Badge>
              <span className="min-w-0 truncate text-ink2"><span className="font-mono text-ink">{t.nomor}</span> · {formatTanggalPendek(t.tanggal)} · {t.pihak}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink2">
              {formatRupiah(t.terbayar)} / {formatRupiah(t.nilai)}
              {t.sisa > 0 && <span className="ml-2 font-semibold text-orange">sisa {formatRupiah(t.sisa)}</span>}
            </span>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

export default function KartuPenjualanKaryawan({ range }) {
  const user = bacaUser();
  const boleh = rolesOf(user).some((r) => ["ADMIN", "OWNER", "FINANCE"].includes(r));
  const [data, setData] = useState(null);
  const kunci = JSON.stringify(toApiParams(range));
  useEffect(() => {
    if (!boleh) return undefined;
    let batal = false;
    api.getPenjualanKaryawan(toApiParams(range)).then((d) => { if (!batal) setData(d); }).catch(() => { if (!batal) setData(null); });
    return () => { batal = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, boleh]);

  const g = data?.gabungan;
  if (!boleh || !g || g.jumlah === 0) return null;
  const dariOrder = data.total;
  const dariManual = data.manual;
  const persenTotal = lebarPersen(g.terbayar, g.nilai);

  return (
    <section className="animate-fade-rise rounded-card bg-surface p-5 shadow-card" data-testid="kartu-penjualan-karyawan">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accentbg text-accent" aria-hidden><UserRound size={18} /></span>
          <div className="min-w-0">
            <h3 className="m-0 flex items-center gap-1.5 text-[15px] font-semibold leading-tight text-ink">
              Penjualan Karyawan (di luar tim Sales)
              <InfoTooltip text="Penjualan karyawan non-Sales ke kerabat. Masuk omzet dan total perusahaan, tetapi tidak dihitung di performa, target, atau ranking Tim Sales. Terbayar dibaca dari pembayaran terverifikasi dan pembayaran yang dicatat Finance; potong gaji dicatat Finance." />
            </h3>
            <p className="m-0 mt-1 text-[12.5px] text-ink3">Terpisah dari angka Tim Sales, tetap masuk omzet perusahaan.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {dariOrder.jumlahOrder > 0 && <Badge variant="accent" className="gap-1 normal-case"><ShoppingBag size={11} />Order CRM · {dariOrder.jumlahOrder}</Badge>}
          {dariManual?.jumlah > 0 && <Badge variant="neutral" className="gap-1 normal-case"><PenLine size={11} />Dicatat manual di Finance (di luar Order) · {dariManual.jumlah}</Badge>}
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Ringkas label="Penjualan" value={String(g.jumlah)} sub={`${g.karyawan.length} karyawan`} />
        <Ringkas label="Nilai Penjualan" value={formatRupiah(g.nilai)} />
        <Ringkas label="Sudah Dibayar" value={formatRupiah(g.terbayar)} tone="hijau" sub={`${persenTotal}% dari nilai`} />
        <Ringkas label="Sisa Tagihan ke Karyawan" value={g.sisa > 0 ? formatRupiah(g.sisa) : "Lunas"} tone={g.sisa > 0 ? "oranye" : "hijau"} />
      </div>
      <BarProgres terbayar={g.terbayar} nilai={g.nilai} className="mt-3" />

      <div className="mt-4 space-y-2">
        {g.karyawan.map((k, i) => <BarisKaryawan key={k.id} k={k} bukaAwal={g.karyawan.length === 1 && i === 0} />)}
      </div>
    </section>
  );
}
