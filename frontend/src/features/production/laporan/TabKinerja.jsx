import React from "react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { DasarTanggal, Galat, Grafik, KartuAngka, Memuat, useMuat } from "./parts.jsx";
import { angka, durasiTeks } from "./laporanModel.js";

const Seg = ({ nilai, opsi, onPilih, label, testid }) => (
  <div className="inline-flex rounded-xl bg-inset/80 p-0.5" role="group" aria-label={label} data-testid={testid}>
    {opsi.map((o) => <button key={o.key} type="button" aria-pressed={nilai === o.key} onClick={() => onPilih(o.key)} data-testid={`${testid}-${o.key}`}
      className={`min-h-[34px] cursor-pointer rounded-lg border-0 px-3 text-[12.5px] font-medium ${nilai === o.key ? "bg-surface text-accent shadow-card" : "bg-transparent text-ink2"}`}>{o.label}</button>)}
  </div>
);

/** Kinerja Produksi: pilihan Meja / PIC. Pekerjaan aktual (selesai) dipisah dari rencana (terjadwal); tidak ada skor performa. */
export default function TabKinerja({ qs, meta, filters, onFilters }) {
  const { data: d, loading, error } = useMuat(() => api.getLaporan("kinerja", qs), `k:${qs}`);
  if (error) return <Galat pesan={error} />;
  if (!d) return <Memuat tampil={loading} />;
  const info = (key) => { const x = meta?.definisi?.find((y) => y.key === key); return x && `${x.formula} · Dasar tanggal: ${x.basis}`; };
  const dasar = filters.dasar === "pic" ? "pic" : "meja";
  const baris = dasar === "meja" ? d.meja.baris : d.pic.baris;
  const tdkMeja = d.meja.tidakTercatat.selesai; const tdkPic = d.pic.baris.find((p) => p.key === "__TIDAK_TERCATAT__")?.selesai ?? 0;
  const tdk = dasar === "meja" ? tdkMeja : tdkPic;
  return (
    <div className={`min-w-0 space-y-3 ${loading ? "opacity-60" : ""}`} data-testid="tab-kinerja">
      <div className="flex flex-wrap items-center gap-2">
        <Seg nilai={dasar} onPilih={(k) => onFilters({ ...filters, dasar: k })} label="Tampilkan per" testid="pilih-dasar" opsi={[{ key: "meja", label: "Per Meja" }, { key: "pic", label: "Per PIC" }]} />
        {dasar === "pic" && <Seg nilai={filters.peran === "CORNER" ? "CORNER" : "MEJA"} onPilih={(k) => onFilters({ ...filters, peran: k })} label="Peran PIC" testid="pilih-peran" opsi={[{ key: "MEJA", label: "PIC Meja" }, { key: "CORNER", label: "PIC Corner" }]} />}
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KartuAngka testid="kin-selesai" label="Unit selesai (aktual)" nilai={angka(d.selesai.unit)} sub="setiap unit dihitung sekali" info={info("unit_selesai")} />
        <KartuAngka testid="kin-terjadwal" label="Unit terjadwal (rencana)" nilai={angka(d.terjadwal.unit)} sub={`kapasitas rencana ${d.terjadwal.kapasitasPerMejaPerHari}/meja/hari`} info={info("rencana_terisi")} />
        <KartuAngka testid="kin-durasi" label="Durasi produksi" nilai={d.selesai.durasi.rataMenit != null ? durasiTeks(d.selesai.durasi).split(" (")[0] : "Belum tersedia"} sub={d.selesai.durasi.rataMenit != null ? `n=${d.selesai.durasi.n} unit` : d.selesai.durasi.catatan} kecil={d.selesai.durasi.rataMenit == null} info={info("durasi")} />
        <KartuAngka testid="kin-tidak-tercatat" label={dasar === "meja" ? "Meja tidak tercatat" : "PIC tidak tercatat"} nilai={angka(tdk)} sub="unit selesai tanpa penetapan pada rencana" info={info("tidak_tercatat")} nada={tdk > 0 ? "text-orange" : ""} />
      </div>

      <div className="min-w-0 overflow-x-auto rounded-card bg-surface" data-testid={`tabel-${dasar}`}>
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
            <th className="px-3 py-2">{dasar === "meja" ? "Meja" : d.pic.peran === "CORNER" ? "PIC Corner" : "PIC Meja"}</th>
            {dasar === "meja" && <><th className="px-3 py-2 text-right">Terjadwal</th><th className="px-3 py-2 text-right">Rencana terisi</th></>}
            <th className="px-3 py-2 text-right">Selesai</th><th className="px-3 py-2">Durasi rata-rata</th>
          </tr></thead>
          <tbody>
            {baris.map((m) => (
              <tr key={m.kode ?? m.key} className="border-b border-line/60" data-testid={`baris-${m.kode ?? m.key}`}>
                <td className="px-3 py-2 font-medium">{m.label}</td>
                {dasar === "meja" && <><td className="px-3 py-2 text-right tabular-nums">{angka(m.terjadwal)}</td><td className="px-3 py-2 text-right tabular-nums">{m.rencanaTerisiPct == null ? "Belum tersedia" : `${m.rencanaTerisiPct}%`}</td></>}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{angka(m.selesai)}</td>
                <td className="px-3 py-2 text-ink2">{durasiTeks(m.durasi)}</td>
              </tr>
            ))}
            {dasar === "meja" && (
              <tr className="border-b border-line/60" data-testid="baris-tidak-tercatat"><td className="px-3 py-2 text-ink2">Tidak tercatat</td><td className="px-3 py-2" /><td className="px-3 py-2" /><td className="px-3 py-2 text-right font-semibold tabular-nums">{angka(tdkMeja)}</td><td className="px-3 py-2 text-ink3">Belum tersedia</td></tr>
            )}
            {baris.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-[13px] text-ink3">Belum ada unit selesai pada periode ini.</td></tr>}
          </tbody>
          <tfoot><tr className="text-[12.5px] font-semibold"><td className="px-3 py-2">Total unit selesai (unik)</td>{dasar === "meja" && <td colSpan={2} />}<td className="px-3 py-2 text-right tabular-nums" data-testid="total-selesai">{angka(d.selesai.unit)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="m-0 text-[12px] text-ink3" data-testid="catatan-pic">{dasar === "pic" ? d.pic.catatan : "Meja = penetapan terakhir pada rencana/jadwal. Unit yang berpindah meja tetap dihitung sekali."} Rencana (terjadwal) dan pekerjaan aktual (selesai) dipisah; bukan skor performa.</p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Grafik testid="grafik-kinerja" judul="Unit selesai per hari" info={info("unit_selesai")} seri={d.selesai.perHari} />
        <Card className="p-3" data-testid="belum-tersedia">
          <h3 className="m-0 text-[13.5px] font-bold text-ink">Yang belum tersedia</h3>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12.5px] text-ink2">
            <li>Target harian historis: {d.targetHistoris.tersedia ? "tersedia" : d.targetHistoris.catatan}</li>
            <li>Hasil QC: {d.qc.tersedia ? Object.entries(d.qc.hasil).map(([k, v]) => `${k} ${v}`).join(" · ") : d.qc.catatan}</li>
            <li>{angka(d.selesai.tanpaWaktuTercatat)} unit berstatus Siap Kirim/Terkirim tidak punya waktu serah barang jadi tercatat — tidak masuk periode mana pun.</li>
          </ul>
        </Card>
      </div>
      <DasarTanggal teks={`${d.dasarTanggal}; rencana: ${d.dasarJadwal}`} />
    </div>
  );
}
