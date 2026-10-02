import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ListOrdered, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD, TABLE_VIEW_CLASS, CARD_VIEW_CLASS } from "@/components/ui/table.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { Uang, formatUang, KartuAngka, JudulKartu, tanggalPendek, tanggalJam } from "@/features/finance/shared.jsx";
import FilterBar, { useTertunda } from "@/features/finance/FilterBar.jsx";
import { CardList, RowCard } from "@/features/finance/cards.jsx";
import { PanelDetail, klikBuka } from "@/features/finance/PanelDetail.jsx";
import { specMutasiRekening } from "@/features/finance/detailSpecs.js";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { urutkanRekening, pilihanAwal, arahBaris } from "@/features/finance/mutasiRekeningLogic.js";
import { statusTampil, OPSI_ARAH, OPSI_URUT, OPSI_COCOK_BUKU, paramSaring, adaSaringanAktif } from "@/features/finance/rekonBankLogic.js";
import SaringNominal from "@/features/finance/SaringNominal.jsx";

// MUTASI REKENING — mutasi SATU rekening (PT Sano, KEM, Uang Kas) seperti rekening koran versi buku: saldo awal, tiap uang masuk/keluar dengan saldo berjalan, saldo akhir.
// Dipakai untuk mencocokkan dengan rekening koran bank: baris yang hanya ada di salah satu sisi adalah penyebab selisih. Semua angka dari server (satu sumber dengan Export Excel).
// Saldo = menurut BUKU, bukan menurut bank.

const BATAS = 100;
const ArahBadge = ({ b }) => (arahBaris(b) === "MASUK"
  ? <Badge variant="green" className="gap-1 normal-case"><ArrowDownLeft size={11} />Masuk</Badge>
  : <Badge variant="orange" className="gap-1 normal-case"><ArrowUpRight size={11} />Keluar</Badge>);

// Tab "Mutasi Buku" di detail rekening (Kas & Bank): rekeningTetap = id rekening yang sudah dipilih dari kartu (pilihan rekening disembunyikan).
export default function MutasiRekening({ rekening, periode, rekeningTetap = null }) {
  const pilihan = urutkanRekening(rekening);
  const [id, setId] = useState(rekeningTetap || "");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [arah, setArah] = useState("");
  const [urut, setUrut] = useState("");
  const [sumber, setSumber] = useState("");
  const [cocok, setCocok] = useState("");
  const [min, setMin] = useState("");
  const [maks, setMaks] = useState("");
  const saring = paramSaring({ arah, urut, min, maks, sumber, cocok });
  const kunciSaring = JSON.stringify(saring);
  const [hal, setHal] = useState(1);
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [panelRincian, setPanelRincian] = useState(null);
  const permintaan = useRef(0);

  useEffect(() => { if (rekeningTetap && id !== rekeningTetap) setId(rekeningTetap); else if (!id && pilihan.length) setId(pilihanAwal(rekening)); }, [id, rekeningTetap, pilihan.length, rekening]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setHal(1); }, [id, qTunda, periode.from, periode.to, kunciSaring]);

  const muat = useCallback(async () => {
    if (!id) return;
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const d = await api.getMutasiRekening(id, { from: periode.from, to: periode.to, q: qTunda.trim(), page: hal, limit: BATAS, ...saring });
      if (no === permintaan.current) setData(d);
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat mutasi rekening");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [id, periode.from, periode.to, qTunda, hal, kunciSaring]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { muat(); }, [muat]);

  const baris = data?.baris || [];
  const rekAktif = pilihan.find((r) => r.id === id);

  if (pilihan.length === 0) return <Card><CardContent><EmptyState icon={ListOrdered} title="Belum ada rekening aktif" description="Tambahkan rekening di tab Rekening dulu." /></CardContent></Card>;

  return (
    <>
      {!rekeningTetap && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Pilih rekening">
          {pilihan.map((r) => (
            <Button key={r.id} size="sm" variant={id === r.id ? "secondary" : "neutral"} onClick={() => setId(r.id)} role="tab" aria-selected={id === r.id}>
              {r.name}
            </Button>
          ))}
        </div>
      )}

      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button></CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Saldo Awal" value={formatUang(data?.saldoAwal ?? 0)} sub={`per ${tanggalPendek(periode.from)}`} />
        <KartuAngka label="Uang Masuk" value={formatUang(data?.totalMasuk ?? 0)} tone="green" sub={`${data?.jumlahMasuk ?? 0} transaksi`} />
        <KartuAngka label="Uang Keluar" value={formatUang(data?.totalKeluar ?? 0)} tone="orange" sub={`${data?.jumlahKeluar ?? 0} transaksi`} />
        <KartuAngka
          label="Saldo Akhir (menurut buku)" value={formatUang(data?.saldoAkhir ?? 0)} sub={`per ${tanggalPendek(periode.to)}${data?.paritas ? (data.paritas.cocok ? " · sama dengan kartu Kas & Bank" : ` · BEDA dari kartu Kas & Bank (${formatUang(data.paritas.saldoKartu)})`) : ""}`}
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
        q={q} onQ={setQ} placeholder="Cari nomor jurnal, keterangan, akun lawan, nominal…"
        filters={[
          { key: "arah", label: "Arah", value: arah, onChange: setArah, options: OPSI_ARAH },
          { key: "cocok", label: "Cocok bank", value: cocok, onChange: setCocok, options: OPSI_COCOK_BUKU },
          { key: "sumber", label: "Sumber", value: sumber, onChange: setSumber, options: (data?.sumberTersedia || []).map((s) => [s.kode, s.label]) },
          { key: "urut", label: "Urutan", value: urut, onChange: setUrut, options: OPSI_URUT },
        ]}
        ringkasan={`${data?.total ?? 0} dari ${data?.jumlahMutasi ?? 0} mutasi${data?.disaring ? " (disaring)" : ""} · saldo berjalan tetap saldo seluruh periode${data?.disaring && data?.tersaring ? ` · tampil: masuk ${formatUang(data.tersaring.masuk)}, keluar ${formatUang(data.tersaring.keluar)}` : ""}`}
        onReset={() => { setQ(""); setArah(""); setUrut(""); setSumber(""); setCocok(""); setMin(""); setMaks(""); }}
      />
      <SaringNominal min={min} maks={maks} onMin={setMin} onMaks={setMaks} />

      <Card className="overflow-hidden">
        <JudulKartu
          title={`Mutasi ${rekAktif?.name ?? ""}`}
          description="Urut tanggal buku; tiap baris menunjukkan saldo setelah transaksi itu. Tanggal buku, waktu dibuat, tanggal bank, dan tanggal efektif adalah empat hal berbeda — jangan dicampur. Jurnal pembatalan tampil sebagai baris sendiri."
        />
        <div className="flex justify-end px-4 pb-3">
          <TombolExportExcel
            modul="mutasi-rekening"
            ambilBody={() => ({
              periode: { from: periode.from, to: periode.to },
              filter: { cashAccountId: id, q: qTunda.trim(), ...saring },
              filterLabel: labelFilterAktif([["Rekening", rekAktif?.name], ["Pencarian", qTunda.trim()], ["Arah", OPSI_ARAH.find(([k]) => k === arah)?.[1]], ["Cocok bank", OPSI_COCOK_BUKU.find(([k]) => k === cocok)?.[1]], ["Sumber", (data?.sumberTersedia || []).find((s) => s.kode === sumber)?.label], ["Urutan", OPSI_URUT.find(([k]) => k === urut)?.[1]], ["Nominal", saring.nominalMin || saring.nominalMaks ? `${saring.nominalMin || "0"} – ${saring.nominalMaks || "∞"}` : ""]]),
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
                    <TH sticky width={96}>Tgl Buku</TH><TH width={128}>No. Jurnal</TH><TH>Keterangan</TH><TH width={120} hideBelow="2xl">Sumber</TH>
                    <TH width={118} hideBelow="2xl">Dibuat</TH><TH width={96} hideBelow="wide">Tgl Bank</TH><TH width={122} hideBelow="wide">Cocok Bank</TH>
                    <TH numeric width={116}>Masuk</TH><TH numeric width={116}>Keluar</TH><TH numeric width={128}>Saldo</TH>
                  </TR>
                </THead>
                <TBody>
                  {baris.map((b) => (
                    <TR key={b.lineId} {...klikBuka(() => setPanelRincian(specMutasiRekening(b, { rekening: rekAktif?.name })))}>
                      <TD sticky className="whitespace-nowrap text-[12px]">{tanggalPendek(b.tanggalBuku ?? b.tanggal)}</TD>
                      <TD className="font-mono text-[12px]">{b.nomor}</TD>
                      <TD>
                        <span className="block truncate">{b.keterangan}</span>
                        {b.lawan && <span className="block truncate text-[11.5px] text-ink3">{b.lawan}</span>}
                      </TD>
                      <TD hideBelow="2xl" truncate className="text-[12px]">{b.sumberLabel}</TD>
                      <TD hideBelow="2xl" className="text-[11.5px] leading-tight text-ink2">
                        <span className="block whitespace-nowrap">{b.dibuatPada ? tanggalJam(b.dibuatPada) : "—"}</span>
                        <span className="block truncate text-ink3">{b.aktor || ""}{b.dibuatSetelahTanggalBuku ? " · mundur" : ""}</span>
                      </TD>
                      <TD hideBelow="wide" className="whitespace-nowrap text-[12px]">{b.tanggalBank ? tanggalPendek(b.tanggalBank) : <span className="text-ink3">—</span>}</TD>
                      <TD hideBelow="wide">{b.statusCocok ? <Badge variant={statusTampil(b.statusCocok).variant} className="normal-case">{statusTampil(b.statusCocok).label}</Badge> : <span className="text-[12px] text-ink3">Belum</span>}</TD>
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
                    { label: "Tgl buku", value: tanggalPendek(b.tanggalBuku ?? b.tanggal) },
                    { label: b.masuk ? "Masuk" : "Keluar", value: formatUang(b.masuk || b.keluar) },
                    { label: "Saldo", value: formatUang(b.saldo) },
                    { label: "Dibuat", value: b.dibuatPada ? `${tanggalJam(b.dibuatPada)}${b.aktor ? ` · ${b.aktor}` : ""}` : "—", span: true },
                    { label: "Cocok bank", value: b.statusCocok ? `${statusTampil(b.statusCocok).label}${b.tanggalBank ? ` · bank ${tanggalPendek(b.tanggalBank)}` : ""}` : "Belum dicocokkan", span: true },
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
