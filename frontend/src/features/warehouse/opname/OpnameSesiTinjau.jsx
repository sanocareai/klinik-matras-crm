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
import { satuan, RiwayatBaris } from "./BarisHitung.jsx";
import { MODE_LABEL, jamTeks, teksProgres } from "./opnameLogic.js";

// DETAIL SESI STOCK OPNAME MODEL 2 (halaman sesi): cakupan tersimpan, progres, dan — untuk pemeriksa/penyetuju — per bahan: jumlah fisik + waktu dihitung + petugas, saldo sistem yang sebanding PADA WAKTU ITU,
// transaksi relevan selama sesi, dan selisih yang benar-benar perlu diselesaikan. Mengisi angka dilakukan di halaman hitung (/warehouse/stock-count/:id/hitung). Aturan pemisahan tugas tidak diubah.
const SPEC_TINJAU = {
  HITUNG_ULANG: { panel: { judul: "Hitung ulang?", tombol: "Ya, hitung ulang", peringatan: "Hitungan kembali ke tahap Sedang dihitung. Angka yang sudah ada tetap tersimpan dan boleh dikoreksi dengan alasan; tanda pergerakan jendela ragu dan pemeriksaan hitungan direset.", bidang: [] } },
  SELESAIKAN_OPNAME: { panel: { judul: "Selesaikan opname dan bukukan selisih?", tombol: "Selesaikan & bukukan", peringatan: "Untuk tiap bahan berselisih, SATU penyesuaian dibukukan ke stok SEKARANG (selisih = jumlah fisik − saldo sistem pada waktu bahan itu dihitung). Transaksi yang terjadi sesudah bahan dihitung tidak diubah. Salah input diperbaiki lewat jalur koreksi resmi.", bidang: [] } },
  UBAH: null, BATALKAN: { panel: { judul: "Batalkan sesi opname ini?", tombol: "Ya, batalkan", peringatan: "Sesi tersimpan sebagai Dibatalkan beserta alasan. Hitungan tidak diposting; stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
};

export default function OpnameSesiTinjau({ r, id, onTutup, galat, memuat, muat, sibuk, setSibuk, versi }) {
  const [galatLokal, setGalatLokal] = useState(""); const [menandai, setMenandai] = useState(null); const [hanyaSelisih, setHanyaSelisih] = useState(true); const [batas, setBatas] = useState(60); const [alasan, setAlasan] = useState({}); const [riwayat, setRiwayat] = useState(null);
  const t = r.tampilan; const status = r.status; const p = r.progres; const aktif = r.lines.filter((l) => !l.excludedAt); const tinjauAda = aktif.some((l) => l.tinjau);
  const info = r.scopeInfo?.ringkasan;
  const SPEC = { ...SPEC_TINJAU, UBAH: { panel: { judul: "Ubah jadwal & catatan", tombol: "Simpan", peringatan: "Perubahan tercatat. Cakupan bahan tidak berubah di sini.", bidang: [{ nama: "jadwal", label: "Tanggal jadwal", tipe: "date", awal: r.scheduledDate ? String(r.scheduledDate).slice(0, 10) : "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } } };
  const baris = useMemo(() => aktif.map((l) => ({ l, tj: l.tinjau ?? null, selisih: l.tinjau?.selisih ?? null })), [aktif]);
  const berselisih = baris.filter((b) => b.tj?.berselisih);
  const ragu = baris.flatMap((b) => (b.tj?.transaksi.jendelaRagu ?? []).map((m) => ({ ...m, l: b.l })));
  const tampil = (hanyaSelisih && tinjauAda ? baris.filter((b) => b.tj?.berselisih || b.l.perluPeriksa || (b.tj?.transaksi.belumDitandai ?? 0) > 0) : baris);
  const belumDitandai = r.sesi?.belumDitandai ?? 0; const tanpaAlasan = berselisih.filter((b) => !String(alasan[b.l.id] ?? b.l.reason ?? "").trim());
  const galatSelesai = belumDitandai > 0 ? `${belumDitandai} pergerakan di jendela ${r.jendelaRaguMenit} menit sebelum waktu hitung belum ditandai (sudah/belum tercermin di fisik).` : tanpaAlasan.length ? `Alasan wajib diisi untuk selisih pada ${tanpaAlasan.map((b) => b.l.material.code).join(", ")}.` : "";

  const simpanAlasan = async () => { await Promise.all(Object.entries(alasan).map(([lineId, reason]) => api.updateStockCountLine(id, lineId, { reason }))); setAlasan({}); };
  const jalankan = async (kode, v = {}) => {
    setSibuk(true); setGalatLokal("");
    try {
      if (["SERAHKAN_HITUNGAN", "SELESAIKAN_OPNAME"].includes(kode) && Object.keys(alasan).length) await simpanAlasan();
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
  const blind = r.sembunyikanSaldo;
  const identitas = [
    { label: "No. opname", isi: r.countNumber, testid: "id-nomor" }, { label: "Cakupan", isi: MODE_LABEL[r.scopeMode] ?? r.scopeMode, testid: "id-cakupan" }, { label: "Jumlah bahan", isi: p.total }, { label: "Jadwal", isi: tanggalPendek(r.scheduledDate) },
    { label: "Dimulai", isi: r.startedAt ? waktuTeks(r.startedAt) : "—" }, { label: "Ditugaskan ke", isi: r.assignedTo?.name }, { label: "Dibuat oleh", isi: r.createdBy?.name }, { label: "Ditinjau oleh", isi: r.reviewedBy?.name },
  ];

  return (
    <HalamanDokumen judul={r.countNumber} subjudul={`${MODE_LABEL[r.scopeMode] ?? "Hitungan"} · ${p.total} bahan`} onTutup={onTutup} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="stock opname"
      footer={<KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="opname ini" kaki={status === "WAITING_REVIEW" ? galatSelesai || "Pemisahan tugas: selisih hanya dibukukan penyetuju (Owner/Finance) yang bukan pembuat, penugas, atau pengisi hitungan; Opname Penuh juga wajib diperiksa petugas lain." : undefined} />}>
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur stock opname" catatan={r.notes}
        tambahan={blind ? <span className="inline-flex items-center gap-1 rounded-chip bg-accentbg px-2 py-1 text-[11px] text-accent"><EyeOff size={12} /> Blind count: saldo sistem disembunyikan sampai hitungan diserahkan</span> : null} />

      <Card className="space-y-3 p-4" data-testid="kartu-cakupan">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Cakupan sesi</h3>
        <p className="m-0 text-[13px] text-ink" data-testid="teks-cakupan">{info ? `${info.masuk} bahan dari ${info.bahanAktif} bahan aktif saat sesi dibuat` : `${p.total} bahan`} · daftar bahan disimpan di sesi (perubahan master sesudahnya tidak mengubahnya).</p>
        {info && <div className="flex flex-wrap gap-1.5 text-[12px]"><Badge variant="neutral">Belum dikelompokkan: {info.belumDikelompokkan.masuk}</Badge><Badge variant="neutral">Nonaktif (tidak ikut): {info.nonaktif.jumlah}</Badge>{info.pengecualian.totalBahanDikecualikan > 0 && <Badge variant="orange">Dikecualikan: {info.pengecualian.totalBahanDikecualikan}</Badge>}{p.dikeluarkan > 0 && <Badge variant="orange">Dikeluarkan saat sesi: {p.dikeluarkan}</Badge>}</div>}
        <div className="space-y-1.5"><div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[13px] font-semibold text-ink" data-testid="progres-sesi">{teksProgres(p)}</span>{p.perluPeriksa > 0 && <span className="text-[12px] text-orange">{p.perluPeriksa} perlu diperiksa</span>}</div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-inset" role="progressbar" aria-valuenow={p.persen} aria-valuemin={0} aria-valuemax={100} aria-label="Progres hitung"><div className="h-full bg-accent" style={{ width: `${p.persen}%` }} /></div></div>
        <ul className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-0.5 p-0 text-[12px] text-ink2 sm:grid-cols-3">{p.perKelompok.map((k) => <li key={k.kode} className="flex justify-between"><span>{k.label}</span><b className="tabular-nums text-ink">{k.dihitung}/{k.total}</b></li>)}</ul>
        {["SCHEDULED", "IN_PROGRESS"].includes(status) && <Link to={`/warehouse/stock-count/${id}/hitung`} className="inline-flex min-h-11 items-center rounded-btn bg-accent px-4 text-[13px] font-semibold text-white" data-testid="buka-halaman-hitung">{status === "SCHEDULED" ? "Lihat daftar hitung" : "Buka halaman hitung"}</Link>}
        {status === "WAITING_REVIEW" && <p className="m-0 text-[12px] text-ink3">Hitungan sudah diserahkan. Untuk mengubah angka gunakan <b>Hitung ulang</b>; angka lama tersimpan di riwayat.</p>}
      </Card>

      {tinjauAda && (
        <Card className="space-y-3 p-4" data-testid="kartu-tinjau">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Tinjau per bahan ({berselisih.length} berselisih)</h3>
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink2 max-sm:min-h-11"><input type="checkbox" checked={hanyaSelisih} onChange={(e) => { setHanyaSelisih(e.target.checked); setBatas(60); }} data-testid="hanya-selisih" /> Hanya yang berselisih / perlu diperiksa</label></div>
          <p className="m-0 text-[11.5px] text-ink3">Saldo sistem = ledger sampai <b>waktu bahan itu dihitung</b>. Transaksi sesudah waktu hitung tidak ikut pembanding dan tetap utuh di ledger.</p>
          <ul className="m-0 list-none space-y-2 p-0" data-testid="daftar-tinjau">
            {tampil.slice(0, batas).map(({ l, tj }) => (
              <li key={l.id} className="rounded-btn border border-line bg-surface p-3 text-[12.5px]" data-testid="baris-tinjau" data-kode={l.material.code}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="font-semibold text-ink">{l.material.code}</span><span className="min-w-0 flex-1 text-ink2 [overflow-wrap:anywhere]">{l.material.name}</span>
                  {l.perluPeriksa && <Badge variant="orange">Perlu diperiksa</Badge>}{l.origin === "TAMBAHAN" && <Badge variant="accent">Ditambahkan</Badge>}</div>
                <dl className="m-0 mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                  <div><dt className="text-[11px] text-ink3">Jumlah fisik</dt><dd className="m-0 font-semibold tabular-nums text-ink" data-testid="fisik">{l.countedQty == null ? "—" : `${teksJumlah(Number(l.countedQty))} ${satuan(l.material.unit)}`}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Dihitung</dt><dd className="m-0 text-ink2" data-testid="waktu-hitung">{jamTeks(l.countedAt)}{l.countedBy?.nama ? ` · ${l.countedBy.nama}` : ""}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Saldo sistem saat itu</dt><dd className="m-0 tabular-nums text-ink2" data-testid="saldo-sebanding">{tj ? `${teksJumlah(tj.pembanding)} ${satuan(l.material.unit)}` : "—"}</dd></div>
                  <div><dt className="text-[11px] text-ink3">Selisih</dt><dd className={`m-0 font-semibold tabular-nums ${tj?.selisih > 0 ? "text-green" : tj?.selisih < 0 ? "text-red" : "text-ink2"}`} data-testid="selisih">{tj?.selisih == null ? "—" : tj.selisih > 0 ? `+${teksJumlah(tj.selisih)}` : teksJumlah(tj.selisih)}</dd></div>
                </dl>
                {tj && (tj.transaksi.sebelumHitung > 0 || tj.transaksi.setelahHitungJumlah > 0 || tj.transaksi.jendelaRagu.length > 0) && (
                  <p className="m-0 mt-1.5 text-[11.5px] text-ink3" data-testid="transaksi-relevan">Transaksi selama sesi: {tj.transaksi.sebelumHitung} sebelum dihitung (sudah ikut saldo), {tj.transaksi.jendelaRagu.length} di jendela ragu, {tj.transaksi.setelahHitungJumlah} sesudah dihitung (tidak ikut pembanding){tj.transaksi.setelahHitung.length ? `: ${tj.transaksi.setelahHitung.slice(0, 3).map((m) => `${m.type} ${m.qty > 0 ? "+" : ""}${m.qty}${m.dokumen ? ` (${m.dokumen})` : ""}`).join(", ")}` : ""}.</p>)}
                {tj?.berselisih && status === "WAITING_REVIEW" && <label className="mt-2 block text-[12px] text-ink2">Alasan selisih (wajib)<input value={alasan[l.id] ?? l.reason ?? ""} onChange={(e) => setAlasan((a) => ({ ...a, [l.id]: e.target.value }))} placeholder="mis. hilang saat bongkar muat" data-testid="alasan-selisih" className="mt-1 w-full rounded-btn border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-accent max-sm:min-h-11 max-sm:text-[16px]" /></label>}
                {tj?.berselisih && status !== "WAITING_REVIEW" && l.reason && <p className="m-0 mt-1 text-[12px] text-ink2">Alasan: {l.reason}</p>}
                <div className="mt-1.5"><Button size="sm" variant="ghost" onClick={() => setRiwayat(riwayat === l.id ? null : l.id)} className="max-sm:min-h-11">Riwayat angka</Button>{riwayat === l.id && <div className="mt-1"><RiwayatBaris countId={id} lineId={l.id} /></div>}</div>
              </li>
            ))}
          </ul>
          {tampil.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-selisih">Tidak ada bahan berselisih atau perlu diperiksa.</p>}
          {tampil.length > batas && <Button variant="secondary" size="sm" onClick={() => setBatas((x) => x + 60)} className="max-sm:min-h-11" data-testid="tampilkan-lagi-tinjau">Tampilkan lagi ({tampil.length - batas} lainnya)</Button>}
          {galatLokal && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatLokal}</p>}
        </Card>
      )}

      {ragu.length > 0 && (
        <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5" data-testid="pergerakan-sesi">
          <p className="m-0 text-[12px] font-bold text-ink">Pergerakan di jendela ragu ({r.jendelaRaguMenit} menit sebelum waktu hitung)</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink2">Transaksi sesaat sebelum bahan dihitung mungkin belum tercermin di fisik. Tandai satu per satu; sistem tidak menebak. Hanya bahan ini yang menahan penyelesaian, bukan seluruh sesi.</p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {ragu.map((m) => (
              <li key={m.id} className="rounded-btn bg-surface px-2.5 py-2 text-[12px]">
                <p className="m-0 font-semibold text-ink">{m.l.material.code} · {m.type} {m.qty > 0 ? "+" : ""}{m.qty} {satuan(m.l.material.unit)}</p>
                <p className="m-0 text-[11px] text-ink3">{waktuTeks(m.at)}{m.dokumen ? ` · ${m.dokumen}` : ""}{m.note ? ` · ${m.note}` : ""} · bahan dihitung {jamTeks(m.l.countedAt)}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant={m.tanda === "SUDAH_TERHITUNG" ? "primary" : "secondary"} disabled={menandai === m.id} onClick={() => tandai(m.id, true)} className="max-sm:min-h-11">Sudah masuk hitungan fisik</Button>
                  <Button size="sm" variant={m.tanda === "BELUM_TERHITUNG" ? "primary" : "secondary"} disabled={menandai === m.id} onClick={() => tandai(m.id, false)} className="max-sm:min-h-11">Belum masuk hitungan</Button>
                  {m.tanda === null && <span className="text-[11px] font-semibold text-red">belum ditandai</span>}
                </div>
              </li>))}
          </ul>
        </div>
      )}

      {["IN_PROGRESS", "WAITING_REVIEW", "COMPLETED"].includes(status) && (
        <div className="rounded-btn border-l-[3px] border-accent bg-accentbg px-3 py-2.5" data-testid="identitas-hitungan">
          <p className="m-0 text-[12px] font-bold text-ink">Petugas hitungan</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink2" data-testid="penghitung-hitungan">Dihitung oleh: {r.identitas?.penghitung?.length ? r.identitas.penghitung.map((x) => x.nama).join(", ") : "belum ada angka dimasukkan"}</p>
          <p className="m-0 text-[11.5px] text-ink2" data-testid="pemeriksa-hitungan">Diperiksa oleh: {r.identitas?.pemeriksa?.length ? r.identitas.pemeriksa.map((x) => x.nama).join(", ") : "belum diperiksa"}</p>
          {status === "WAITING_REVIEW" && <p className="m-0 mt-1 text-[11px] text-ink3">Pemeriksa harus petugas lain dari penghitung. Pemeriksaan batal bila angka diubah atau hitungan diulang.</p>}
        </div>
      )}
      {["COMPLETED"].includes(status) || !["CANCELLED"].includes(status) ? <KartuJalurKoreksi tipe="STOCK_COUNT" id={id} versi={`${status}-${versi}`} ringkas /> : null}
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/stock-count" />
    </HalamanDokumen>
  );
}
