import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, JudulKartu } from "@/features/finance/shared.jsx";
import { barisRekonsiliasi, saringDiagnosis, teksUmurPengakuan, VARIAN_TINGKAT, LABEL_POSISI_BUKU } from "@/features/finance/diagnosisPiutangLogic.js";

// DIAGNOSIS PIUTANG — menjelaskan kenapa saldo Piutang Usaha (neraca) sebesar itu: tiap order bersaldo masuk satu kategori dengan alasan + tindakan,
// dan semua kategori menjumlah kembali ke saldo neraca. Hanya membaca; tidak ada tombol yang mengubah data.
export default function DiagnosisPiutang() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [kategori, setKategori] = useState("");
  const [semua, setSemua] = useState(false);
  const [lihatBelumDiakui, setLihatBelumDiakui] = useState(false);
  const [lihatKeringanan, setLihatKeringanan] = useState(true);

  const muat = useCallback(async () => {
    setError(null);
    try { setData(await api.getFinancePiutangDiagnosis()); } catch (e) { setError(e.message || "Gagal memuat diagnosis piutang"); }
  }, []);
  useEffect(() => { muat(); }, [muat]);

  const rek = useMemo(() => barisRekonsiliasi(data), [data]);
  const daftar = useMemo(() => saringDiagnosis(data?.baris, { hanyaTindakan: !semua, kategori }), [data, semua, kategori]);

  if (error) {
    return (
      <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3">
        <p className="text-[13px] text-ink">{error}</p><Button size="sm" variant="neutral" onClick={muat}>Coba lagi</Button>
      </CardContent></Card>
    );
  }
  if (!data) return <Card><CardContent><p className="py-4 text-center text-[13px] text-ink3">Memuat diagnosis piutang…</p></CardContent></Card>;

  const perluTindakan = rek.baris.filter((b) => b.kode !== "TAGIHAN_SAH");
  const belum = data.belumDiakui;
  const kr = data.keringananLunas;

  return (
    <Card className="overflow-hidden">
      <JudulKartu
        title="Diagnosis Piutang — kenapa saldo neracanya segini?"
        description={`Saldo Piutang Usaha di neraca ${formatUang(rek.neraca)}. Berikut rinciannya per penyebab, dan apa yang perlu dilakukan.`}
        info="Dihitung dari buku besar per order, bukan dari status di CRM. Hanya tampilan baca — tidak mengubah data apa pun."
      />
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-ink3">
                <th className="py-1.5 pr-3 font-medium">Penyebab</th><th className="py-1.5 pr-3 text-right font-medium">Order</th><th className="py-1.5 text-right font-medium">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {rek.baris.map((b) => (
                <tr key={b.kode} className="cursor-pointer border-t border-border hover:bg-hovertint" onClick={() => setKategori(kategori === b.kode ? "" : b.kode)}>
                  <td className="py-2 pr-3">
                    <span className="mr-2">{b.label}</span>
                    <Badge variant={VARIAN_TINGKAT[b.tingkat] ?? "neutral"}>{b.tingkat === "tagih" ? "tagih" : b.tingkat === "koreksi" ? "perlu koreksi" : "perlu dicek"}</Badge>
                    {kategori === b.kode && <span className="ml-2 text-[11px] text-ink3">(difilter)</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{b.jumlah}</td>
                  <td className="py-2 text-right"><Uang value={b.total} className="font-medium" /></td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-bold">
                <td className="py-2 pr-3">Saldo Piutang Usaha (neraca)</td>
                <td className="py-2 pr-3" />
                <td className="py-2 text-right"><Uang value={rek.neraca} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-ink2">
          {rek.cocok
            ? <><Badge variant="green">cocok</Badge> Jumlah semua penyebab sama dengan saldo neraca.</>
            : <><Badge variant="red">tidak cocok</Badge> Jumlah penyebab berbeda dari saldo neraca — hubungi admin sistem.</>}
          {" "}Saldo kredit (minus) ikut dihitung, walau tidak tampil di daftar piutang.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-ink">
            {kategori ? "Order pada penyebab terpilih" : semua ? "Semua order bersaldo" : `${daftar.length} order perlu penjelasan / tindakan`}
            {" "}<span className="text-ink3">({daftar.length})</span>
          </p>
          <div className="flex gap-2">
            {kategori && <Button size="sm" variant="tertiary" onClick={() => setKategori("")}>hapus filter</Button>}
            {!kategori && <Button size="sm" variant="neutral" onClick={() => setSemua(!semua)}>{semua ? "Hanya yang perlu tindakan" : "Tampilkan semua"}</Button>}
          </div>
        </div>

        {daftar.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink3">{perluTindakan.length === 0 ? "Tidak ada order yang perlu tindakan — semua saldo adalah tagihan sah." : "Tidak ada order pada filter ini."}</p>
        ) : (
          <ul className="space-y-2">
            {daftar.map((b) => (
              <li key={b.orderId} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{b.orderNumber || "—"} · {b.customerName}</p>
                    <p className="text-[12px] text-ink3">
                      {[b.salesName, teksUmurPengakuan(b.hariSejakPengakuan), b.paymentStatus && `CRM: ${b.paymentStatus.replace("_", " ").toLowerCase()}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="text-right">
                    <Uang value={b.saldoPiutang} className="text-[14px] font-bold" />
                    <div className="mt-0.5"><Badge variant={VARIAN_TINGKAT[b.tingkat] ?? "neutral"}>{data.kategori?.[b.kategori]?.label ?? b.kategori}</Badge></div>
                  </div>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink2">{b.penjelasan}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink"><strong>Tindakan:</strong> {b.tindakan}</p>
              </li>
            ))}
          </ul>
        )}

        {kr && kr.jumlah > 0 && (
          <div className="border-t border-border pt-3">
            <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setLihatKeringanan(!lihatKeringanan)}>
              {lihatKeringanan ? "Sembunyikan" : "Lihat"} order lunas karena keringanan yang uangnya belum diterima ({kr.jumlah} order, sisa {formatUang(kr.totalSisa)})
            </button>
            {lihatKeringanan && (
              <div className="mt-2 space-y-2 text-[13px] text-ink2">
                <p>
                  Order ini <strong>dihitung lunas</strong> (Pengecualian Tgl Lunas, keputusan Owner) untuk target sales, tetapi uang pelanggannya belum diterima — jadi secara
                  bisnis tetap <strong>tagihan ke pelanggan</strong>. Order seperti ini tidak tampil di daftar piutang karena statusnya Lunas di CRM, dan yang sudah diserahkan sebelum
                  pembukuan tidak punya jurnal piutang sama sekali. <strong>{formatUang(kr.totalBelumDiBuku)}</strong> di antaranya belum tercatat di buku.
                </p>
                <ul className="space-y-2">
                  {kr.baris.map((b) => {
                    const pos = LABEL_POSISI_BUKU[b.posisiBuku] ?? { label: b.posisiBuku, varian: "neutral", catatan: "" };
                    return (
                      <li key={b.orderId} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium text-ink">{b.orderNumber} · {b.customerName}</p>
                            <p className="text-[12px] text-ink3">{[b.salesName, b.orderStatus, `nilai ${formatUang(b.nilaiTagihan)}`, b.terbayarTerverifikasi > 0 && `terbayar ${formatUang(b.terbayarTerverifikasi)}`].filter(Boolean).join(" · ")}</p>
                          </div>
                          <div className="text-right">
                            <Uang value={b.sisaTagihan} className="text-[14px] font-bold" />
                            <div className="mt-0.5"><Badge variant={pos.varian}>{pos.label}</Badge></div>
                          </div>
                        </div>
                        <p className="mt-1 text-[12px] text-ink3">{pos.catatan}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="border-t border-border pt-3">
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setLihatBelumDiakui(!lihatBelumDiakui)}>
            {lihatBelumDiakui ? "Sembunyikan" : "Lihat"} order yang belum jadi piutang ({belum.jumlah} order, {formatUang(belum.total)})
          </button>
          {lihatBelumDiakui && (
            <div className="mt-2 space-y-2 text-[13px] text-ink2">
              <p>Order ini belum lunas dan <strong>pendapatannya belum diakui</strong>, jadi belum masuk akun Piutang Usaha. Sebagian besar wajar karena order belum diserahkan.</p>
              <ul className="space-y-1">
                {belum.perStatus.map((s) => (
                  <li key={s.status} className="flex justify-between gap-3 border-b border-border py-1"><span>{s.status} <span className="text-ink3">({s.jumlah} order)</span></span><Uang value={s.total} /></li>
                ))}
              </ul>
              {belum.sudahDiserahBelumDiakui.length > 0 && (
                <Card className="bg-orangebg"><CardContent className="py-3">
                  <p className="text-[13px] text-ink"><strong>{belum.sudahDiserahBelumDiakui.length} order sudah diserahkan tetapi pendapatannya belum diakui</strong> — perlu dicek (biasanya nilai order masih Rp0 atau pengakuan gagal diposting):</p>
                  <ul className="mt-1 text-[12px]">
                    {belum.sudahDiserahBelumDiakui.map((o) => <li key={o.orderId}>{o.orderNumber} · {o.customerName} · {o.orderStatus} · {formatUang(o.nilaiTagihan)}</li>)}
                  </ul>
                </CardContent></Card>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
