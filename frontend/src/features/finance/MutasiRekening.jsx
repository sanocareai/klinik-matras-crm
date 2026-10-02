import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ListOrdered, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { Uang, formatUang, KartuAngka, JudulKartu, tanggalPendek } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specMutasiRekening } from "@/features/finance/detailSpecs.js";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { urutkanRekening, pilihanAwal, arahBaris } from "@/features/finance/mutasiRekeningLogic.js";

// MUTASI REKENING — mutasi SATU rekening (PT Sano, KEM, Uang Kas) seperti rekening koran versi buku: saldo awal, tiap uang masuk/keluar dengan saldo berjalan, saldo akhir.
// Dipakai untuk mencocokkan dengan rekening koran bank: baris yang hanya ada di salah satu sisi adalah penyebab selisih. Semua angka dari server (satu sumber dengan Export Excel).
// Saldo = menurut BUKU, bukan menurut bank.

const BATAS = 100;
const ArahBadge = ({ b }) => (arahBaris(b) === "MASUK"
  ? <Badge variant="green" className="gap-1 normal-case"><ArrowDownLeft size={11} />Masuk</Badge>
  : <Badge variant="orange" className="gap-1 normal-case"><ArrowUpRight size={11} />Keluar</Badge>);

export default function MutasiRekening({ rekening, periode }) {
  const pilihan = urutkanRekening(rekening);
  const [id, setId] = useState("");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [hal, setHal] = useState(1);
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [panelRincian, setPanelRincian] = useState(null);
  const permintaan = useRef(0);

  useEffect(() => { if (!id && pilihan.length) setId(pilihanAwal(rekening)); }, [id, pilihan.length, rekening]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHal(1); }, [id, qTunda, periode.from, periode.to]);

  const muat = useCallback(async () => {
    if (!id) return;
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const d = await api.getMutasiRekening(id, { from: periode.from, to: periode.to, q: qTunda.trim(), page: hal, limit: BATAS });
      if (no === permintaan.current) setData(d);
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat mutasi rekening");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [id, periode.from, periode.to, qTunda, hal]);
  useEffect(() => { muat(); }, [muat]);

  const baris = data?.baris || [];
  const rekAktif = pilihan.find((r) => r.id === id);

  if (pilihan.length === 0) return <Card><CardContent><EmptyState icon={ListOrdered} title="Belum ada rekening aktif" description="Tambahkan rekening di tab Rekening dulu." /></CardContent></Card>;

  return (
    <>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Pilih rekening">
        {pilihan.map((r) => (
          <Button key={r.id} size="sm" variant={id === r.id ? "secondary" : "neutral"} onClick={() => setId(r.id)} role="tab" aria-selected={id === r.id}>
            {r.name}
          </Button>
        ))}
      </div>

      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button></CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Saldo Awal" value={formatUang(data?.saldoAwal ?? 0)} sub={`per ${tanggalPendek(periode.from)}`} />
        <KartuAngka label="Uang Masuk" value={formatUang(data?.totalMasuk ?? 0)} tone="green" sub={`${data?.jumlahMasuk ?? 0} transaksi`} />
        <KartuAngka label="Uang Keluar" value={formatUang(data?.totalKeluar ?? 0)} tone="orange" sub={`${data?.jumlahKeluar ?? 0} transaksi`} />
        <KartuAngka
          label="Saldo Akhir (menurut buku)" value={formatUang(data?.saldoAkhir ?? 0)} sub={`per ${tanggalPendek(periode.to)}`}
          info="Saldo menurut pembukuan sistem, bukan menurut bank. Bandingkan dengan saldo di aplikasi bank: kalau berbeda, cocokkan mutasi di bawah dengan rekening koran — transaksi yang hanya ada di satu sisi adalah penyebab selisihnya."
        />
      </div>

      {(data?.peringatan || []).map((p) => (
        <Card key={p.kode} className="bg-orangebg" data-testid={`peringatan-${p.kode}`}>
          <CardContent className="flex items-start gap-3 py-3 text-[13px] text-ink">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-orange" aria-hidden />
            <p>{p.pesan}</p>
          </CardContent>
        </Card>
      ))}

      <FilterBar
        q={q} onQ={setQ} placeholder="Cari nomor jurnal, keterangan, akun lawan, nominal…" filters={[]}
        ringkasan={`${data?.total ?? 0} dari ${data?.jumlahMutasi ?? 0} mutasi${data?.disaring ? " (disaring)" : ""} · saldo berjalan tetap saldo seluruh periode`}
        onReset={() => setQ("")}
      />

      <Card className="overflow-hidden">
        <JudulKartu
          title={`Mutasi ${rekAktif?.name ?? ""}`}
          description="Urut tanggal; tiap baris menunjukkan saldo setelah transaksi itu. Jurnal pembatalan tampil sebagai baris sendiri."
        />
        <div className="flex justify-end px-4 pb-3">
          <TombolExportExcel
            modul="mutasi-rekening"
            ambilBody={() => ({
              periode: { from: periode.from, to: periode.to },
              filter: { cashAccountId: id, q: qTunda.trim() },
              filterLabel: labelFilterAktif([["Rekening", rekAktif?.name], ["Pencarian", qTunda.trim()]]),
            })}
          />
        </div>
        {baris.length === 0 && !memuat ? (
          <CardContent><EmptyState icon={ListOrdered} title="Tidak ada mutasi" description="Tidak ada transaksi pada rekening ini untuk periode dan pencarian ini." /></CardContent>
        ) : (
          <>
            <TableWrap className={cn("dh-table", TABLE_VIEW_CLASS)}>
              <Table fixed>
                <THead>
                  <TR>
                    <TH sticky width={86}>Tanggal</TH><TH width={128}>No. Jurnal</TH><TH>Keterangan</TH><TH width={120} hideBelow="2xl">Sumber</TH>
                    <TH numeric width={120}>Masuk</TH><TH numeric width={120}>Keluar</TH><TH numeric width={130}>Saldo</TH>
                  </TR>
                </THead>
                <TBody>
                  {baris.map((b) => (
                    <TR key={b.lineId} {...klikBuka(() => setPanelRincian(specMutasiRekening(b, { rekening: rekAktif?.name })))}>
                      <TD sticky className="whitespace-nowrap text-[12px]">{tanggalPendek(b.tanggal)}</TD>
                      <TD className="font-mono text-[12px]">{b.nomor}</TD>
                      <TD>
                        <span className="block truncate">{b.keterangan}</span>
                        {b.lawan && <span className="block truncate text-[11.5px] text-ink3">{b.lawan}</span>}
                      </TD>
                      <TD hideBelow="2xl" truncate className="text-[12px]">{b.sumberLabel}</TD>
                      <TD numeric>{b.masuk ? <Uang value={b.masuk} className="text-green" /> : <span className="text-ink3">—</span>}</TD>
                      <TD numeric>{b.keluar ? <Uang value={b.keluar} className="text-orange" /> : <span className="text-ink3">—</span>}</TD>
                      <TD numeric><Uang value={b.saldo} className="font-semibold" sen /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <CardList className={CARD_VIEW_CLASS}>
              {baris.map((b) => (
                <RowCard
                  key={b.lineId}
                  onClick={() => setPanelRincian(specMutasiRekening(b, { rekening: rekAktif?.name }))}
                  title={b.nomor}
                  status={<ArahBadge b={b} />}
                  subtitle={b.keterangan}
                  fields={[
                    { label: "Tanggal", value: tanggalPendek(b.tanggal) },
                    { label: b.masuk ? "Masuk" : "Keluar", value: formatUang(b.masuk || b.keluar) },
                    { label: "Saldo", value: formatUang(b.saldo) },
                    { label: "Akun lawan", value: b.lawan, span: true },
                  ]}
                />
              ))}
            </CardList>
            {(hal > 1 || data?.adaLagi) && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[12.5px] text-ink2">
                <span>Halaman {hal} · {BATAS} baris per halaman</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="neutral" disabled={hal <= 1 || memuat} onClick={() => setHal((h) => Math.max(1, h - 1))}>Sebelumnya</Button>
                  <Button size="sm" variant="neutral" disabled={!data?.adaLagi || memuat} onClick={() => setHal((h) => h + 1)}>Berikutnya</Button>
                </span>
              </div>
            )}
          </>
        )}
      </Card>
      <PanelDetail spec={panelRincian} onClose={() => setPanelRincian(null)} />
    </>
  );
}
