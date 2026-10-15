import React, { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { Uang, formatUang, KartuAngka } from "@/features/finance/shared.jsx";
import { cn } from "@/lib/utils.js";
import { KartuPanel, KotakAngka, KotakCatatan } from "./ui.jsx";
import { gayaLangkah, pecahJembatan, LABEL_PEMENUHAN_PKR, tanggalPanjang } from "./logic.js";

// JEMBATAN OMZET SALES (LUNAS) → PENDAPATAN BERSIH FINANCE + PKR TERPISAH. Semua nominal dari server (satu snapshot); residual wajib Rp0 dan ditampilkan.

export function PanelJembatan({ data }) {
  const j = data.jembatan;
  const { sales, ledger } = pecahJembatan(j.langkah);
  const nol = j.residual.nol;
  const omzet = j.langkah.find((l) => l.kunci === "omzet");
  const bersih = j.langkah.find((l) => l.kunci === "bersih");
  return (
    <KartuPanel testid="panel-jembatan" judul="Jembatan Omzet Sales → Pendapatan Finance"
      deskripsi="Omzet Sales dihitung saat order Lunas; pendapatan Finance saat order diserahkan. Setiap order masuk tepat satu komponen — angka tidak dipaksa sama."
      info="Dua angka memakai dasar tanggal yang berbeda. Jembatan ini menguraikan selisihnya order demi order; residual harus Rp0.">
      <div className="grid gap-3 sm:grid-cols-2">
        <KartuAngka label="Omzet Sales (order Lunas)" value={formatUang(omzet?.nominal)} sub={`${omzet?.jumlahOrder ?? 0} order Lunas pada periode`} metrik="nilai_order_lunas_perusahaan" />
        <KartuAngka label="Pendapatan bersih Finance" value={formatUang(bersih?.nominal)} sub="Basis tanggal buku (diserahkan)" metrik="jembatan_omzet_pendapatan" />
      </div>
      <div className={cn("flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[12.5px]", nol ? "bg-greenbg text-green" : "bg-redbg text-red")} data-testid="jembatan-residual">
        {nol ? <CheckCircle2 size={15} aria-hidden="true" /> : <AlertTriangle size={15} aria-hidden="true" />}
        <strong>{nol ? "Residual Rp0 — semua order & jurnal terklasifikasi" : "Residual TIDAK nol — ada yang tidak terklasifikasi"}</strong>
        <span className="tabular-nums">Sales {formatUang(j.residual.sales)} · Bruto {formatUang(j.residual.bruto)} · Retur {formatUang(j.residual.retur)} · Bersih {formatUang(j.residual.bersih)}</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <DaftarLangkah judul="Sisi Sales (basis tanggal lunas)" langkah={sales} detail={j.detailOrder} />
        <DaftarLangkah judul="Sisi Buku Besar (basis diserahkan)" langkah={ledger} detail={j.detailOrder} />
      </div>
      <ul className="m-0 list-disc space-y-1 pl-5 text-[12px] text-ink3">
        {j.memo.catatan.map((c) => <li key={c}>{c}</li>)}
        <li>{j.memo.pengakuanTanggalBeda} order: tanggal jurnal pengakuan ≠ tanggal serah (POD) · penyesuaian jurnal manual neto {formatUang(j.memo.penyesuaianManualNeto)} ({j.memo.jurnalManual.length} jurnal).</li>
      </ul>
    </KartuPanel>
  );
}

function DaftarLangkah({ judul, langkah, detail }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface">
      <p className="m-0 border-b border-[color:var(--hairline)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink3">{judul}</p>
      <ul className="m-0 list-none p-0">{langkah.map((l) => <BarisLangkah key={l.kunci} l={l} orders={detail.filter((d) => d.kelas === l.kunci)} />)}</ul>
    </div>
  );
}

function BarisLangkah({ l, orders }) {
  const [buka, setBuka] = useState(false);
  const gaya = gayaLangkah(l);
  const bisaBuka = orders.length > 0;
  return (
    <li className={cn("border-b border-[color:var(--hairline)] last:border-b-0", gaya === "subtotal" && "bg-inset/70")} data-testid={`langkah-${l.kunci}`}>
      <button type="button" disabled={!bisaBuka} onClick={() => setBuka((v) => !v)} aria-expanded={bisaBuka ? buka : undefined}
        className={cn("flex w-full min-h-11 items-start gap-2 px-3 py-2 text-left text-[13px]", bisaBuka && "hover:bg-inset")}>
        <span className="mt-0.5 w-4 shrink-0 text-ink3">{bisaBuka ? (buka ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />) : null}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block", gaya === "subtotal" ? "font-bold" : "font-medium")}>{l.label}</span>
          <span className="block text-[11.5px] leading-snug text-ink3">{l.keterangan}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {l.jumlahOrder != null && l.jumlahOrder > 0 && <Badge variant="neutral">{l.jumlahOrder} {l.kunci === "pkr" || l.kunci === "retur" ? "jurnal" : "order"}</Badge>}
            {l.temuan && <Badge variant="orange">Perlu diperiksa</Badge>}
          </span>
        </span>
        <span className={cn("shrink-0 tabular-nums", gaya === "subtotal" ? "font-bold" : "font-semibold", l.nominal < 0 && "text-red")}>{formatUang(l.nominal, { kurung: false })}</span>
      </button>
      {buka && bisaBuka && <DaftarOrder orders={orders} />}
    </li>
  );
}

function DaftarOrder({ orders }) {
  return (
    <div className="space-y-1.5 bg-inset/40 px-3 py-2" data-testid="rincian-order">
      {orders.map((o) => (
        <div key={o.orderId} className="rounded-lg bg-surface px-2.5 py-1.5 text-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
            <span className="font-mono font-semibold">{o.nomor}</span>
            <span className="tabular-nums text-ink2">Nilai <Uang value={o.nilai} />{o.bruto !== 0 && <> · Jurnal <Uang value={o.neto} /></>}</span>
          </div>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink3">
            {o.status} / {o.statusBayar} · lunas {o.tanggalLunas ? tanggalPanjang(o.tanggalLunas) : "—"} · serah {o.tanggalSerah ? tanggalPanjang(o.tanggalSerah) : "—"}
            {o.jurnalPeriode.length ? ` · jurnal ${o.jurnalPeriode.join(", ")} (${o.tanggalJurnal.map(tanggalPanjang).join(", ")})` : ""}
          </p>
          {(o.alasan || o.tanggalBeda) && <p className="m-0 mt-0.5 text-[11.5px] text-orange">{o.alasan}{o.tanggalBeda ? " Tanggal jurnal ≠ tanggal serah." : ""}</p>}
        </div>
      ))}
    </div>
  );
}

export function PanelPkr({ data }) {
  const p = data.pkr; const r = p.ringkasan;
  return (
    <KartuPanel testid="panel-pkr" judul="Penjualan Karyawan (PKR) — terpisah dari order Sales" deskripsi="Dokumen PKR diakui saat dibuat (4-1250). Order CRM tertaut bernilai Rp0 dan tidak dijumlahkan lagi.">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="Pendapatan PKR (buku besar)" nilai={formatUang(r.pendapatanLedger)} sub={`${r.jumlahDokumen} dokumen periode ini`} />
        <KotakAngka label="Dibayar pada periode" nilai={formatUang(r.pembayaranPeriode)} />
        <KotakAngka label="Sisa piutang karyawan" nilai={formatUang(r.sisaPiutang)} tone={r.sisaPiutang > 0 ? "orange" : undefined} />
        <KotakAngka label="Belum diserahkan / tanpa order" nilai={`${r.belumDiserahkan} / ${r.tanpaOrderCrm}`} sub={`${formatUang(r.nilaiBelumDiserahkan)} · ${formatUang(r.nilaiTanpaOrderCrm)}`} tone={r.belumDiserahkan + r.tanpaOrderCrm > 0 ? "orange" : undefined} />
      </div>
      <KotakCatatan>{p.kebijakan}</KotakCatatan>
      {p.dokumen.length === 0 ? <p className="py-4 text-center text-[13px] text-ink3">Tidak ada dokumen PKR pada periode ini.</p> : (
        <ul className="m-0 list-none space-y-1.5 p-0" data-testid="daftar-pkr">
          {p.dokumen.map((d) => (
            <li key={d.nomor} className="rounded-xl bg-surface px-3 py-2 text-[12.5px]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{d.nomor}</span><span className="text-ink3">{tanggalPanjang(d.tanggal)}</span>
                  <Badge variant={d.statusPemenuhan === "DISERAHKAN" ? "green" : d.statusPemenuhan === "DIBATALKAN" ? "neutral" : "orange"}>{LABEL_PEMENUHAN_PKR[d.statusPemenuhan] ?? d.statusPemenuhan}</Badge></span>
                <span className="tabular-nums font-semibold"><Uang value={d.total} /></span>
              </div>
              <p className="m-0 mt-0.5 text-ink3">Penjual {d.penjual} · dibayar <Uang value={d.dibayar} /> · sisa <Uang value={d.sisa} />{d.orderCrm ? ` · order ${d.orderCrm.nomor} (${d.orderCrm.status}, ${d.orderCrm.unit} unit)` : ""}</p>
              {d.catatan && <p className="m-0 mt-0.5 text-orange">{d.catatan}</p>}
            </li>
          ))}
        </ul>
      )}
    </KartuPanel>
  );
}
