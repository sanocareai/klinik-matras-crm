import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Scale } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { formatUang } from "@/features/finance/shared.jsx";
import { formatTanggalPendek } from "@/utils/formatDate.js";
import { useKontrak } from "@/features/finance/kontrakData.jsx";

export { useKontrak, IsiDefinisi, ChipBasis } from "@/features/finance/kontrakData.jsx";

// ═══ KONTRAK ANGKA FINANCE (Fase 1, 1 Okt 2026) ═══════════════════════════════════════════════════════
// SEMUA definisi, rumus, basis tanggal, dan angka jembatan datang dari server (services/finance/kontrakMetrik.js, jembatanKas.js, rekonSalesFinance.js).
// Berkas ini TIDAK menghitung dan TIDAK mendefinisikan angka sendiri — hanya menampilkan. Tooltip kartu, panel "Kenapa angkanya berbeda?", jembatan, dan sheet
// "Definisi Angka" di Excel membaca kontrak yang sama, jadi layar dan berkas tidak bisa berbeda definisi.

/** Status jembatan: "Perhitungan cocok" dan "Perlu ditinjau" dua hal TERPISAH. Merah hanya bila perhitungan tidak cocok. */
export function StatusJembatan({ status }) {
  if (!status) return null;
  const cocok = status.perhitungan === "COCOK";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge variant={cocok ? "green" : "red"}>
        {cocok ? <CheckCircle2 size={12} className="mr-1" /> : <AlertTriangle size={12} className="mr-1" />}
        {status.perhitunganLabel ?? (cocok ? "Perhitungan cocok" : "Perhitungan tidak cocok")}
      </Badge>
      <Badge variant={status.perluDitinjau ? "orange" : "neutral"}>
        {status.perluDitinjau ? "Perlu ditinjau" : "Tidak ada yang perlu ditinjau"}
      </Badge>
    </span>
  );
}

const rpBertanda = (n) => (n < 0 ? `−${formatUang(Math.abs(n))}` : formatUang(n));
const TANDA = { "-1": "−", 0: "", 1: "+" };

/** Satu baris jembatan (kartu di HP, baris di desktop): label, jumlah, jumlah baris sumber, dan bisa dibuka untuk melihat penyusunnya. */
function BarisJembatan({ l, detail, buka, onToggle }) {
  const ujung = l.tanda === 0;
  const bisaBuka = !!detail?.length;
  return (
    <div className={cn("border-b border-line/60 last:border-0", ujung && "bg-inset/60")}>
      <button
        type="button" disabled={!bisaBuka} onClick={onToggle}
        className={cn("flex w-full items-start gap-2 px-3 py-2.5 text-left max-sm:min-h-11", bisaBuka ? "cursor-pointer hover:bg-hovertint" : "cursor-default")}
        aria-expanded={bisaBuka ? buka : undefined}
      >
        <span className="mt-0.5 w-4 shrink-0 text-center text-[13px] font-bold text-ink3">{TANDA[l.tanda] ?? ""}</span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[13px] leading-snug", ujung ? "font-bold text-ink" : "text-ink2")}>{l.label}</span>
          {l.keterangan && <span className="mt-0.5 block text-[12px] leading-snug text-ink3">{l.keterangan}</span>}
          {l.nOrder > 0 && <span className="mt-0.5 block text-[11.5px] text-ink3">{l.nOrder} pembayaran/order</span>}
        </span>
        <span className={cn("shrink-0 text-right text-[13px] tabular-nums", ujung ? "font-bold text-ink" : "font-semibold text-ink2")}>{rpBertanda(l.jumlah)}</span>
        {bisaBuka && (buka ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-ink3" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-ink3" />)}
      </button>
      {buka && bisaBuka && (
        <ul className="space-y-1.5 bg-inset/40 px-4 pb-3 pt-1">
          {detail.slice(0, 50).map((d, i) => (
            <li key={`${d.paymentId ?? d.orderId}-${i}`} className="flex items-start justify-between gap-3 text-[12px] leading-snug text-ink2">
              <span className="min-w-0">
                <b className="font-semibold text-ink">{d.nomorOrder ?? d.nomor ?? "—"}</b>{d.pelanggan ? ` · ${d.pelanggan}` : ""}
                {d.tanggalBayar && <span className="block text-ink3">Bayar {formatTanggalPendek(d.tanggalBayar)}{d.jurnal ? ` · Jurnal ${d.jurnal.nomor} (${formatTanggalPendek(d.jurnal.tanggal)})` : ""}</span>}
                {d.keterangan && <span className="block text-ink3">{d.keterangan}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{rpBertanda(d.nominal ?? d.jumlah ?? 0)}</span>
            </li>
          ))}
          {detail.length > 50 && <li className="text-[12px] text-ink3">… {detail.length - 50} lainnya (lihat Export Excel)</li>}
        </ul>
      )}
    </div>
  );
}

/**
 * Tampilan satu tahap jembatan (bentuk sama untuk jembatan Uang Masuk → Kas dan dua tahap Sales–Finance):
 * { judul, langkah[], komponenLain{daftar}, pembanding{label,jumlah}, residual, status }.
 */
export function TahapJembatan({ nomor, judul, langkah, komponenLain, pembanding, residual, status, detail = {}, className }) {
  const [terbuka, setTerbuka] = useState(null);
  return (
    <div className={cn("rounded-card bg-surface shadow-card", className)}>
      <div className="space-y-2 border-b border-line/60 px-3 py-3">
        <p className="text-[13px] font-bold text-ink">{nomor ? `Tahap ${nomor} · ` : ""}{judul}</p>
        <StatusJembatan status={status} />
      </div>
      <div>
        {langkah.map((l) => (
          <BarisJembatan key={l.kunci} l={l} detail={detail[l.kunci]} buka={terbuka === l.kunci} onToggle={() => setTerbuka(terbuka === l.kunci ? null : l.kunci)} />
        ))}
        {komponenLain?.daftar?.length > 0 && (
          <div className="border-b border-line/60 px-3 py-2.5 text-[12px] leading-snug text-ink3">
            <b className="font-semibold text-ink2">Komponen lain (Rp0): </b>{komponenLain.daftar.join(" · ")}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12px] text-ink3">
        <span className="min-w-0">{pembanding?.label}: <b className="tabular-nums text-ink2">{formatUang(pembanding?.jumlah ?? 0)}</b></span>
        <span className={cn("font-semibold tabular-nums", residual === 0 ? "text-ink2" : "text-red")}>Selisih (residual): {rpBertanda(residual)}</span>
      </div>
      {status?.alasanTinjau?.length > 0 && (
        <ul className="space-y-1 border-t border-line/60 px-3 py-2.5">
          {status.alasanTinjau.map((a) => (
            <li key={a.kunci} className="text-[12px] leading-snug text-ink2">
              <b className="font-semibold text-orange">Perlu ditinjau · </b>{a.nOrder} baris · {rpBertanda(a.jumlah)} — {a.alasan}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Jembatan "Uang Masuk Terverifikasi → Kas Masuk menurut buku" untuk rentang yang sedang dipilih. */
export function JembatanUangMasukKas({ from, to }) {
  const [s, setS] = useState({ loading: true, data: null, error: null });
  useEffect(() => {
    let batal = false;
    setS({ loading: true, data: null, error: null });
    api.getFinanceJembatanUangMasukKas({ from, to })
      .then((data) => { if (!batal) setS({ loading: false, data, error: null }); })
      .catch((e) => { if (!batal) setS({ loading: false, data: null, error: e.message || "Gagal memuat" }); });
    return () => { batal = true; };
  }, [from, to]);
  if (s.loading) return <div className="flex items-center gap-2 py-6 text-[13px] text-ink2"><Loader2 size={14} className="animate-spin" /> Menghitung jembatan…</div>;
  if (s.error) return <p className="py-3 text-[13px] text-ink2">Jembatan belum bisa dimuat: {s.error}</p>;
  const b = s.data;
  return (
    <TahapJembatan
      judul="Uang Masuk Terverifikasi → Kas Masuk menurut buku" langkah={b.langkah} komponenLain={b.komponenLain}
      pembanding={b.pembanding} residual={b.residual} status={b.status} detail={b.detail}
    />
  );
}

/** Panel "Kenapa angkanya berbeda?" — lipat; isi: pasangan angka (dari kontrak) + glosarium + jembatan opsional (children). */
export function KenapaBeda({ metrik = [], from, to, denganJembatan = false, className }) {
  const [buka, setBuka] = useState(false);
  const k = useKontrak();
  const daftar = useMemo(() => (k ? metrik.map((x) => k.peta.get(x)).filter(Boolean) : []), [k, metrik]);
  return (
    <Card className={cn("fin-glass", className)}>
      <CardContent className="py-3">
        <button type="button" onClick={() => setBuka((v) => !v)} className="flex w-full items-center gap-2 text-left max-sm:min-h-11" aria-expanded={buka}>
          <Scale size={16} className="shrink-0 text-accent" />
          <span className="flex-1 text-[13px] font-bold text-ink">Kenapa angkanya berbeda?</span>
          {buka ? <ChevronDown size={16} className="text-ink3" /> : <ChevronRight size={16} className="text-ink3" />}
        </button>
        {buka && (
          <div className="mt-3 space-y-4">
            <p className="text-[13px] leading-relaxed text-ink2">
              Angka Finance punya tanggal dan sumber yang berbeda-beda — uang diterima, dibukukan, dan diakui sebagai pendapatan adalah tiga kejadian yang berbeda.
              Selisihnya selalu bisa dijelaskan sampai Rp0; berikut penjelasannya.
            </p>
            {daftar.length > 0 && (
              <ul className="space-y-2.5">
                {daftar.map((m) => (
                  <li key={m.kunci} className="rounded-btn bg-inset/60 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink2">
                    <b className="block text-[13px] font-semibold text-ink">{m.nama}</b>
                    {m.definisi}
                    <span className="mt-1 block text-ink3">Tanggal: {m.basisLabel} · Sumber: {m.sumber}</span>
                  </li>
                ))}
              </ul>
            )}
            {k?.glosarium && (
              <div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink3">Istilah</p>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {k.glosarium.map((g) => (
                    <div key={g.kunci} className="text-[12.5px] leading-snug">
                      <dt className="inline font-semibold text-ink">{g.istilah}: </dt>
                      <dd className="m-0 inline text-ink2">{g.arti}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {denganJembatan && from && to && <JembatanUangMasukKas from={from} to={to} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Audit hitung ganda (baca-saja). Dimuat hanya saat dibuka — satu klik, tanpa mengubah data. */
export function AuditKonsistensi({ className }) {
  const [buka, setBuka] = useState(false);
  const [s, setS] = useState({ loading: false, data: null, error: null });
  function toggle() {
    const baru = !buka;
    setBuka(baru);
    if (baru && !s.data && !s.loading) {
      setS({ loading: true, data: null, error: null });
      api.getFinanceAuditKonsistensi()
        .then((data) => setS({ loading: false, data, error: null }))
        .catch((e) => setS({ loading: false, data: null, error: e.message || "Gagal memuat" }));
    }
  }
  const d = s.data;
  return (
    <Card className={cn("fin-glass", className)}>
      <CardContent className="py-3">
        <button type="button" onClick={toggle} className="flex w-full items-center gap-2 text-left max-sm:min-h-11" aria-expanded={buka}>
          <ShieldCheck size={16} className="shrink-0 text-accent" />
          <span className="flex-1 text-[13px] font-bold text-ink">Cek hitung ganda & konsistensi angka</span>
          {d && <Badge variant={d.ringkasan.perluDitinjau ? "orange" : "green"}>{d.ringkasan.perluDitinjau ? `${d.ringkasan.perluDitinjau} perlu ditinjau` : "Semua bersih"}</Badge>}
          {buka ? <ChevronDown size={16} className="text-ink3" /> : <ChevronRight size={16} className="text-ink3" />}
        </button>
        {buka && (
          <div className="mt-3 space-y-2">
            {s.loading && <div className="flex items-center gap-2 py-4 text-[13px] text-ink2"><Loader2 size={14} className="animate-spin" /> Memeriksa…</div>}
            {s.error && <p className="text-[13px] text-ink2">Belum bisa dimuat: {s.error}</p>}
            {d && (
              <>
                <p className="text-[12px] text-ink3">Hanya membaca data — tidak ada yang diubah. Dijalankan {formatTanggalPendek(d.dibuatPada)}.</p>
                <ul className="space-y-2">
                  {d.pemeriksaan.map((p) => (
                    <li key={p.kunci} className="rounded-btn bg-inset/60 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-[13px] font-semibold text-ink">{p.judul}</span>
                        <Badge variant={p.status === "OK" ? "green" : "orange"}>{p.status === "OK" ? "Tidak ada hitung ganda" : `${p.jumlahTemuan} perlu ditinjau`}</Badge>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-ink3">{p.pertanyaan}</p>
                      {p.catatan && <p className="mt-0.5 text-[12px] leading-snug text-ink3">{p.catatan}</p>}
                      {p.status !== "OK" && p.nilai > 0 && <p className="mt-1 text-[12px] font-semibold text-orange">Nilai terdampak {formatUang(p.nilai)}</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {d && <div className="pt-1"><Button size="sm" variant="neutral" onClick={() => setS({ loading: false, data: null, error: null }) || setBuka(false)}>Tutup</Button></div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
