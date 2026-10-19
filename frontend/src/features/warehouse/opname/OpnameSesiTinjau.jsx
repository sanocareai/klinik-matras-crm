import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EyeOff, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import JejakDokumen from "@/features/warehouse/dokumen/JejakDokumen.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen } from "@/features/warehouse/dokumen/KartuDokumen.jsx";
import { METODE_HITUNG } from "@/features/warehouse/dokumen/labelDokumen.js";
import { tanggalPendek, teksJumlah, waktuTeks } from "@/features/warehouse/dokumen/dokumenLogic.js";
import { satuan, RiwayatBaris, PengamatanBaris } from "./BarisHitung.jsx";
import { KELAS_PERGERAKAN, MODE_LABEL, SUMBER_LABEL, jamTeks, teksProgres } from "./opnameLogic.js";

// DETAIL SESI STOCK OPNAME MODEL 2 (halaman sesi): cakupan tersimpan, progres, dan — untuk pemeriksa/penyetuju — per bahan TIGA WAKTU terpisah (dihitung / disimpan / diposting), jumlah fisik,
// saldo sistem yang sebanding PADA WAKTU DIHITUNG, SELURUH pergerakan sejak bahan dihitung (diputuskan pemeriksa: sudah/belum ikut terhitung), dan selisih yang benar-benar perlu diselesaikan.
// Mengisi angka dilakukan di halaman hitung (/warehouse/stock-count/:id/hitung). Aturan pemisahan tugas tidak diubah.
const SPEC_TINJAU = {
  HITUNG_ULANG: { panel: { judul: "Hitung ulang?", tombol: "Ya, hitung ulang", peringatan: "Hitungan kembali ke tahap Sedang dihitung. Angka yang sudah ada tetap tersimpan dan boleh dikoreksi dengan alasan; keputusan pergerakan dan pemeriksaan hitungan direset.", bidang: [] } },
  SELESAIKAN_OPNAME: { panel: { judul: "Selesaikan opname dan bukukan selisih?", tombol: "Selesaikan & bukukan", peringatan: "Untuk tiap bahan berselisih, SATU penyesuaian dibukukan ke stok SEKARANG (selisih = jumlah fisik − saldo sistem pada waktu bahan itu dihitung, dengan pergerakan sesudahnya sesuai keputusan pemeriksa). Pergerakan yang terjadi sesudah bahan dihitung tidak diubah. Salah input diperbaiki lewat jalur koreksi resmi.", bidang: [] } },
  UBAH: null, BATALKAN: { panel: { judul: "Batalkan sesi opname ini?", tombol: "Ya, batalkan", peringatan: "Sesi tersimpan sebagai Dibatalkan beserta alasan. Hitungan tidak diposting; stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
};
const teksQty = (m, sat) => `${m.qty > 0 ? "+" : ""}${teksJumlah(m.qty)} ${sat}`;

export default function OpnameSesiTinjau({ r, id, onTutup, galat, memuat, muat, sibuk, setSibuk, versi }) {
  const [galatLokal, setGalatLokal] = useState(""); const [menandai, setMenandai] = useState(null); const [hanyaSelisih, setHanyaSelisih] = useState(true); const [batas, setBatas] = useState(60); const [alasan, setAlasan] = useState({}); const [riwayat, setRiwayat] = useState(null); const [cari, setCari] = useState("");
  const [ubahWaktu, setUbahWaktu] = useState(null); const [massal, setMassal] = useState(false); const [infoMassal, setInfoMassal] = useState("");
  const t = r.tampilan; const status = r.status; const p = r.progres; const aktif = r.lines.filter((l) => !l.excludedAt); const tinjauAda = aktif.some((l) => l.tinjau);
  const info = r.scopeInfo?.ringkasan;
  const SPEC = { ...SPEC_TINJAU, UBAH: { panel: { judul: "Ubah jadwal & catatan", tombol: "Simpan", peringatan: "Perubahan tercatat. Cakupan bahan tidak berubah di sini.", bidang: [{ nama: "jadwal", label: "Tanggal jadwal", tipe: "date", awal: r.scheduledDate ? String(r.scheduledDate).slice(0, 10) : "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } } };
  const baris = useMemo(() => aktif.map((l) => ({ l, tj: l.tinjau ?? null, selisih: l.tinjau?.selisih ?? null })), [aktif]);
  const berselisih = baris.filter((b) => b.tj?.berselisih);
  const gerak = baris.flatMap((b) => (b.tj?.transaksi.sejakPengamatan ?? []).map((m) => ({ ...m, l: b.l })));
  const kata = cari.trim().toLowerCase(); // pencarian menampilkan bahan mana pun (kode/nama), termasuk yang tidak berselisih
  const perluPerhatian = (b) => b.tj?.berselisih || b.l.perluPeriksa || (b.tj?.transaksi.belumDiputuskan ?? 0) > 0 || b.tj?.waktuTidakDiketahui;
  const tampil = kata ? baris.filter((b) => `${b.l.material.code} ${b.l.material.name}`.toLowerCase().includes(kata)) : (hanyaSelisih && tinjauAda ? baris.filter(perluPerhatian) : baris);
  const belumDitandai = r.sesi?.belumDitandai ?? 0; const tanpaWaktuN = r.sesi?.tanpaWaktu ?? 0; const tanpaAlasan = berselisih.filter((b) => !String(alasan[b.l.id] ?? b.l.reason ?? "").trim());
  const bisaTandai = !!r.izin?.tulis && ["IN_PROGRESS", "WAITING_REVIEW"].includes(status);
  const jumlahMassal = gerak.filter((m) => m.tanda === null && KELAS_PERGERAKAN[m.kelas]?.massal).length; const jumlahSatuSatu = gerak.filter((m) => m.tanda === null && !KELAS_PERGERAKAN[m.kelas]?.massal).length;
  const galatSelesai = tanpaWaktuN > 0 ? `${tanpaWaktuN} bahan belum punya waktu hitung (kapan barang dihitung). Lengkapi dulu.` : belumDitandai > 0 ? `${belumDitandai} pergerakan sejak waktu hitung belum diputuskan (sudah/belum ikut terhitung di fisik).` : tanpaAlasan.length ? `Alasan wajib diisi untuk selisih pada ${tanpaAlasan.map((b) => b.l.material.code).join(", ")}.` : "";

  const simpanAlasan = async () => { await Promise.all(Object.entries(alasan).map(([lineId, reason]) => api.updateStockCountLine(id, lineId, { reason }))); setAlasan({}); };
  const jalankan = async (kode, v = {}) => {
    setSibuk(true); setGalatLokal("");
    try {
      if (["SERAHKAN_HITUNGAN", "PERIKSA_HITUNGAN", "SELESAIKAN_OPNAME"].includes(kode) && Object.keys(alasan).length) await simpanAlasan();
      if (kode === "MULAI_HITUNG") await api.startStockCount(id);
      else if (kode === "SERAHKAN_HITUNGAN") await api.submitStockCount(id);
      else if (kode === "HITUNG_ULANG") await api.recountStockCount(id);
      else if (kode === "PERIKSA_HITUNGAN") await api.periksaHitungan(id);
      else if (kode === "SELESAIKAN_OPNAME") await api.completeStockCount(id);
      else if (kode === "UBAH") await api.updateStockCount(id, { scheduledDate: v.jadwal || null, notes: v.notes });
      else if (kode === "BATALKAN") await api.cancelStockCount(id, v.alasan);
      await muat(); setAlasan({});
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };
  const tandai = async (movementId, tercermin) => { setMenandai(movementId); setGalatLokal(""); try { await api.tandaiPergerakanSesi(id, movementId, tercermin); await muat(); } catch (e) { setGalatLokal(e.message); } finally { setMenandai(null); } };
  const putuskanMassal = async () => { setMassal(true); setGalatLokal(""); setInfoMassal(""); try { const h = await api.tandaiMassalPergerakanOpname(id, { tercermin: false, kelas: "SESUDAH_DISIMPAN" }); setInfoMassal(`${h.ditandai} pergerakan diputuskan "belum ikut terhitung".`); await muat(); } catch (e) { setGalatLokal(e.message); } finally { setMassal(false); } };
  const blind = r.sembunyikanSaldo;
  const identitas = [
    { label: "No. opname", isi: r.countNumber, testid: "id-nomor" }, { label: "Cakupan", isi: MODE_LABEL[r.scopeMode] ?? r.scopeMode, testid: "id-cakupan" }, { label: "Jumlah bahan", isi: p.total }, { label: "Jadwal", isi: tanggalPendek(r.scheduledDate) },
    { label: "Dimulai", isi: r.startedAt ? waktuTeks(r.startedAt) : "—" }, { label: "Ditugaskan ke", isi: r.assignedTo?.name }, { label: "Dibuat oleh", isi: r.createdBy?.name }, { label: "Ditinjau oleh", isi: r.reviewedBy?.name },
  ];
  const takDilacak = info?.tidakDilacak;

  return (
    <HalamanDokumen judul={r.countNumber} subjudul={`${MODE_LABEL[r.scopeMode] ?? "Hitungan"} · ${p.total} bahan`} onTutup={onTutup} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="stock opname"
      footer={<KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="opname ini" kaki={status === "WAITING_REVIEW" ? galatSelesai || "Pemisahan tugas: selisih hanya dibukukan penyetuju (Owner/Finance) yang bukan pembuat, penugas, atau pengisi hitungan; Opname Penuh juga wajib diperiksa petugas lain." : undefined} />}>
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur stock opname" catatan={r.notes}
        tambahan={blind ? <span className="inline-flex items-center gap-1 rounded-chip bg-accentbg px-2 py-1 text-[11px] text-accent"><EyeOff size={12} /> Blind count: saldo sistem disembunyikan sampai hitungan diserahkan</span> : null} />

      <Card className="space-y-3 p-4" data-testid="kartu-cakupan">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Cakupan sesi</h3>
        <p className="m-0 text-[13px] text-ink" data-testid="teks-cakupan">{info ? `${info.masuk} bahan dari ${info.bahanAktif} bahan aktif saat sesi dibuat` : `${p.total} bahan`} · daftar bahan disimpan di sesi (perubahan master sesudahnya tidak mengubahnya).</p>
        {info?.dasarCakupan && <p className="m-0 text-[12px] text-ink2" data-testid="dasar-cakupan">{info.dasarCakupan}</p>}
        {info && <div className="flex flex-wrap gap-1.5 text-[12px]"><Badge variant="neutral">Belum dikelompokkan: {info.belumDikelompokkan.masuk}</Badge><Badge variant="neutral">Nonaktif (tidak ikut): {info.nonaktif.jumlah}</Badge>{takDilacak?.jumlah > 0 && <Badge variant="neutral" data-testid="lencana-tak-dilacak">Tidak dilacak: {takDilacak.jumlah}{takDilacak.diikutkan ? ` (${takDilacak.diikutkan} diikutkan)` : " (tidak ikut)"}</Badge>}{info.pengecualian.totalBahanDikecualikan > 0 && <Badge variant="orange">Dikecualikan: {info.pengecualian.totalBahanDikecualikan}</Badge>}{p.dikeluarkan > 0 && <Badge variant="orange">Dikeluarkan saat sesi: {p.dikeluarkan}</Badge>}</div>}
        {takDilacak?.daftar?.length > 0 && (
          <details className="text-[12px] text-ink2" data-testid="daftar-tak-dilacak"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-accent">Lihat {takDilacak.daftar.length} bahan yang tidak dilacak</summary>
            <p className="m-0 mb-1 text-ink3">{takDilacak.alasanUmum}</p>
            <ul className="m-0 list-none space-y-0.5 p-0">{takDilacak.daftar.map((x) => <li key={x.materialId}><b className="text-ink">{x.kode}</b> {x.nama} {x.diikutkan ? <Badge variant="accent">diikutkan{r.scopeInfo?.ikutkanAlasan ? `: ${r.scopeInfo.ikutkanAlasan}` : ""}</Badge> : <span className="text-ink3">— tidak ikut</span>}</li>)}</ul></details>)}
        <div className="space-y-1.5"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[13px] font-semibold text-ink" data-testid="progres-sesi">{teksProgres(p)}</span>{p.perluPeriksa > 0 && <span className="text-[12px] text-orange">{p.perluPeriksa} perlu diperiksa</span>}{p.tanpaWaktu > 0 && <span className="text-[12px] text-orange" data-testid="tanpa-waktu-sesi">{p.tanpaWaktu} tanpa waktu hitung</span>}</div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={p.persen} aria-valuemin={0} aria-valuemax={100} aria-label="Progres hitung"><div className="h-full bg-accent" style={{ width: `${p.persen}%` }} /></div></div>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-0.5 p-0 text-[12px] text-ink2 sm:grid-cols-3">{p.perKelompok.map((k) => <li key={k.kode} className="flex justify-between"><span>{k.label}</span><b className="tabular-nums text-ink">{k.dihitung}/{k.total}</b></li>)}</ul>
        {["SCHEDULED", "IN_PROGRESS"].includes(status) && <Link to={`/warehouse/stock-count/${id}/hitung`} className="inline-flex min-h-11 items-center rounded-btn bg-accent px-4 text-[13px] font-semibold text-white" data-testid="buka-halaman-hitung">{status === "SCHEDULED" ? "Lihat daftar hitung" : "Buka halaman hitung"}</Link>}
        {status === "WAITING_REVIEW" && <p className="m-0 text-[12px] text-ink3">Hitungan sudah diserahkan. Untuk mengubah angka gunakan <b>Hitung ulang</b>; angka lama tersimpan di riwayat.</p>}
      </Card>

      {tinjauAda && (
        <Card className="space-y-3 p-4" data-testid="kartu-tinjau">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Tinjau per bahan ({berselisih.length} berselisih)</h3>
            <input type="search" value={cari} onChange={(e) => { setCari(e.target.value); setBatas(60); }} placeholder="Cari kode atau nama bahan…" aria-label="Cari bahan di tinjauan" data-testid="cari-tinjau" className="min-w-[160px] flex-1 rounded-btn border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]" />
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={hanyaSelisih} onChange={(e) => { setHanyaSelisih(e.target.checked); setBatas(60); }} data-testid="hanya-selisih" /> Hanya yang berselisih / perlu diperhatikan</label></div>
          <p className="m-0 text-[11.5px] text-ink3">Tiga waktu terpisah: <b>Dihitung</b> (barang diamati), <b>Disimpan</b> (angka masuk sistem), <b>Diposting</b> (transaksi ledger). Saldo sistem = ledger yang diposting <b>sebelum</b> bahan itu dihitung, ditambah pergerakan sesudahnya yang diputuskan sudah ikut terhitung di fisik. Semua pergerakan sejak bahan dihitung ditandai di bawah — tidak ada batas menit.</p>

          {infoMassal && <p className="m-0 text-[12px] text-ink2" role="status" data-testid="info-massal">{infoMassal}</p>}
          {belumDitandai > 0 && bisaTandai && (
            <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5" data-testid="panel-keputusan">
              <p className="m-0 text-[12px] font-bold text-ink">{belumDitandai} pergerakan sejak bahan dihitung menunggu keputusan</p>
              <p className="m-0 mt-0.5 text-[11.5px] text-ink2">Putuskan satu per satu apakah barangnya <b>sudah ikut terhitung</b> di jumlah fisik atau <b>belum</b>; sistem tidak menebak. Pergerakan <b>sesudah angka disimpan</b> dan tidak bertanggal mundur ({jumlahMassal}) boleh diputuskan sekaligus sebagai “belum ikut terhitung”. {jumlahSatuSatu} lainnya berisiko (serentak, saat dihitung, atau bertanggal mundur) dan harus diputuskan sendiri-sendiri.</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" onClick={putuskanMassal} disabled={massal || jumlahMassal === 0} className="max-sm:min-h-11" data-testid="tanda-massal">{massal ? <Loader2 size={14} className="animate-spin" /> : null} Putuskan {jumlahMassal} pergerakan sesudah disimpan: belum ikut terhitung</Button></div>
            </div>)}

          <ul className="m-0 list-none space-y-2 p-0" data-testid="daftar-tinjau">
            {tampil.slice(0, batas).map(({ l, tj }) => (
              <li key={l.id} className="rounded-btn border border-line bg-surface p-3 text-[12.5px]" data-testid="baris-tinjau" data-kode={l.material.code}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="font-semibold text-ink">{l.material.code}</span><span className="min-w-0 flex-1 text-ink2 [overflow-wrap:anywhere]">{l.material.name}</span>
                  {l.perluPeriksa && <Badge variant="orange">Perlu diperiksa</Badge>}{l.waktuTidakDiketahui && <Badge variant="orange" data-testid="lencana-tanpa-waktu">Waktu hitung belum diketahui</Badge>}{l.origin === "TAMBAHAN" && <Badge variant="accent">Ditambahkan</Badge>}</div>
                <dl className="m-0 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
                  <div><dt className="text-[11px] text-ink3">Jumlah fisik</dt><dd className="m-0 font-semibold tabular-nums text-ink" data-testid="fisik">{l.countedQty == null ? "—" : `${teksJumlah(Number(l.countedQty))} ${satuan(l.material.unit)}`}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Dihitung (pengamatan)</dt><dd className="m-0 text-ink2" data-testid="waktu-hitung">{l.observedAt ? `${jamTeks(l.observedAt)} · ${SUMBER_LABEL[l.observedSource] ?? ""}` : <span className="font-semibold text-orange">belum diketahui</span>}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Disimpan</dt><dd className="m-0 text-ink2" data-testid="waktu-simpan">{jamTeks(l.savedAt)}{l.countedBy?.nama ? ` · ${l.countedBy.nama}` : ""}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Saldo sistem saat dihitung</dt><dd className="m-0 tabular-nums text-ink2" data-testid="saldo-sebanding">{tj?.pembanding == null ? "—" : `${teksJumlah(tj.pembanding)} ${satuan(l.material.unit)}`}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Selisih</dt><dd className={`m-0 font-semibold tabular-nums ${tj?.selisih > 0 ? "text-green" : tj?.selisih < 0 ? "text-red" : "text-ink2"}`} data-testid="selisih">{tj?.selisih == null ? "—" : tj.selisih > 0 ? `+${teksJumlah(tj.selisih)}` : teksJumlah(tj.selisih)}</dd></div>
                </dl>
                {tj?.transaksi?.jumlah > 0 && (
                  <div className="mt-2 space-y-1.5" data-testid="transaksi-relevan">
                    <p className="m-0 text-[11.5px] font-semibold text-ink2">Pergerakan sejak bahan dihitung ({tj.transaksi.jumlah}){tj.transaksi.jumlah > tj.transaksi.sejakPengamatan.length ? ` — ${tj.transaksi.sejakPengamatan.length} pertama ditampilkan` : ""}</p>
                    <ul className="m-0 list-none space-y-1.5 p-0">
                      {tj.transaksi.sejakPengamatan.map((m) => (
                        <li key={m.id} className="rounded-btn bg-inset px-2.5 py-2 text-[12px]" data-testid="pergerakan-sejak" data-kelas={m.kelas}>
                          <p className="m-0 font-semibold text-ink">{m.type} {teksQty(m, satuan(l.material.unit))}{m.dokumen ? ` · ${m.dokumen}` : ""} <Badge variant={KELAS_PERGERAKAN[m.kelas]?.massal ? "neutral" : "orange"} data-testid="kelas-pergerakan">{KELAS_PERGERAKAN[m.kelas]?.label ?? m.kelas}</Badge></p>
                          <p className="m-0 text-[11px] text-ink3">Diposting {waktuTeks(m.at)}{m.tanggalKejadian ? ` · tanggal kejadian dokumen ${tanggalPendek(m.tanggalKejadian)}` : ""}{m.note ? ` · ${m.note}` : ""}</p>
                          <p className="m-0 text-[11px] text-ink3">{KELAS_PERGERAKAN[m.kelas]?.ket}</p>
                          {bisaTandai ? (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <Button size="sm" variant={m.tanda === "SUDAH_TERHITUNG" ? "primary" : "secondary"} disabled={menandai === m.id} onClick={() => tandai(m.id, true)} className="max-sm:min-h-11" data-testid="tanda-sudah">Sudah ikut terhitung di fisik</Button>
                              <Button size="sm" variant={m.tanda === "BELUM_TERHITUNG" ? "primary" : "secondary"} disabled={menandai === m.id} onClick={() => tandai(m.id, false)} className="max-sm:min-h-11" data-testid="tanda-belum">Belum ikut terhitung</Button>
                              {m.tanda === null && <span className="text-[11px] font-semibold text-red" data-testid="belum-diputuskan">belum diputuskan</span>}
                            </div>
                          ) : <p className="m-0 mt-1 text-[11.5px] font-semibold text-ink2">{m.tanda === "SUDAH_TERHITUNG" ? "Diputuskan: sudah ikut terhitung di fisik" : m.tanda === "BELUM_TERHITUNG" ? "Diputuskan: belum ikut terhitung" : "Belum diputuskan"}</p>}
                        </li>))}
                    </ul>
                  </div>)}
                {tj?.berselisih && status === "WAITING_REVIEW" && <label className="mt-2 block text-[12px] text-ink2">Alasan selisih (wajib)<input value={alasan[l.id] ?? l.reason ?? ""} onChange={(e) => setAlasan((a) => ({ ...a, [l.id]: e.target.value }))} placeholder="mis. hilang saat bongkar muat" data-testid="alasan-selisih" className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]" /></label>}
                {tj?.berselisih && status !== "WAITING_REVIEW" && l.reason && <p className="m-0 mt-1 text-[12px] text-ink2">Alasan: {l.reason}</p>}
                {(l.waktuTidakDiketahui || ubahWaktu === l.id) && (
                  <div className="mt-2"><PengamatanBaris countId={id} bisa={bisaTandai} onTersimpan={async () => { setUbahWaktu(null); await muat(); }}
                    b={{ id: l.id, counted: l.countedQty == null ? null : Number(l.countedQty), observedAt: l.observedAt, observedSource: l.observedSource, observedBy: l.observedBy, revision: l.revision, excluded: false }} /></div>)}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><Button size="sm" variant="ghost" onClick={() => setRiwayat(riwayat === l.id ? null : l.id)} className="max-sm:min-h-11">Riwayat angka &amp; waktu</Button>
                  {bisaTandai && l.countedQty != null && !l.waktuTidakDiketahui && <Button size="sm" variant="ghost" onClick={() => setUbahWaktu(ubahWaktu === l.id ? null : l.id)} className="max-sm:min-h-11" data-testid="buka-ubah-waktu">Waktu hitung</Button>}</div>
                {riwayat === l.id && <div className="mt-1"><RiwayatBaris countId={id} lineId={l.id} /></div>}
              </li>
            ))}
          </ul>
          {tampil.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-selisih">Tidak ada bahan berselisih atau perlu diperhatikan.</p>}
          {tampil.length > batas && <Button variant="secondary" size="sm" onClick={() => setBatas((x) => x + 60)} className="max-sm:min-h-11" data-testid="tampilkan-lagi-tinjau">Tampilkan lagi ({tampil.length - batas} lainnya)</Button>}
          {galatLokal && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatLokal}</p>}
        </Card>
      )}

      {["IN_PROGRESS", "WAITING_REVIEW", "COMPLETED"].includes(status) && (
        <div className="rounded-btn border-l-[3px] border-accent bg-accentbg px-3 py-2.5" data-testid="identitas-hitungan">
          <p className="m-0 text-[12px] font-bold text-ink">Petugas hitungan</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink2" data-testid="penghitung-hitungan">Dihitung oleh: {r.identitas?.penghitung?.length ? r.identitas.penghitung.map((x) => x.nama).join(", ") : "belum ada angka dimasukkan"}</p>
          <p className="m-0 text-[11.5px] text-ink2" data-testid="pemeriksa-hitungan">Diperiksa oleh: {r.identitas?.pemeriksa?.length ? r.identitas.pemeriksa.map((x) => x.nama).join(", ") : "belum diperiksa"}</p>
          {status === "WAITING_REVIEW" && <p className="m-0 mt-1 text-[11px] text-ink3">Pemeriksa harus petugas lain dari penghitung. Pemeriksaan batal bila angka atau waktu hitung diubah, atau hitungan diulang.</p>}
        </div>
      )}
      {["COMPLETED"].includes(status) || !["CANCELLED"].includes(status) ? <KartuJalurKoreksi tipe="STOCK_COUNT" id={id} versi={`${status}-${versi}`} ringkas /> : null}
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/stock-count" />
    </HalamanDokumen>
  );
}
