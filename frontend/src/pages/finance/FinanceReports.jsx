import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { formatRupiahShort } from "@/utils/format.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, CatatanLaporan, Penjelasan,
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
  { key: "labarugi", label: "Laba Rugi", penjelasan: "Untung atau rugi perusahaan selama periode ini — pendapatan dikurangi seluruh beban." },
  { key: "neraca", label: "Neraca", penjelasan: "Potret kekayaan perusahaan di satu titik waktu: apa yang dimiliki (aset), apa yang menjadi kewajiban, dan sisanya milik siapa (ekuitas)." },
  { key: "aruskas", label: "Arus Kas", penjelasan: "Ke mana saja uang tunai benar-benar mengalir masuk dan keluar selama periode ini — beda dari laba rugi yang menghitung pendapatan walau uangnya belum diterima." },
  { key: "neracasaldo", label: "Neraca Saldo", penjelasan: "Daftar lengkap seluruh akun beserta saldonya — versi 'mentah' sebelum disusun jadi Laba Rugi & Neraca yang rapi. Berguna untuk menelusuri kalau ada angka yang terasa aneh." },
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
      <p className="text-[13px] leading-relaxed text-ink3">
        {TAB.find((t) => t.key === tab)?.penjelasan}
      </p>

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
        <KartuAngka
          label="Pendapatan Bersih" value={formatUang(r.pendapatanBersih)}
          info="Pendapatan kotor dikurangi retur & potongan. Hanya dari order yang SUDAH diserahkan ke pelanggan — DP untuk order yang belum diserahkan tidak dihitung sebagai pendapatan."
        />
        <KartuAngka
          label="Laba Kotor" value={formatUang(r.labaKotor)} sub={r.marginKotor != null ? `Margin ${r.marginKotor.toFixed(1)}%` : undefined}
          info="Pendapatan bersih dikurangi beban pokok (harga bahan/produksi) — untung sebelum dipotong biaya operasional kantor."
        />
        <KartuAngka
          label="Beban Operasional" value={formatUang(r.bebanOperasional)}
          info="Biaya menjalankan bisnis di luar produksi langsung — gaji, sewa, listrik, dan sejenisnya."
        />
        <KartuAngka
          label="Laba Bersih" value={formatUang(r.labaBersih)}
          tone={r.labaBersih < 0 ? "red" : "green"}
          sub={r.marginBersih != null ? `Margin ${r.marginBersih.toFixed(1)}%` : undefined}
          info="Angka paling bawah — untung/rugi sesungguhnya setelah SEMUA beban dikurangkan. Ini yang biasanya dimaksud saat orang bertanya 'untung berapa bulan ini'."
        />
      </div>

      <Penjelasan>
        Pendapatan di sini diakui saat order <strong>diserahkan ke customer</strong>, bukan saat uangnya masuk.
        DP untuk order yang belum diserahkan TIDAK muncul di laporan ini — ia berdiri sebagai kewajiban
        “Uang Muka Pelanggan” di Neraca.
      </Penjelasan>

      <LabaRugiChart r={r} />

      <Card className="overflow-hidden">
        <JudulKartu title="Laba Rugi" info="Disusun dari atas ke bawah: Pendapatan → dikurangi Beban Pokok → Laba Kotor → dikurangi Beban Operasional → Laba Bersih. Setiap baris bisa ditelusuri ke akun aslinya di Bagan Akun." />
        <TableWrap className="dh-table">
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

const CHART_TOOLTIP_STYLE = { borderRadius: 12, border: "1px solid var(--hairline)", fontSize: 12, background: "var(--bg-surface)" };

function LabaRugiChart({ r }) {
  const rows = [
    { name: "Pendapatan Bersih", value: r.pendapatanBersih, color: "var(--green)" },
    { name: "Beban Pokok", value: r.bebanPokok, color: "var(--orange)" },
    { name: "Beban Operasional", value: r.bebanOperasional, color: "var(--orange)" },
    { name: "Laba Bersih", value: r.labaBersih, color: r.labaBersih < 0 ? "var(--red)" : "var(--accent)" },
  ];
  return (
    <Card>
      <JudulKartu title="Perbandingan Visual" description="Pendapatan, beban, dan laba bersih dalam satu tampilan." />
      <CardContent>
        <div style={{ height: 168 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={132} tick={{ fontSize: 11.5, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [formatRupiahShort(v), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22}>
                {rows.map((row, i) => <Cell key={i} fill={row.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
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
        <KartuAngka
          label="Total Aset" value={formatUang(d.ringkasan.totalAset)}
          info="Semua yang dimiliki/dikuasai perusahaan dan bernilai uang — kas, bank, piutang, persediaan bahan, dan sejenisnya."
        />
        <KartuAngka
          label="Total Kewajiban" value={formatUang(d.ringkasan.totalKewajiban)}
          info="Semua yang harus dibayar/diselesaikan perusahaan ke pihak lain — utang supplier, uang muka pelanggan yang belum jadi pendapatan, dan sejenisnya."
        />
        <KartuAngka
          label="Total Ekuitas" value={formatUang(d.ringkasan.totalEkuitas)} sub={`termasuk laba berjalan ${formatUang(d.labaTahunBerjalan)}`}
          info="Sisa kekayaan perusahaan setelah kewajiban dilunasi — hak pemilik. Aset = Kewajiban + Ekuitas, itu sebabnya neraca harus selalu seimbang."
        />
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
          <JudulKartu
            title="Aset"
            description={`Per ${tanggalPendek(d.perTanggal)}`}
            info="Diurutkan dari yang paling likuid (kas) ke yang paling tidak likuid (persediaan) — urutan baku laporan keuangan."
          />
          <AsetDonut rows={d.aset} total={d.ringkasan.totalAset} />
          <TabelNeraca rows={d.aset} total={d.ringkasan.totalAset} labelTotal="TOTAL ASET" />
        </Card>

        <Card className="overflow-hidden">
          <JudulKartu
            title="Kewajiban & Ekuitas"
            description={`Per ${tanggalPendek(d.perTanggal)}`}
            info="Menjawab 'uang/aset perusahaan itu sebenarnya milik/dijanjikan ke siapa' — sebagian ke kreditur (kewajiban), sisanya hak pemilik (ekuitas)."
          />
          <TableWrap className="dh-table">
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

const ASET_PALETTE = ["var(--accent)", "var(--green)", "var(--orange)", "var(--color-chart-violet)", "var(--red)"];

/** Donut komposisi 5 akun aset terbesar, sisanya digabung "Lainnya" — pelengkap TabelNeraca, data sama. */
function AsetDonut({ rows, total }) {
  const terurut = [...rows].filter((r) => r.nilai > 0).sort((a, b) => b.nilai - a.nilai);
  if (terurut.length === 0) return null;
  const sliced = terurut.slice(0, 5).map((r, i) => ({ name: r.name, value: r.nilai, color: ASET_PALETTE[i % ASET_PALETTE.length] }));
  const sisa = terurut.slice(5).reduce((s, r) => s + r.nilai, 0);
  if (sisa > 0) sliced.push({ name: "Lainnya", value: sisa, color: "var(--hairline)" });

  return (
    <div className="flex flex-col items-center gap-4 border-b border-line px-4 py-4 sm:flex-row">
      <div className="h-[136px] w-[136px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sliced} dataKey="value" nameKey="name" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
              {sliced.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip formatter={(v) => [formatRupiahShort(v), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {sliced.map((s, i) => (
          <li key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span className="flex min-w-0 items-center gap-2 text-ink2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="shrink-0 font-medium text-ink">{total ? `${((s.value / total) * 100).toFixed(0)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TabelNeraca({ rows, total, labelTotal }) {
  return (
    <TableWrap className="dh-table">
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
        <KartuAngka label="Saldo Awal Kas" value={formatUang(r.saldoAwal)} info="Total kas & bank tepat sebelum periode ini dimulai." />
        <KartuAngka label="Kas Masuk" value={formatUang(r.masuk)} tone="green" info="Seluruh uang tunai yang benar-benar masuk selama periode ini, dari mana pun sumbernya." />
        <KartuAngka label="Kas Keluar" value={formatUang(r.keluar)} tone="red" info="Seluruh uang tunai yang benar-benar keluar selama periode ini, untuk apa pun tujuannya." />
        <KartuAngka label="Arus Bersih" value={formatUang(r.arusBersih)} tone={r.arusBersih < 0 ? "red" : "green"} info="Kas Masuk dikurangi Kas Keluar. Bisa beda dari Laba Bersih di laporan Laba Rugi — laba dihitung saat diakui, arus kas dihitung saat uangnya benar-benar berpindah." />
        <KartuAngka label="Saldo Akhir Kas" value={formatUang(r.saldoAkhir)} info="Saldo Awal ditambah Arus Bersih — harus sama persis dengan total Kas & Bank aktual di akhir periode." />
      </div>

      <ArusKasChart r={r} />

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

function ArusKasChart({ r }) {
  const rows = [
    { name: "Kas Masuk", value: r.masuk, color: "var(--green)" },
    { name: "Kas Keluar", value: r.keluar, color: "var(--red)" },
  ];
  if (!rows.some((row) => row.value > 0)) return null;
  return (
    <Card>
      <JudulKartu title="Kas Masuk vs Keluar" description="Total pergerakan kas selama periode ini." />
      <CardContent>
        <div style={{ height: 108 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 0, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={92} tick={{ fontSize: 11.5, fill: "var(--text-tertiary)" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [formatRupiahShort(v), ""]} contentStyle={CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={26}>
                {rows.map((row, i) => <Cell key={i} fill={row.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const INFO_ARUS = {
  "Aktivitas Operasi": "Arus kas dari kegiatan usaha sehari-hari — pembayaran pelanggan, pengeluaran operasional, pembayaran supplier. Ini yang paling penting untuk melihat 'apakah bisnis ini sehat dari kegiatan intinya'.",
  "Aktivitas Investasi": "Arus kas dari membeli/menjual aset jangka panjang (mis. peralatan, kendaraan) — biasanya jarang terjadi, tapi nilainya besar saat terjadi.",
  "Aktivitas Pendanaan": "Arus kas dari modal pemilik atau pinjaman — uang yang masuk/keluar terkait permodalan perusahaan, bukan dari kegiatan usaha.",
};

function SeksiArus({ judul, rows, catatan }) {
  return (
    <Card className="overflow-hidden">
      <JudulKartu title={judul} description={catatan} info={INFO_ARUS[judul]} />
      {rows.length === 0 ? (
        <CardContent><p className="py-4 text-[13px] text-ink3">Tidak ada arus kas di kelompok ini.</p></CardContent>
      ) : (
        <TableWrap className="dh-table">
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
        <JudulKartu
          title="Neraca Saldo"
          description="Kolom “Mutasi” = pergerakan periode ini. Kolom “Saldo” = saldo akhir — kumulatif sejak awal untuk
            akun neraca, dan sebatas periode ini untuk akun laba rugi."
          info="Total Mutasi Debit dan Mutasi Kredit di baris paling bawah WAJIB sama persis — kalau tidak, berarti ada jurnal yang tidak seimbang masuk lewat jalur di luar aplikasi normal, dan itu bug yang harus segera dilaporkan."
        />
        <TableWrap className="dh-table">
          <Table fixed>
            <THead>
              <TR>
                <TH sticky width={100}>Kode</TH>
                <TH>Nama Akun</TH>
                <TH width={130}>Tipe</TH>
                <TH numeric width={120} hideBelow="wide">Mutasi Debit</TH>
                <TH numeric width={120} hideBelow="wide">Mutasi Kredit</TH>
                <TH numeric width={132}>Saldo Debit</TH>
                <TH numeric width={132}>Saldo Kredit</TH>
              </TR>
            </THead>
            <TBody>
              {d.baris.map((b) => (
                <TR key={b.accountId}>
                  <TD sticky className="font-mono text-[12px]">{b.code}</TD>
                  <TD truncate>{b.name}</TD>
                  <TD><Badge variant="neutral">{LABEL_TIPE_AKUN[b.type] || b.type}</Badge></TD>
                  <TD hideBelow="wide" numeric><Uang value={b.mutasiDebit} nolSebagaiStrip sen /></TD>
                  <TD hideBelow="wide" numeric><Uang value={b.mutasiKredit} nolSebagaiStrip sen /></TD>
                  <TD numeric><Uang value={b.saldoDebit} nolSebagaiStrip /></TD>
                  <TD numeric><Uang value={b.saldoKredit} nolSebagaiStrip /></TD>
                </TR>
              ))}
              <TR className="bg-inset/70">
                <TD className="font-bold" colSpan={3}>TOTAL MUTASI</TD>
                <TD hideBelow="wide" numeric className="font-bold"><Uang value={d.total.mutasiDebit} sen /></TD>
                <TD hideBelow="wide" numeric className="font-bold"><Uang value={d.total.mutasiKredit} sen /></TD>
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
