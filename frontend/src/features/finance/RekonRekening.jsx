import React, { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Landmark, Wallet, AlertTriangle, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { urutkanRekening } from "@/features/finance/mutasiRekeningLogic.js";
import MutasiRekening from "@/features/finance/MutasiRekening.jsx";
import MutasiBank from "@/features/finance/MutasiBank.jsx";
import PencocokanBank from "@/features/finance/PencocokanBank.jsx";
import PanelRekon from "@/features/finance/PanelRekon.jsx";
import { TAB_DETAIL, hariIniWib, keSen } from "@/features/finance/rekonBankLogic.js";

// KAS & BANK › MUTASI & REKONSILIASI — kartu per rekening (PT Sano, KEM, Uang Kas) lalu detail dengan empat tab: Mutasi Buku, Mutasi Rekening (bank), Pencocokan, Rekonsiliasi.
// Saldo buku = menurut jurnal. Saldo bank = menurut rekening koran yang diimpor (Uang Kas: hasil hitung fisik). Selisih keduanya yang dijelaskan di tab Rekonsiliasi.

export default function RekonRekening({ rekening, periode }) {
  const [kartu, setKartu] = useState(null);
  const [ex, setEx] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [terpilih, setTerpilih] = useState(null);
  const [tab, setTab] = useState("buku");
  const [sampai, setSampai] = useState(hariIniWib());

  const muat = useCallback(async () => {
    setMemuat(true); setGalat(null);
    try {
      const [k, e] = await Promise.all([api.getRekonKartu({ to: hariIniWib() }), api.getRekonExceptionTanpaRekening()]);
      setKartu(k); setEx(e);
    } catch (err) { setGalat(err.message || "Gagal memuat kartu rekening"); }
    finally { setMemuat(false); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const sakelar = !!kartu?.sakelarAktif;
  const urut = urutkanRekening(rekening);
  const kartuDari = (id) => kartu?.rekening.find((r) => r.id === id);

  if (terpilih) {
    const r = urut.find((x) => x.id === terpilih) || { id: terpilih, name: kartuDari(terpilih)?.nama, kind: kartuDari(terpilih)?.jenis };
    const k = kartuDari(terpilih);
    const rek = { id: r.id, name: r.name, kind: r.kind, jenis: r.kind };
    const adaBank = rek.kind !== "KAS";
    const tabAktif = !adaBank && (tab === "bank" || tab === "cocok") ? "rekon" : tab;
    return (
      <div className="space-y-4" data-testid="rekening-detail">
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="neutral" onClick={() => { setTerpilih(null); muat(); }}><ArrowLeft size={14} /> Semua rekening</Button>
          <div className="min-w-0">
            <p className="truncate text-[16px] font-bold text-ink">{rek.name}</p>
            <p className="text-[12px] text-ink3">{rek.kind === "KAS" ? "Kas tunai · rekonsiliasi memakai hitung fisik (opname)" : `${k?.bank || "Bank"} ${k?.nomor || ""}`.trim()}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2" role="tablist" aria-label="Bagian rekening">
          {TAB_DETAIL.filter((t) => adaBank || t.key === "buku" || t.key === "rekon").map((t) => (
            <Button key={t.key} size="sm" variant={tabAktif === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)} role="tab" aria-selected={tabAktif === t.key}>{t.label}</Button>
          ))}
        </div>
        {(tabAktif === "cocok" || tabAktif === "rekon") && (
          <Field label="Sampai tanggal" className="max-w-[200px]"><Input type="date" value={sampai} max={hariIniWib()} onChange={(e) => e.target.value && setSampai(e.target.value)} /></Field>
        )}
        <p className="text-[13px] leading-relaxed text-ink3">{TAB_DETAIL.find((t) => t.key === tabAktif)?.penjelasan}</p>

        {tabAktif === "buku" && <MutasiRekening rekening={rekening} periode={periode} rekeningTetap={rek.id} />}
        {tabAktif === "bank" && <MutasiBank rek={rek} periode={periode} sakelar={sakelar} onBerubah={muat} />}
        {tabAktif === "cocok" && <PencocokanBank rek={rek} sampai={sampai} sakelar={sakelar} onBerubah={muat} />}
        {tabAktif === "rekon" && <PanelRekon rek={rek} sampai={sampai} sakelar={sakelar} onBerubah={muat} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button></CardContent></Card>}

      {kartu && !sakelar && (
        <Card className="bg-orangebg">
          <CardContent className="flex items-start gap-3 py-3 text-[13px] text-ink">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" aria-hidden />
            <p>Impor rekening koran dan pencocokan belum diaktifkan (Admin/Owner: Finance › Pengaturan › Rekonsiliasi Bank V2). Mutasi Buku dan laporan exception tetap bisa dipakai sekarang.</p>
          </CardContent>
        </Card>
      )}
      {ex && ex.jumlahTerbuka > 0 && (
        <Card className="bg-orangebg" data-testid="banner-exception-tanpa-rekening">
          <CardContent className="flex items-start gap-3 py-3 text-[13px] text-ink">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" aria-hidden />
            <p>
              <strong>{ex.jumlahTerbuka} jurnal lama</strong> pada akun Kas/Bank tidak menyebut rekening (netto {String(ex.nilaiBersih).startsWith("-") ? "keluar " : "masuk "}{formatUang(String(ex.nilaiBersih).replace("-", ""))}): {ex.items.filter((i) => !i.ditinjau).slice(0, 3).map((i) => `${i.nomor} ${i.keluar ? `−${formatUang(i.keluar)}` : `+${formatUang(i.masuk)}`} “${i.keterangan}”`).join("; ")}.
              Uang itu tidak muncul di saldo rekening mana pun. Rekeningnya tidak ditebak — lihat tab Rekonsiliasi tiap rekening bank.
            </p>
          </CardContent>
        </Card>
      )}

      {memuat && !kartu ? <p className="py-6 text-center text-[13px] text-ink3">Memuat…</p> : urut.length === 0 ? (
        <Card><CardContent><EmptyState icon={Landmark} title="Belum ada rekening aktif" description="Tambahkan rekening di tab Rekening dulu." /></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="kartu-rekening">
          {urut.map((r) => <KartuRekening key={r.id} r={r} k={kartuDari(r.id)} onBuka={() => { setTerpilih(r.id); setTab("buku"); }} />)}
        </div>
      )}
      <p className="text-[12px] leading-relaxed text-ink3">
        <strong>Saldo buku</strong> = jumlah jurnal rekening itu. <strong>Saldo bank/kas</strong> = saldo terakhir di rekening koran yang diimpor (Uang Kas: hitung fisik). <strong>Selisih</strong> = buku − bank.
        <strong> Belum cocok</strong> = baris bank dan buku yang belum dipasangkan.
      </p>
    </div>
  );
}

function KartuRekening({ r, k, onBuka }) {
  const kas = r.kind === "KAS";
  const selisihN = k?.selisih != null ? keSen(k.selisih) : null;
  return (
    <button
      type="button" onClick={onBuka} data-testid={`kartu-${r.id}`}
      className="rounded-card bg-surface p-4 text-left shadow-card outline-none transition-shadow hover:shadow-popover focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold text-ink">{kas ? <Wallet size={15} className="shrink-0 text-ink3" /> : <Landmark size={15} className="shrink-0 text-ink3" />}{r.name}</p>
          <p className="mt-0.5 text-[11.5px] text-ink3">{kas ? "Kas tunai" : `${k?.bank || r.bankName || "Bank"} ${k?.nomor || ""}`.trim()}</p>
        </div>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink3" aria-hidden />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12.5px]">
        <Bagian label="Saldo buku"><Uang value={k?.saldoBuku ?? 0} className="text-[15px] font-bold" /></Bagian>
        <Bagian label={kas ? "Saldo fisik" : "Saldo bank"}>
          {k?.saldoBank != null ? <><Uang value={k.saldoBank} className="text-[15px] font-bold" /><span className="block text-[11px] text-ink3">per {tanggalPendek(k.tanggalSaldoBank)}</span></> : <span className="text-ink3">{kas ? "Belum dihitung" : "Belum diimpor"}</span>}
        </Bagian>
        <Bagian label="Selisih">
          {selisihN == null ? <span className="text-ink3">—</span> : <span className={`font-semibold tabular-nums ${selisihN === 0 ? "text-green" : "text-red"}`}>{selisihN === 0 ? "Sama" : formatUang(k.selisih)}</span>}
        </Bagian>
        <Bagian label="Belum cocok">{kas ? <span className="text-ink3">—</span> : <Badge variant={k?.belumCocok ? "orange" : "neutral"} className="normal-case">{k?.belumCocok ?? 0} baris</Badge>}</Bagian>
        <Bagian label="Terakhir direkonsiliasi" span>{k?.terakhirDirekonsiliasi ? tanggalPendek(k.terakhirDirekonsiliasi) : <span className="text-ink3">Belum pernah</span>}</Bagian>
      </dl>
    </button>
  );
}
const Bagian = ({ label, children, span }) => <div className={span ? "col-span-2" : undefined}><dt className="text-[11.5px] text-ink3">{label}</dt><dd className="mt-0.5 text-ink">{children}</dd></div>;
