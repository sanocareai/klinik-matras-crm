import React, { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import {
  HalamanFinance, Uang, formatUang, KartuAngka, JudulKartu, Pilihan,
  PeriodePicker, periodeDefault, tanggalPendek, LABEL_SUMBER_JURNAL, LABEL_TIPE_AKUN,
} from "@/features/finance/shared.jsx";

// BUKU BESAR — semua mutasi satu akun, berurut, dengan saldo berjalan.
//
// Ini halaman yang dipakai saat menjawab "kenapa saldo akun ini segini?".
// Karena itu tiap baris membawa DIMENSI-nya (order/pelanggan/supplier/
// rekening) — tanpa itu, buku besar cuma daftar angka yang tidak bisa
// dicocokkan dengan dokumen apa pun.

export default function FinanceLedger() {
  const [periode, setPeriode] = useState(periodeDefault);
  const [accountId, setAccountId] = useState("");
  const [akun, setAkun] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getFinanceAccounts()
      .then((r) => {
        const postable = r.accounts.filter((a) => a.isPostable);
        setAkun(postable);
        // Buka langsung di Kas — akun yang paling sering ditanya.
        if (!accountId && postable.length) {
          setAccountId((postable.find((a) => a.systemKey === "KAS") || postable[0]).id);
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const muat = useCallback(async () => {
    if (!accountId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      setData(await api.getFinanceLedger(accountId, periode));
    } catch (e) {
      setError(e.message || "Gagal memuat buku besar");
    } finally {
      setLoading(false);
    }
  }, [accountId, periode]);

  useEffect(() => { muat(); }, [muat]);

  return (
    <HalamanFinance
      title="Buku Besar"
      subtitle="Seluruh mutasi satu akun beserta saldo berjalannya."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={
        <>
          <Pilihan value={accountId} onChange={setAccountId} className="min-w-[280px]">
            {akun.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.isPostable}>
                {a.code} · {a.name}
              </option>
            ))}
          </Pilihan>
          <PeriodePicker from={periode.from} to={periode.to} onChange={setPeriode} />
        </>
      }
    >
      {!data ? (
        <Card>
          <CardContent>
            <EmptyState icon={BookOpen} title="Pilih akun" description="Pilih akun di atas untuk melihat mutasinya." />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <KartuAngka
              label="Saldo Awal" value={formatUang(data.saldoAwal)} sub={`per ${tanggalPendek(periode.from)}`}
              info="Saldo akun ini tepat sebelum periode yang dipilih dimulai — titik awal untuk menelusuri kenapa saldo akhir jadi segini."
            />
            <KartuAngka
              label="Total Debit"
              value={formatUang(data.baris.reduce((s, b) => s + b.debit, 0))}
              info="Jumlah seluruh sisi debit dari mutasi akun ini selama periode yang dipilih."
            />
            <KartuAngka
              label="Total Kredit"
              value={formatUang(data.baris.reduce((s, b) => s + b.kredit, 0))}
              info="Jumlah seluruh sisi kredit dari mutasi akun ini selama periode yang dipilih."
            />
            <KartuAngka
              label="Saldo Akhir" value={formatUang(data.saldoAkhir)} sub={`per ${tanggalPendek(periode.to)}`}
              info="Saldo Awal ditambah/dikurangi seluruh mutasi periode ini, sesuai arah saldo normal akunnya (Debit atau Kredit)."
            />
          </div>

          <Card className="overflow-hidden">
            <JudulKartu
              title={<>
                {data.account.code} · {data.account.name}
                <Badge variant="neutral" className="ml-2">{LABEL_TIPE_AKUN[data.account.type] || data.account.type}</Badge>
              </>}
              description={<>
                Saldo normal {data.account.normalBalance === "DEBIT" ? "debit" : "kredit"} — saldo berjalan di
                kolom kanan sudah mengikuti arah itu.
                {data.terpotong && " Menampilkan 500 baris pertama; persempit periodenya untuk melihat sisanya."}
              </>}
              info="Buku besar ini menjawab pertanyaan 'kenapa saldo akun ini segini' — setiap baris membawa dokumen sumbernya (order/pelanggan/supplier/rekening) supaya bisa ditelusuri balik ke transaksi aslinya, bukan cuma daftar angka."
            />
            {data.baris.length === 0 ? (
              <CardContent><p className="py-6 text-center text-[13px] text-ink3">Tidak ada mutasi di periode ini.</p></CardContent>
            ) : (
              <TableWrap className="dh-table">
                <Table>
                  <THead>
                    <TR>
                      <TH sticky>Tanggal</TH><TH>Jurnal</TH><TH>Keterangan</TH><TH>Sumber</TH>
                      <TH numeric>Debit</TH><TH numeric>Kredit</TH><TH numeric>Saldo</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.baris.map((b) => (
                      <TR key={b.lineId} className={b.status === "REVERSED" ? "opacity-60" : undefined}>
                        <TD sticky className="whitespace-nowrap">{tanggalPendek(b.tanggal)}</TD>
                        <TD className="font-mono text-[12px]">{b.entryNumber}</TD>
                        <TD className="max-w-[300px]">
                          <span className="block truncate">{b.keterangan}</span>
                          {(b.orderNumber || b.customerName || b.supplierName || b.cashAccountName) && (
                            <span className="text-[11px] text-ink3">
                              {[b.orderNumber, b.customerName, b.supplierName, b.cashAccountName].filter(Boolean).join(" · ")}
                            </span>
                          )}
                        </TD>
                        <TD>
                          <Badge variant="neutral">{LABEL_SUMBER_JURNAL[b.source] || b.source}</Badge>
                          {b.status === "REVERSED" && <Badge variant="red" className="ml-1">dibalik</Badge>}
                        </TD>
                        <TD numeric><Uang value={b.debit} nolSebagaiStrip sen /></TD>
                        <TD numeric><Uang value={b.kredit} nolSebagaiStrip sen /></TD>
                        <TD numeric><Uang value={b.saldo} className="font-medium" /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </HalamanFinance>
  );
}
