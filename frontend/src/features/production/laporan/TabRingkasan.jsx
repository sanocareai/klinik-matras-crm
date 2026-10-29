import React from "react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Galat, Grafik, KartuAngka, Memuat, useMuat, DasarTanggal } from "./parts.jsx";
import { angka, daftarMasalah, rupiah, rupiahRingkas } from "./laporanModel.js";

/** Ringkasan: enam angka pengambil keputusan + dua grafik. Definisi lewat ikon info; rincian lewat klik ke tab terkait (periode ikut terbawa). */
export default function TabRingkasan({ qs, meta, onPindah }) {
  const { data: d, loading, error } = useMuat(() => api.getLaporan("ringkasan", qs), `r:${qs}`);
  if (error) return <Galat pesan={error} />;
  if (!d) return <Memuat tampil={loading} />;
  const k = d.kartu; const def = (key) => meta?.definisi?.find((x) => x.key === key);
  const info = (key) => def(key) && `${def(key).formula} · Dasar tanggal: ${def(key).basis}`;
  const masalah = daftarMasalah(k.masalah.perJenis, meta?.masalah).slice(0, 5);
  return (
    <div className={`min-w-0 space-y-3 ${loading ? "opacity-60" : ""}`} data-testid="tab-ringkasan">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6" data-testid="kartu-ringkasan">
        <KartuAngka testid="kartu-order" label="Order dikerjakan" nilai={angka(k.orderDikerjakan.order)} sub={`${angka(k.orderDikerjakan.unit)} unit · ${angka(k.orderDikerjakan.barisPemakaian)} baris pemakaian`} info={info("order_dikerjakan")} onClick={() => onPindah("biaya")} />
        {k.hppDiketahui
          ? <KartuAngka testid="kartu-hpp" label="HPP Bahan diketahui" nilai={rupiahRingkas(k.hppDiketahui.nilai)} sub={`${k.hppDiketahui.orderLengkap} Lengkap · ${k.hppDiketahui.orderParsial} Parsial · ${k.hppDiketahui.orderBelumDiketahui} Belum diketahui`} info={info("hpp_diketahui")} onClick={() => onPindah("biaya")} />
          : <KartuAngka testid="kartu-hpp" label="Status biaya order" nilai={`${angka(d.perStatusOrder.LENGKAP)} Lengkap`} sub={`${angka(d.perStatusOrder.PARSIAL)} Parsial · ${angka(d.perStatusOrder.BELUM_DIKETAHUI)} Belum diketahui · nominal hanya untuk Finance`} info={info("status_biaya")} onClick={() => onPindah("biaya")} />}
        <KartuAngka testid="kartu-masalah" label="Perlu tindakan" nilai={angka(k.masalah.jumlah)} nada={k.masalah.jumlah > 0 ? "text-orange" : "text-green"} sub={`${angka(k.masalah.orderBermasalah)} order belum lengkap`} info={info("masalah")} onClick={() => onPindah("biaya", { masalah: "ada" })} />
        <KartuAngka testid="kartu-selesai" label="Unit selesai produksi" nilai={angka(k.selesai.unit)} sub={k.selesai.tanpaWaktuTercatat ? `${angka(k.selesai.tanpaWaktuTercatat)} unit Siap Kirim+ tanpa waktu serah tercatat` : "dihitung sekali per unit"} info={info("unit_selesai")} onClick={() => onPindah("kinerja")} />
        <KartuAngka testid="kartu-menunggu" label="Permintaan bahan menunggu" nilai={angka(k.permintaanMenunggu)} sub="posisi saat ini" info={info("permintaan_menunggu")} onClick={() => onPindah("bahan")} />
        <KartuAngka testid="kartu-kelengkapan" label="Data belum lengkap" nilai={angka(k.kelengkapan.unitBerkekurangan)} sub={`dari ${angka(k.kelengkapan.totalUnit)} unit · posisi saat ini`} info={info("kelengkapan")} onClick={() => onPindah("bahan")} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Grafik testid="grafik-selesai" judul="Unit selesai per hari" info={info("unit_selesai")} seri={d.grafik.selesaiPerHari} onDetail={() => onPindah("kinerja")} />
        <Grafik testid="grafik-biaya" judul={d.grafik.biayaPerHariJenis === "hpp" ? "HPP Bahan diketahui per hari" : "Baris pemakaian bahan per hari"} info={info(d.grafik.biayaPerHariJenis === "hpp" ? "hpp_diketahui" : "order_dikerjakan")}
          seri={d.grafik.biayaPerHari} format={d.grafik.biayaPerHariJenis === "hpp" ? rupiah : angka} onDetail={() => onPindah("biaya")} />
      </div>

      {masalah.length > 0 && (
        <Card className="p-3" data-testid="daftar-masalah">
          <h3 className="m-0 text-[13.5px] font-bold text-ink">Yang perlu ditindaklanjuti</h3>
          <ul className="m-0 mt-2 list-none divide-y divide-line p-0">
            {masalah.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                <span className="min-w-0"><b className="tabular-nums">{angka(m.n)}</b> {m.label}<span className="block text-[11.5px] text-ink3">{m.aksi}</span></span>
                <button type="button" className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-accent underline" onClick={() => onPindah("biaya", { masalah: m.key })}>Lihat order</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <DasarTanggal teks={`${d.dasarTanggal.biaya}. Aktivitas (pemakaian, selesai) menurut periode; kartu bertanda "posisi saat ini" tidak mengikuti periode.`} />
      <p className="m-0 text-[11.5px] text-ink3" data-testid="cakupan">Cakupan: {angka(d.cakupan.unitNonBatal)} unit non-batal (bukan hanya unit dalam rencana V2)</p>
    </div>
  );
}
