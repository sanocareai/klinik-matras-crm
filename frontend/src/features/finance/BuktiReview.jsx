import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table.jsx";
import { api } from "@/api.js";
import { JudulKartu, Uang, SelBukti, tanggalPendek } from "@/features/finance/shared.jsx";

// ANTREAN TINJAU BUKTI — transaksi baru yang notanya belum diverifikasi orang
// lain, atau yang WAJIB bernota tapi notanya masih kosong. Kebijakan:
// backend services/finance/receipts.js. Transaksi hasil impor historis
// sengaja tidak masuk (lihat pengaturan "Antrean tinjau berlaku sejak").
export default function BuktiReview() {
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState(null);

  const muat = useCallback(async () => {
    try {
      setData(await api.getFinanceReceiptReview());
    } catch (e) {
      setGalat(e.message);
    }
  }, []);

  useEffect(() => { muat(); }, [muat]);

  async function aksi(fn) {
    try {
      setGalat(null);
      await fn();
      await muat();
    } catch (e) {
      setGalat(e.message);
    }
  }

  if (!data) return null;
  if (data.items.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <JudulKartu
        title={<>
          Bukti Perlu Ditinjau
          <Badge variant="orange" className="ml-2">{data.items.length}</Badge>
        </>}
        description={`${data.belumDiverifikasi} nota menunggu verifikasi orang lain · ${data.tanpaNota} transaksi wajib nota tapi belum ada.`}
        info="Verifikasi harus dilakukan orang lain, bukan pembuat transaksinya — kalau Anda pembuatnya, tombol Verifikasi akan ditolak sistem. Buka fotonya, cocokkan nominal, tanggal, dan toko dengan catatan, lalu tekan Verifikasi."
      />
      {galat && <CardContent className="pb-0"><p className="text-[13px] text-red">{galat}</p></CardContent>}
      <TableWrap className="dh-table">
        <Table>
          <THead>
            <TR>
              <TH sticky>Nomor</TH><TH>Tanggal</TH><TH>Keterangan</TH><TH>Dicatat oleh</TH>
              <TH numeric>Nominal</TH><TH>Masalah</TH><TH>Bukti</TH>
            </TR>
          </THead>
          <TBody>
            {data.items.slice(0, 30).map((i) => (
              <TR key={`${i.jenis}-${i.id}`}>
                <TD sticky className="font-mono text-[12px]">{i.nomor}</TD>
                <TD className="whitespace-nowrap">{tanggalPendek(i.date)}</TD>
                <TD className="max-w-[240px] truncate">{i.description}</TD>
                <TD className="text-[12px]">{i.createdBy?.name || "—"}</TD>
                <TD numeric><Uang value={i.amount} /></TD>
                <TD>
                  <Badge variant={i.masalah === "TANPA_NOTA" ? "red" : "orange"}>
                    {i.masalah === "TANPA_NOTA" ? "Tanpa nota" : "Belum diverifikasi"}
                  </Badge>
                </TD>
                <TD><SelBukti doc={{ id: i.id, status: i.status, receiptUrl: i.receiptUrl }} jenis={i.jenis} aksi={aksi} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableWrap>
    </Card>
  );
}
