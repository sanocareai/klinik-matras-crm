import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs.jsx";
import { api } from "@/api.js";
import { Uang, formatUang } from "@/features/finance/shared.jsx";
import TombolExportExcel from "@/features/finance/ExportExcel.jsx";
import { KotakPembalik, UangBiaya } from "@/features/finance/biayaNeto.jsx";
import { penandaDari, ringkasDrilldown } from "@/features/finance/biayaNetoLogic.js";
import { LABEL_METRIK, TAB_DRILLDOWN, labelSumber, paramDrilldown, bodyExport, formatCutoff, tanggalPanjang, penandaDivisi } from "./logic.js";

// DRILLDOWN KARTU LABA RUGI — kartu → akun → jurnal → dokumen → divisi. Semua angka dari server (GET .../drilldown); total semua baris WAJIB sama dengan kartu dan
// ditampilkan eksplisit ("Σ baris = kartu"). Filter akun/divisi/sumber/cari DIKIRIM KE SERVER: jumlah & total tersaring dihitung dari SEMUA baris yang lolos filter (bukan dari daftar yang
// terkirim, yang dipotong di batas server); bila daftar dipotong, layar menyebutnya terang-terangan. Export Excel membawa filter yang sama.

export default function DrilldownKartu({ metrik, periode, cutoff, onClose }) {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [memuat, setMemuat] = useState(true);
  const [tab, setTab] = useState("akun");
  const [filter, setFilter] = useState({ akun: "", divisi: "", sumber: "", q: "" });
  const [cari, setCari] = useState("");
  const [menyaring, setMenyaring] = useState(false);
  const urutan = useRef(0); // penjaga balapan: hanya respons permintaan TERBARU yang dipakai

  const muat = useCallback(async (f, kata, awal = false) => {
    const no = ++urutan.current;
    if (awal) setMemuat(true); else setMenyaring(true);
    setGalat("");
    try {
      const hasil = await api.getFinanceLaporanDrilldown(paramDrilldown(periode, metrik, { ...f, q: kata }));
      if (no === urutan.current) setData(hasil);
    } catch (e) { if (no === urutan.current) setGalat(e.message || "Gagal memuat rincian"); }
    finally { if (no === urutan.current) { setMemuat(false); setMenyaring(false); } }
  }, [periode, metrik]);

  // Buka kartu / ganti periode-metrik: reset filter, muat tanpa filter.
  useEffect(() => { setFilter({ akun: "", divisi: "", sumber: "", q: "" }); setCari(""); setTab("akun"); setData(null); muat({}, "", true); }, [muat]);
  // Filter akun/divisi/sumber berubah → minta ulang ke server. Pencarian teks ditunda 350 ms supaya tidak menembak server tiap ketukan.
  const pertama = useRef(true);
  useEffect(() => {
    if (pertama.current) { pertama.current = false; return undefined; }
    const t = setTimeout(() => muat(filter, cari, false), cari ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.akun, filter.divisi, filter.sumber, cari]);

  const baris = data?.baris ?? [];
  const ringkas = ringkasDrilldown(data);
  const aktif = filter.akun || filter.divisi || filter.sumber || cari.trim();
  const penanda = penandaDari(data);
  const biaya = data?.sifatNilai === "BIAYA_NETO";
  const Nominal = ({ value }) => (biaya ? <UangBiaya value={value} penanda={penanda} /> : <Uang value={value} />);
  const adaPembalik = biaya && (Number(data?.nilaiKartu) < 0 || (data?.grupAkun ?? []).some((g) => g.nilai < 0));
  const pilih = (k, v) => { setFilter((f) => ({ ...f, [k]: f[k] === v ? "" : v })); setTab("jurnal"); };
  const label = LABEL_METRIK[metrik];

  return (
    <Modal
      open onOpenChange={(o) => !o && onClose?.()} title={`Rincian ${label}`}
      description={`${periode.from} s.d. ${periode.to} · ${formatCutoff(cutoff)}`}
      className="w-[1040px] max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!rounded-none"
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-ink3" data-testid="drill-catatan">Total semua baris = nilai kartu. Filter menyaring daftar (dihitung di server dari seluruh baris).</span>
          <div className="flex items-center gap-2">
            <TombolExportExcel modul="laporan-keuangan" label="Export Excel (filter ini)" ambilBody={() => bodyExport(periode, { metrik, filter: { ...filter, q: cari }, cutoff })} />
            <Button variant="neutral" size="sm" onClick={onClose} className="max-sm:min-h-11">Tutup</Button>
          </div>
        </div>
      )}
    >
      {galat ? (
        <div className="space-y-2 py-6 text-center" role="alert"><p className="text-[13px] text-red">{galat}</p><Button size="sm" variant="outline" onClick={muat}>Coba lagi</Button></div>
      ) : memuat || !data ? (
        <p className="py-10 text-center text-[13px] text-ink3">Memuat rincian…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" data-testid="drill-total">
            <div className="rounded-xl bg-inset px-3 py-2">
              <p className="text-[11px] text-ink3">Nilai kartu</p>
              <p className="text-[18px] font-bold tabular-nums"><Nominal value={data.nilaiKartu} /></p>
            </div>
            <div className="rounded-xl bg-inset px-3 py-2">
              <p className="text-[11px] text-ink3">Σ {(data.jumlahSemua ?? data.grupAkun.reduce((n, g) => n + g.nBaris, 0)).toLocaleString("id-ID")} baris jurnal</p>
              <p className="text-[18px] font-bold tabular-nums"><Nominal value={data.totalSemuaBaris} /></p>
            </div>
            {data.cocok
              ? <Badge variant="green" data-testid="drill-cocok"><CheckCircle2 size={12} aria-hidden="true" /> Σ baris = kartu</Badge>
              : <Badge variant="red" data-testid="drill-tidak-cocok"><AlertTriangle size={12} aria-hidden="true" /> TIDAK cocok dengan kartu</Badge>}
            {ringkas.parsial && <Badge variant="orange" data-testid="drill-parsial">Daftar parsial: {ringkas.tampil.toLocaleString("id-ID")} dari {ringkas.jumlah.toLocaleString("id-ID")} baris — persempit filter atau pakai Export Excel</Badge>}
            {menyaring && <span className="text-[12px] text-ink3" role="status">Menyaring…</span>}
          </div>

          {aktif && (
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]" data-testid="drill-filter-aktif">
              <span className="text-ink3">Disaring:</span>
              {filter.akun && <ChipFilter teks={`Akun ${filter.akun}`} onHapus={() => setFilter((f) => ({ ...f, akun: "" }))} />}
              {filter.divisi && <ChipFilter teks={`Divisi ${data.grupDivisi.find((g) => g.kunci === filter.divisi)?.label ?? filter.divisi}`} onHapus={() => setFilter((f) => ({ ...f, divisi: "" }))} />}
              {filter.sumber && <ChipFilter teks={labelSumber(filter.sumber)} onHapus={() => setFilter((f) => ({ ...f, sumber: "" }))} />}
              {cari.trim() && <ChipFilter teks={`Cari "${cari.trim()}"`} onHapus={() => setCari("")} />}
              <span className="ml-auto tabular-nums text-ink2" data-testid="drill-tersaring">{ringkas.jumlah.toLocaleString("id-ID")} baris cocok · total <Nominal value={data.totalTersaring} /> (dari semua baris yang lolos filter{ringkas.parsial ? `; daftar memuat ${ringkas.tampil.toLocaleString("id-ID")}` : ""})</span>
            </div>
          )}

          <KotakPembalik penanda={penanda} ada={adaPembalik} testid="kotak-pembalik-drilldown" />

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>{TAB_DRILLDOWN.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>)}</TabsList>

            <TabsContent value="akun" className="mt-3">
              <DaftarGrup grup={data.grupAkun} total={data.totalSemuaBaris} aktifKey={filter.akun} onPilih={(k) => pilih("akun", k)} testid="grup-akun" Nominal={Nominal} />
            </TabsContent>
            <TabsContent value="divisi" className="mt-3">
              <DaftarGrup grup={data.grupDivisi} total={data.totalSemuaBaris} aktifKey={filter.divisi} onPilih={(k) => pilih("divisi", k)} testid="grup-divisi" tandaDivisi Nominal={Nominal} />
              <p className="mt-2 text-[11.5px] text-ink3">Pendapatan dan retur berada "di luar divisi" — atribusi divisi hanya berlaku untuk biaya.</p>
            </TabsContent>
            <TabsContent value="jurnal" className="mt-3 space-y-2">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden="true" />
                <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari nomor jurnal, dokumen, order, atau uraian" aria-label="Cari baris jurnal"
                  className="h-10 w-full rounded-xl bg-inset pl-9 pr-3 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/40" />
              </div>
              <DaftarJurnal baris={baris} jumlah={ringkas.jumlah} onPilihSumber={(s) => pilih("sumber", s)} />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Modal>
  );
}

function ChipFilter({ teks, onHapus }) {
  return (
    <button type="button" onClick={onHapus} className="inline-flex items-center gap-1 rounded-chip bg-accentbg px-2 py-1 text-[11.5px] font-medium text-accent" aria-label={`Hapus filter ${teks}`}>
      {teks} <X size={11} aria-hidden="true" />
    </button>
  );
}

function DaftarGrup({ grup, total, aktifKey, onPilih, testid, tandaDivisi = false, Nominal }) {
  if (!grup.length) return <p className="py-6 text-center text-[13px] text-ink3">Tidak ada baris.</p>;
  return (
    <ul className="m-0 list-none divide-y divide-[color:var(--hairline)] rounded-xl bg-surface p-0" data-testid={testid}>
      {grup.map((g) => {
        const penanda = tandaDivisi ? penandaDivisi(g.kunci) : null;
        return (
          <li key={g.kunci}>
            <button type="button" onClick={() => onPilih(g.kunci)} aria-pressed={aktifKey === g.kunci}
              className={`flex w-full min-h-11 items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-inset ${aktifKey === g.kunci ? "bg-accentbg" : ""}`}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{g.label}</span>
                <span className="text-[11.5px] text-ink3">{g.nBaris.toLocaleString("id-ID")} baris</span>
              </span>
              {penanda && <Badge variant={penanda.varian}>{penanda.label}</Badge>}
              <span className="shrink-0 tabular-nums font-semibold"><Nominal value={g.nilai} /></span>
            </button>
          </li>
        );
      })}
      <li className="flex items-center justify-between bg-inset/70 px-3 py-2 text-[13px] font-bold"><span>Total</span><span className="tabular-nums"><Nominal value={total} /></span></li>
    </ul>
  );
}

function DaftarJurnal({ baris, jumlah, onPilihSumber }) {
  if (!baris.length) return <p className="py-6 text-center text-[13px] text-ink3" data-testid="jurnal-kosong">Tidak ada baris jurnal sesuai filter.</p>;
  const tampil = baris.slice(0, 400);
  return (
    <div data-testid="daftar-jurnal">
      <ul className="m-0 list-none space-y-1.5 p-0">
        {tampil.map((b) => (
          <li key={b.id} className="rounded-xl bg-surface px-3 py-2 text-[12.5px]">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono font-semibold">{b.nomorJurnal}</span>
                  <span className="text-ink3">{tanggalPanjang(b.tanggal)}</span>
                  <button type="button" onClick={() => onPilihSumber(b.sumber)} className="rounded-chip bg-inset px-1.5 py-0.5 text-[10.5px] text-ink2">{labelSumber(b.sumber)}</button>
                  {b.status === "REVERSED" && <Badge variant="neutral">Dibalik</Badge>}
                  {b.membalik && <Badge variant="neutral">Membalik {b.membalik.nomor} ({tanggalPanjang(b.membalik.tanggal)})</Badge>}
                  {b.konflik.length > 0 && <Badge variant="orange" title={b.aturan}>Bukti divisi bertentangan</Badge>}
                </p>
                <p className="m-0 mt-0.5 text-ink2"><span className="font-mono text-ink3">{b.akunKode}</span> {b.akunNama}</p>
                <p className="m-0 mt-0.5 break-words text-ink3">
                  {b.dokumen?.nomor ? <>Dokumen <span className="font-mono text-ink2">{b.dokumen.nomor}</span> · </> : null}
                  Divisi <span className="text-ink2">{b.divisiLabel}</span>{b.deskripsi ? ` · ${b.deskripsi}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-right tabular-nums font-semibold"><Uang value={b.kontribusi} /><span className="block text-[10.5px] font-normal text-ink3">D {formatUang(b.debit)} · K {formatUang(b.credit)}</span></span>
            </div>
          </li>
        ))}
      </ul>
      {jumlah > tampil.length && <p className="mt-2 text-center text-[12px] text-ink3" data-testid="drill-daftar-parsial">Menampilkan {tampil.length.toLocaleString("id-ID")} dari {jumlah.toLocaleString("id-ID")} baris yang cocok — persempit dengan filter atau pakai Export Excel (memuat semuanya).</p>}
    </div>
  );
}
