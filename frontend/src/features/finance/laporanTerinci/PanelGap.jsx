import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.jsx";
import { formatUang } from "@/features/finance/shared.jsx";
import { KartuPanel, KotakAngka, KotakCatatan } from "./ui.jsx";
import { tanggalPanjang } from "./logic.js";

// DAFTAR PEMERIKSAAN GAP PEMBUKUAN — bukan antrean perbaikan: tidak ada tombol yang memposting jurnal dari sini.
export function PanelGap({ data, onKoreksi }) {
  const g = data.gap;
  return (
    <KartuPanel testid="panel-gap" judul="Gap Pembukuan — daftar pemeriksaan" deskripsi="Transaksi yang belum bisa dibukukan, satu per satu, dengan pembeda antara order yang benar-benar belum berharga dan order operasional PKR Rp0.">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="Gap terbuka (sama dengan banner)" nilai={String(g.jumlahTerbuka)} tone={g.jumlahTerbuka ? "orange" : undefined} sub={g.sesuaiBanner ? "cocok dengan banner laporan" : "TIDAK cocok dengan banner"} />
        {g.ringkasanJenis.map((r) => <KotakAngka key={r.jenis} label={r.label} nilai={String(r.jumlah)} />)}
        <KotakAngka label="Diserahkan tanpa gap" nilai={String(g.tanpaGap.length)} tone={g.tanpaGap.length ? "orange" : undefined} sub="tidak diakui & tidak tercatat gap" />
      </div>
      <KotakCatatan>{g.catatan}{onKoreksi && <> Perbaikan dilakukan per dokumen di <button type="button" onClick={onKoreksi} className="font-semibold underline" data-testid="ke-koreksi">Koreksi Dokumen</button> (bukti, pratinjau jurnal, PIN).</>}</KotakCatatan>
      {g.daftar.length === 0 && g.tanpaGap.length === 0 && <p className="py-4 text-center text-[13px] text-ink3" data-testid="gap-kosong">Tidak ada transaksi yang perlu diperiksa.</p>}
      {g.daftar.length > 0 && (
        <ul className="m-0 list-none space-y-1.5 p-0" data-testid="daftar-gap">
          {g.daftar.map((x) => <BarisGap key={x.gapId} g={x} />)}
        </ul>
      )}
      {g.tanpaGap.length > 0 && (
        <div data-testid="daftar-tanpa-gap">
          <p className="m-0 mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Diserahkan, tidak pernah diakui, tanpa gap ({g.tanpaGap.length})</p>
          <ul className="m-0 list-none space-y-1.5 p-0">
            {g.tanpaGap.map((x) => (
              <li key={x.nomor} className="rounded-xl bg-surface px-3 py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{x.nomor}</span><Badge variant="orange">{x.jenisLabel}</Badge></span><span className="tabular-nums font-semibold">{formatUang(x.nilai + x.ongkir)}</span></div>
                <p className="m-0 mt-0.5 text-ink3">{x.status} / {x.statusBayar} · lunas {x.tanggalLunas ? tanggalPanjang(x.tanggalLunas) : "—"} · serah {x.tanggalSerah ? tanggalPanjang(x.tanggalSerah) : "—"}</p>
                <p className="m-0 mt-0.5 text-[11.5px] text-ink2">{x.dampak}</p>
                <p className="m-0 mt-0.5 text-[11.5px] text-ink3">{x.tindakan}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </KartuPanel>
  );
}

function BarisGap({ g }) {
  const [buka, setBuka] = useState(false);
  const o = g.order;
  return (
    <li className="rounded-xl bg-surface text-[12.5px]" data-testid={`gap-${g.jenis}`}>
      <button type="button" onClick={() => setBuka((v) => !v)} aria-expanded={buka} className="flex w-full min-h-11 items-start gap-2 px-3 py-2 text-left hover:bg-inset">
        <span className="mt-0.5 text-ink3">{buka ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{o?.nomor ?? g.sumberId}</span>
            <Badge variant={g.jenis === "BELUM_BERHARGA" ? "orange" : "neutral"}>{g.jenisLabel}</Badge>
            {o?.lunasTanpaPembayaran && <Badge variant="red">Lunas tanpa pembayaran</Badge>}</span>
          {o && <span className="mt-0.5 block text-ink3">{o.kategori} · {o.status} / {o.statusBayar} · serah {o.tanggalSerah ? tanggalPanjang(o.tanggalSerah) : "—"} · gap {tanggalPanjang(g.tanggalGap)}</span>}
        </span>
        <span className="shrink-0 tabular-nums font-semibold">{o ? formatUang(o.nilai) : ""}</span>
      </button>
      {buka && (
        <div className="space-y-1.5 border-t border-[color:var(--hairline)] px-3 py-2 pl-9 text-[12px]">
          <p className="m-0 text-ink2"><strong>Tindakan:</strong> {g.tindakan}</p>
          {g.akunSemestinya && <p className="m-0 text-ink2"><strong>Akun semestinya:</strong> {g.akunSemestinya}</p>}
          <ul className="m-0 list-disc pl-4 text-ink3">
            <li>Pendapatan: {g.dampak.pendapatan}</li><li>HPP: {g.dampak.hpp}</li><li>Beban: {g.dampak.beban}</li><li>Laba rugi: {g.dampak.labaRugi}</li><li>Neraca: {g.dampak.neraca}</li>
          </ul>
          <p className="m-0 text-ink3">Detail sistem: {g.detailSistem}</p>
          {o && <p className="m-0 text-ink3">{o.jumlahItem} item · {o.jumlahUnit} unit · {o.jumlahPembayaran} pembayaran (terverifikasi {formatUang(o.pembayaranTerverifikasi)})</p>}
        </div>
      )}
    </li>
  );
}
