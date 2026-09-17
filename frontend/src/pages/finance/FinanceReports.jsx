import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, CatatanLaporan, Penjelasan,
  PeriodePicker, periodeDefault, tanggalPendek, LABEL_TIPE_AKUN,
} from "@/features/finance/shared.jsx";

// LAPORAN KEUANGAN — empat laporan baku dalam satu halaman bertab.
//
// Digabung SENGAJA: keempatnya dibaca dalam satu duduk untuk periode yang
// SAMA, dan memecahnya jadi empat halaman berarti pemilih periode harus
// diatur ulang empat kali untuk pekerjaan yang sebenarnya satu.
//
// Setiap laporan menampilkan CATATAN KEJUJURAN di atas (saldo awal belum
// diinput, ada transaksi yang belum terbukukan). Itu bukan hiasan —
// keputusan bisnis diambil dari angka ini.

const TAB = [
  { key: "labarugi", label: "Laba Rugi" },
  { key: "neraca", label: "Neraca" },
  { key: "aruskas", label: "Arus Kas" },
  { key: "neracasaldo", label: "Neraca Saldo" },
];

export default function FinanceReports() {
  const [tab, setTab] = useState("labarugi");
  const [periode, setPeriode] = useState(periodeDefault);
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const muat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lr, nrc, ak, ns] = await Promise.all([
        api.getFinanceIncomeStatement(periode),
        api.getFinanceBalanceSheet(periode),
        api.getFinanceCashFlow(periode),
        api.getFinanceTrialBalance(periode),
      ]);
      setData({ labarugi: lr, neraca: nrc, aruskas: ak, neracasaldo: ns });
    } catch (e) {
      setError(e.message || "Gagal memuat laporan keuangan");
    } finally {
      setLoading(false);
    }
  }, [periode]);

  useEffect(() => { muat(); }, [muat]);

  const aktif = data[tab];

  return (
    <HalamanFinance
      title="Laporan Keuangan"
      subtitle={`Periode ${tanggalPendek(periode.from)} – ${tanggalPendek(periode.to)}`}
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />}
    >
      {aktif && <CatatanLaporan catatan={aktif.catatan} />}

      <div className="flex flex-wrap gap-2">
        {TAB.map((t) => (
          <Button key={t.key} size="sm" variant={tab === t.key ? "secondary" : "neutral"} onClick={() => setTab(t.key)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === "labarugi" && data.labarugi && <LabaRugi d={data.labarugi} />}
      {tab === "neraca" && data.neraca && <Neraca d={data.neraca} />}
      {tab === "aruskas" && data.aruskas && <ArusKas d={data.aruskas} />}
      {tab === "neracasaldo" && data.neracasaldo && <NeracaSaldo d={data.neracasaldo} />}
    </HalamanFinance>
  );
}

function LabaRugi({ d }) {
  const r = d.ringkasan;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Pendapatan Bersih" value={formatUang(r.pendapatanBersih)} />
        <KartuAngka label="Laba Kotor" value={formatUang(r.labaKotor)} sub={r.marginKotor != null ? `Margin ${r.marginKotor.toFixed(1)}%` : undefined} />
        <KartuAngka label="Beban Operasional" value={formatUang(r.bebanOperasional)} />
        <KartuAngka
          label="Laba Bersih" value={formatUang(r.labaBersih)}
          tone={r.labaBersih < 0 ? "red" : "green"}
          sub={r.marginBersih != null ? `Margin ${r.marginBersih.toFixed(1)}%` : undefined}
        />
      </div>

      <Penjelasan>
        Pendapatan di sini diakui saat order <strong>diserahkan ke customer</strong>, bukan saat uangnya masuk.
        DP untuk order yang belum diserahkan TIDAK muncul di laporan ini — ia berdiri sebagai kewajiban
        “Uang Muka Pelanggan” di Neraca.
      </Penjelasan>

      <Card className="overflow-hidden">
        <CardHeader><CardTitle>Laba Rugi</CardTitle></CardHeader>
        <TableWrap>
          <Table>
            <TBody>
              <SeksiLR judul="PENDAPATAN" rows={d.pendapatan} />
              {d.retur.length > 0 && <SeksiLR judul="RETUR & POTONGAN" rows={d.retur} negatif />}
              <BarisTotal label="Pendapatan Bersih" value={r.pendapatanBersih} />
              <SeksiLR judul="BEBAN POKOK" rows={d.bebanPokok} negatif />
              <BarisTotal label="Laba Kotor" value={r.labaKotor} />
              <SeksiLR judul="BEBAN OPERASIONAL" rows={d.bebanOperasional} negatif />
              <BarisTotal label="LABA BERSIH" value={r.labaBersih} besar />
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

function SeksiLR({ judul, rows, negatif }) {
  return (
    <>
      <TR className="bg-inset">
        <TD className="text-[11px] font-bold uppercase tracking-wide text-ink3" colSpan={2}>{judul}</TD>
      </TR>
      {rows.length === 0 ? (
        <TR><TD className="text-[13px] text-ink3" colSpan={2}>Tidak ada</TD></TR>
      ) : rows.map((row) => (
        <TR key={row.accountId}>
          <TD>
            <span className="font-mono text-[12px] text-ink3">{row.code}</span>
            <span className="ml-2">{row.name}</span>
          </TD>
          <TD numeric><Uang value={negatif ? -row.nilai : row.nilai} /></TD>
        </TR>
      ))}
    </>
  );
}

function BarisTotal({ label, value, besar }) {
  return (
    <TR className="bg-inset/70">
      <TD className={besar ? "text-[14px] font-bold" : "font-bold"}>{label}</TD>
      <TD numeric className={besar ? "text-[15px] font-bold" : "font-bold"}><Uang value={value} /></TD>
    </TR>
  );
}

function Neraca({ d }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KartuAngka label="Total Aset" value={formatUang(d.ringkasan.totalAset)} />
        <KartuAngka label="Total Kewajiban" value={formatUang(d.ringkasan.totalKewajiban)} />
        <KartuAngka label="Total Ekuitas" value={formatUang(d.ringkasan.totalEkuitas)} sub={`termasuk laba berjalan ${formatUang(d.labaTahunBerjalan)}`} />
      </div>

      {!d.ringkasan.seimbang && (
        <Card className="bg-redbg">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red" />
            <div>
              <p className="text-[13px] font-bold text-ink">Neraca tidak seimbang</p>
              <p className="mt-1 text-[13px] text-ink2">
                Selisih {formatUang(d.ringkasan.selisih)}. Ini bukan selisih pembulatan biasa — ada jurnal
                timpang yang masuk ke database lewat jalur di luar aplikasi. Periksa Neraca Saldo untuk
                menemukan akunnya.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Penjelasan>
        Laba tahun berjalan dihitung langsung dari akun pendapatan &amp; beban sejak 1 Januari — tidak
        bergantung pada proses tutup buku tahunan. Artinya neraca selalu seimbang tanpa perlu menjalankan
        proses apa pun, dan tidak akan salah kalau tutup buku lupa dikerjakan.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Aset</CardTitle>
            <CardDescription>Per {tanggalPendek(d.perTanggal)}</CardDescription>
          </CardHeader>
          <TabelNeraca rows={d.aset} total={d.ringkasan.totalAset} labelTotal="TOTAL ASET" />
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Kewajiban & Ekuitas</CardTitle>
            <CardDescription>Per {tanggalPendek(d.perTanggal)}</CardDescription>
          </CardHeader>
          <TableWrap>
            <Table>
              <TBody>
                <TR className="bg-inset"><TD className="text-[11px] font-bold uppercase tracking-wide text-ink3" colSpan={2}>KEWAJIBAN</TD></TR>
                {d.kewajiban.map((r) => (
                  <TR key={r.accountId}>
                    <TD><span className="font-mono text-[12px] text-ink3">{r.code}</span><span className="ml-2">{r.name}</span></TD>
                    <TD numeric><Uang value={r.nilai} /></TD>
                  </TR>
                ))}
                <TR className="bg-inset"><TD className="text-[11px] font-bold uppercase tracking-wide text-ink3" colSpan={2}>EKUITAS</TD></TR>
                {d.ekuitas.map((r) => (
                  <TR key={r.accountId}>
                    <TD><span className="font-mono text-[12px] text-ink3">{r.code}</span><span className="ml-2">{r.name}</span></TD>
                    <TD numeric><Uang value={r.nilai} /></TD>
                  </TR>
                ))}
                <TR>
                  <TD><span className="ml-[52px] italic text-ink2">Laba (rugi) tahun berjalan</span></TD>
                  <TD numeric><Uang value={d.labaTahunBerjalan} /></TD>
                </TR>
                <BarisTotal label="TOTAL KEWAJIBAN & EKUITAS" value={d.ringkasan.totalPasiva} besar />
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      </div>
    </>
  );
}

function TabelNeraca({ rows, total, labelTotal }) {
  return (
    <TableWrap>
      <Table>
        <TBody>
          {rows.length === 0 ? (
            <TR><TD className="py-4 text-center text-[13px] text-ink3" colSpan={2}>Belum ada saldo</TD></TR>
          ) : rows.map((r) => (
            <TR key={r.accountId}>
              <TD><span className="font-mono text-[12px] text-ink3">{r.code}</span><span className="ml-2">{r.name}</span></TD>
              <TD numeric><Uang value={r.nilai} /></TD>
            </TR>
          ))}
          <BarisTotal label={labelTotal} value={total} besar />
        </TBody>
      </Table>
    </TableWrap>
  );
}

function ArusKas({ d }) {
  const r = d.ringkasan;
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KartuAngka label="Saldo Awal Kas" value={formatUang(r.saldoAwal)} />
        <KartuAngka label="Kas Masuk" value={formatUang(r.masuk)} tone="green" />
        <KartuAngka label="Kas Keluar" value={formatUang(r.keluar)} tone="red" />
        <KartuAngka label="Arus Bersih" value={formatUang(r.arusBersih)} tone={r.arusBersih < 0 ? "red" : "green"} />
        <KartuAngka label="Saldo Akhir Kas" value={formatUang(r.saldoAkhir)} />
      </div>

      <Penjelasan>
        Disusun dengan <strong>metode langsung</strong> — dari mutasi kas yang benar-benar terjadi,
        dikelompokkan menurut akun lawannya. Mutasi antar rekening sendiri (setor tunai ke bank, tarik tunai)
        sengaja TIDAK dihitung: uangnya tidak ke mana-mana, dan menghitungnya akan menggelembungkan kedua sisi.
      </Penjelasan>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SeksiArus judul="Aktivitas Operasi" rows={d.operasi} />
        <SeksiArus judul="Aktivitas Investasi" rows={d.investasi} />
        <SeksiArus judul="Aktivitas Pendanaan" rows={d.pendanaan} />
        {d.takTerkategori.length > 0 && (
          <SeksiArus
            judul="Belum Dikategorikan"
            rows={d.takTerkategori}
            catatan="Akun-akun ini belum diberi kategori arus kas di Bagan Akun. Ditampilkan terpisah apa adanya, bukan dipaksa masuk Operasi supaya laporannya terlihat rapi."
          />
        )}
      </div>
    </>
  );
}

function SeksiArus({ judul, rows, catatan }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>{judul}</CardTitle>
        {catatan && <CardDescription>{catatan}</CardDescription>}
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent><p className="py-4 text-[13px] text-ink3">Tidak ada arus kas di kelompok ini.</p></CardContent>
      ) : (
        <TableWrap>
          <Table>
            <TBody>
              {rows.map((r) => (
                <TR key={r.code}>
                  <TD><span className="font-mono text-[12px] text-ink3">{r.code}</span><span className="ml-2">{r.name}</span></TD>
                  <TD numeric><Uang value={r.nilai} /></TD>
                </TR>
              ))}
              <BarisTotal label="Subtotal" value={rows.reduce((s, r) => s + r.nilai, 0)} />
            </TBody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

function NeracaSaldo({ d }) {
  return (
    <>
      {!d.total.seimbang && (
        <Card className="bg-redbg">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red" />
            <div>
              <p className="text-[13px] font-bold text-ink">Total debit ≠ total kredit</p>
              <p className="mt-1 text-[13px] text-ink2">
                Selisih {formatUang(d.total.selisih)}. Seluruh jurnal yang dibuat aplikasi ini dijamin seimbang,
                jadi selisih di sini berarti ada baris yang masuk lewat jalur lain. Laporkan ke pengembang.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Neraca Saldo</CardTitle>
          <CardDescription>
            Kolom “Mutasi” = pergerakan periode ini. Kolom “Saldo” = saldo akhir — kumulatif sejak awal untuk
            akun neraca, dan sebatas periode ini untuk akun laba rugi.
          </CardDescription>
        </CardHeader>
        <TableWrap>
          <Table>
            <THead>
              <TR>
                <TH>Kode</TH><TH>Nama Akun</TH><TH>Tipe</TH>
                <TH numeric>Mutasi Debit</TH><TH numeric>Mutasi Kredit</TH>
                <TH numeric>Saldo Debit</TH><TH numeric>Saldo Kredit</TH>
              </TR>
            </THead>
            <TBody>
              {d.baris.map((b) => (
                <TR key={b.accountId}>
                  <TD className="font-mono text-[12px]">{b.code}</TD>
                  <TD>{b.name}</TD>
                  <TD><Badge variant="neutral">{LABEL_TIPE_AKUN[b.type] || b.type}</Badge></TD>
                  <TD numeric><Uang value={b.mutasiDebit} nolSebagaiStrip sen /></TD>
                  <TD numeric><Uang value={b.mutasiKredit} nolSebagaiStrip sen /></TD>
                  <TD numeric><Uang value={b.saldoDebit} nolSebagaiStrip /></TD>
                  <TD numeric><Uang value={b.saldoKredit} nolSebagaiStrip /></TD>
                </TR>
              ))}
              <TR className="bg-inset/70">
                <TD className="font-bold" colSpan={3}>TOTAL MUTASI</TD>
                <TD numeric className="font-bold"><Uang value={d.total.mutasiDebit} sen /></TD>
                <TD numeric className="font-bold"><Uang value={d.total.mutasiKredit} sen /></TD>
                <TD colSpan={2} className="text-right">
                  {d.total.seimbang
                    ? <Badge variant="green">Seimbang</Badge>
                    : <Badge variant="red">Selisih {formatUang(d.total.selisih)}</Badge>}
                </TD>
              </TR>
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}
