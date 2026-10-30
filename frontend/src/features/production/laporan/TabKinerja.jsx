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

/** Kinerja Produksi: pilihan Meja / PIC. Posisi saat ini dipisah dari kejadian selesai bertanggal; PIC = penugasan (bukan pekerja aktual); rencana dipisah dari aktual; tidak ada skor performa. */
export default function TabKinerja({ qs, meta, filters, onFilters }) {
  const { data: d, loading, error } = useMuat(() => api.getLaporan("kinerja", qs), `k:${qs}`);
  if (error) return <Galat pesan={error} />;
  if (!d) return <Memuat tampil={loading} />;
  const info = (key) => { const x = meta?.definisi?.find((y) => y.key === key); return x && `${x.formula} · Dasar tanggal: ${x.basis}`; };
  const dasar = filters.dasar === "pic" ? "pic" : "meja";
  const baris = dasar === "meja" ? d.meja.baris : d.pic.baris;
  const s = d.selesai; const cp = d.pic.cakupan;
  const tdkMeja = d.meja.tidakTercatat.selesai; const tdkPic = d.pic.baris.find((p) => p.key === "__TIDAK_TERCATAT__")?.selesai ?? 0;
  return (
    <div className={`min-w-0 space-y-3 ${loading ? "opacity-60" : ""}`} data-testid="tab-kinerja">
      <div className="flex flex-wrap items-center gap-2">
        <Seg nilai={dasar} onPilih={(k) => onFilters({ ...filters, dasar: k })} label="Tampilkan per" testid="pilih-dasar" opsi={[{ key: "meja", label: "Per Meja" }, { key: "pic", label: "Per PIC" }]} />
        {dasar === "pic" && <Seg nilai={filters.peran === "CORNER" ? "CORNER" : "MEJA"} onPilih={(k) => onFilters({ ...filters, peran: k })} label="Peran PIC" testid="pilih-peran" opsi={[{ key: "MEJA", label: "PIC Meja" }, { key: "CORNER", label: "PIC Corner" }]} />}
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        <KartuAngka testid="kin-posisi" label="Selesai produksi — posisi saat ini" nilai={angka(s.posisiSaatIni)} sub={`${angka(s.tanpaTanggal)} tanpa tanggal tercatat`} info={info("unit_selesai")} />
        <KartuAngka testid="kin-bertanggal" label="Selesai bertanggal pada periode" nilai={angka(s.bertanggalPeriode)} sub="kejadian dengan bukti tanggal resmi; setiap unit sekali" info={info("unit_selesai")} />
        <KartuAngka testid="kin-terkirim" label="Terkirim pada periode" nilai={angka(s.terkirimPeriode)} sub="tanggal pengiriman tercatat" info={info("terkirim")} />
        <KartuAngka testid="kin-terjadwal" label="Terjadwal (rencana)" nilai={angka(d.terjadwal.unit)} sub={`kapasitas rencana ${d.terjadwal.kapasitasPerMejaPerHari}/meja/hari · bukan pekerjaan aktual`} info={info("rencana_terisi")} />
      </div>

      {dasar === "pic" && (
        <div className="min-w-0 rounded-card bg-orangebg/60 px-3 py-2 text-[12.5px] text-ink2" data-testid="label-penugasan">
          <b className="text-ink">{d.pic.dasarLabel}.</b>{" "}
          <span data-testid="cakupan-pic">{angka(cp.denganPenugasan)} dari {angka(cp.unitSelesaiBertanggal)} unit selesai bertanggal punya penugasan PIC · {angka(cp.denganBuktiKerjaAktual)} punya bukti kerja aktual · penugasan PIC tercatat pada {angka(cp.rencanaBerPicTotal)} rencana dari {angka(cp.unitNonBatal)} unit non-batal.</span>
          <span className="block text-[11.5px] text-ink3">Belum ada ukuran kinerja pekerja untuk sebagian besar unit; angka di bawah bukan ukuran seluruh pekerja.</span>
        </div>
      )}

      <div className="min-w-0 overflow-x-auto rounded-card bg-surface" data-testid={`tabel-${dasar}`}>
        <table className="w-full min-w-[520px] border-collapse text-left text-[13px]">
          <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink3">
            <th className="px-3 py-2">{dasar === "meja" ? "Meja" : `${d.pic.peran === "CORNER" ? "PIC Corner" : "PIC Meja"} (penugasan)`}</th>
            {dasar === "meja" && <><th className="px-3 py-2 text-right">Terjadwal</th><th className="px-3 py-2 text-right">Rencana terisi</th></>}
            <th className="px-3 py-2 text-right">Selesai bertanggal</th><th className="px-3 py-2">Durasi rata-rata</th>
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
            {baris.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-[13px] text-ink3" data-testid="kosong-kinerja">Belum ada kejadian selesai bertanggal pada periode ini — bukan berarti tidak ada produksi: {angka(s.posisiSaatIni)} unit sudah selesai menurut posisi saat ini ({angka(s.tanpaTanggal)} tanpa tanggal tercatat).</td></tr>}
          </tbody>
          <tfoot><tr className="text-[12.5px] font-semibold"><td className="px-3 py-2">Total selesai bertanggal (unik){dasar === "pic" && tdkPic > 0 ? ` · ${angka(tdkPic)} tidak tercatat` : ""}</td>{dasar === "meja" && <td colSpan={2} />}<td className="px-3 py-2 text-right tabular-nums" data-testid="total-selesai">{angka(s.bertanggalPeriode)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="m-0 text-[12px] text-ink3" data-testid="catatan-pic">{dasar === "pic" ? d.pic.catatan : "Meja = penetapan terakhir pada rencana/jadwal. Unit yang berpindah meja tetap dihitung sekali."} Rencana (terjadwal) dan pekerjaan aktual (selesai) dipisah; bukan skor performa.</p>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Grafik testid="grafik-kinerja" judul="Selesai bertanggal per hari" info={info("unit_selesai")} seri={s.perHari} kosongTeks="Belum ada kejadian selesai bertanggal pada periode ini (lihat posisi saat ini di kartu)." />
        <Card className="p-3" data-testid="belum-tersedia">
          <h3 className="m-0 text-[13.5px] font-bold text-ink">Cakupan & yang belum tersedia</h3>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12.5px] text-ink2">
            <li data-testid="catatan-selesai">{s.catatan}</li>
            {Object.keys(s.perSumber).length > 0 && <li>Sumber tanggal selesai (semua waktu): {Object.values(s.perSumber).map((x) => `${x.label} ${x.n}`).join(" · ")}</li>}
            <li>Target harian historis: {d.targetHistoris.tersedia ? "tersedia" : d.targetHistoris.catatan}</li>
            <li>Hasil QC: {d.qc.tersedia ? Object.entries(d.qc.hasil).map(([k, v]) => `${k} ${v}`).join(" · ") : d.qc.catatan}</li>
          </ul>
        </Card>
      </div>
      <DasarTanggal teks={`${d.dasarTanggal}; rencana: ${d.dasarJadwal}`} />
    </div>
  );
}
