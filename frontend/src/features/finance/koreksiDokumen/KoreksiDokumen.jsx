import React, { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { api } from "@/api.js";
import { usePinStepUp, perluPin, lupakanStepUp } from "@/features/finance/KoreksiAman.jsx";
import { InputUang, formatUang } from "@/features/finance/shared.jsx";
import { KartuPanel, KotakAngka, KotakCatatan } from "@/features/finance/laporanTerinci/ui.jsx";
import { tanggalPanjang } from "@/features/finance/laporanTerinci/logic.js";
import {
  KELAS_LABEL, KELAS_NADA, PENYEBAB_LABEL, TAHAN_LABEL, dasarBawaan, tanggalDariDasar, susunBodyAkui, susunBodyHarga, susunBodyAtribusi, ringkasDampak, kunciBaruKoreksi,
} from "./logic.js";

// KOREKSI PER DOKUMEN — satu dokumen per langkah. Tidak ada tombol massal. Semua aturan, bukti, dan angka dihitung SERVER; layar ini menampilkan bukti → pratinjau → keputusan.
// Menulis = PIN Finance + alasan + Idempotency-Key (hanya Admin/Owner; peran lain melihat penolakan server).

/** Kirim dengan PIN step-up; bila token kedaluwarsa minta ulang SEKALI. null = pengguna membatalkan dialog PIN. */
async function denganPin(minta, kirim) {
  for (let percobaan = 0; percobaan < 2; percobaan++) {
    const token = await minta();
    if (!token) return null;
    try { return await kirim(token); } catch (e) { if (perluPin(e) && percobaan === 0) { lupakanStepUp(); continue; } throw e; }
  }
  return null;
}

const Baris = ({ label, children }) => (
  <div className="grid grid-cols-1 gap-x-3 rounded-lg bg-inset px-3 py-1.5 text-[12.5px] sm:grid-cols-[150px_1fr]"><div className="text-ink3">{label}</div><div className="min-w-0 break-words">{children || <span className="text-ink3">—</span>}</div></div>
);

export default function KoreksiDokumen({ periode, onSelesai }) {
  const [tab, setTab] = useState("pengakuan");
  return (
    <div className="space-y-3" data-testid="koreksi-dokumen">
      <KotakCatatan>Koreksi dilakukan <strong>satu dokumen per langkah</strong>, dengan bukti, pratinjau jurnal, alasan tertulis, dan PIN Finance. Sistem tidak menebak harga, tanggal, atau nilai, dan tidak ada tombol massal. Hanya Admin/Owner yang dapat menyimpan.</KotakCatatan>
      <nav className="flex gap-1.5" aria-label="Jenis koreksi">
        <Button size="sm" variant={tab === "pengakuan" ? "secondary" : "neutral"} onClick={() => setTab("pengakuan")} aria-pressed={tab === "pengakuan"} data-testid="koreksi-tab-pengakuan" className="max-sm:min-h-11">Pengakuan Pendapatan</Button>
        <Button size="sm" variant={tab === "atribusi" ? "secondary" : "neutral"} onClick={() => setTab("atribusi")} aria-pressed={tab === "atribusi"} data-testid="koreksi-tab-atribusi" className="max-sm:min-h-11">Atribusi Beban Divisi</Button>
      </nav>
      {tab === "pengakuan" ? <TabPengakuan onSelesai={onSelesai} /> : <TabAtribusi periode={periode} onSelesai={onSelesai} />}
    </div>
  );
}

// ─── PENGAKUAN ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function TabPengakuan({ onSelesai }) {
  const [kelas, setKelas] = useState("");
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  const [buka, setBuka] = useState(null);
  const muat = useCallback(async () => { setGalat(""); try { setD(await api.getKoreksiPengakuan(kelas)); } catch (e) { setGalat(e.message); } }, [kelas]);
  useEffect(() => { muat(); }, [muat]);
  if (galat) return <KotakCatatan tone="red">{galat}</KotakCatatan>;
  if (!d) return <p className="py-6 text-center text-[13px] text-ink3"><Loader2 className="mr-1 inline animate-spin" size={14} />Memuat…</p>;
  const r = d.ringkasan;
  return (
    <KartuPanel testid="panel-koreksi-pengakuan" judul="Order diserahkan yang belum diakui pendapatannya" deskripsi={`Cutoff buku besar ${tanggalPanjang(d.cutoff)}. Jumlah & nilai dihitung ulang dari data saat ini, bukan dari audit lama.`}>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="Perlu keputusan" nilai={String(r.perluKeputusan.jumlah)} sub={formatUang(r.perluKeputusan.nilai)} tone={r.perluKeputusan.jumlah ? "orange" : undefined} />
        <KotakAngka label="Harga belum diisi (Rp0)" nilai={String(r.nilaiNol.jumlah)} tone={r.nilaiNol.jumlah ? "red" : undefined} sub="nilai tidak terbukti" />
        <KotakAngka label="Riwayat sebelum buku besar" nilai={String(r.riwayatPraBuku.jumlah)} sub={`${formatUang(r.riwayatPraBuku.nilai)} — hanya dihitung`} />
        <KotakAngka label="Lain-lain" nilai={String(r.lain.jumlah)} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Saring kelas">
        {[["", "Perlu tindakan"], ["RIWAYAT_PRA_BUKU", "Riwayat pra-buku"], ["LAIN", "Lain-lain"]].map(([k, l]) => (
          <Button key={k} size="sm" variant={kelas === k ? "secondary" : "neutral"} onClick={() => setKelas(k)} aria-pressed={kelas === k} className="max-sm:min-h-11">{l}</Button>
        ))}
      </div>
      {d.daftar.length === 0 && <p className="py-4 text-center text-[13px] text-ink3" data-testid="pengakuan-kosong">Tidak ada order pada kelompok ini.</p>}
      <ul className="m-0 list-none space-y-1.5 p-0" data-testid="daftar-pengakuan">
        {d.daftar.map((x) => (
          <li key={x.orderId}>
            <button type="button" onClick={() => setBuka(x.orderId)} className="flex w-full min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-left text-[12.5px] hover:bg-inset" data-testid={`pengakuan-${x.nomor}`}>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{x.nomor}</span><Badge variant={KELAS_NADA[x.kelas] ?? "neutral"}>{KELAS_LABEL[x.kelas] ?? x.kelas}</Badge></span>
                <span className="mt-0.5 block text-ink3">{x.pelanggan} · {x.status} / {x.statusBayar} · serah {x.tanggalSerah ? tanggalPanjang(x.tanggalSerah) : "tidak terbukti"} · dibayar {formatUang(x.dibayar)}</span>
                {x.tahan.length > 0 && <span className="mt-0.5 block text-[11.5px] text-orange">{x.tahan.map((t) => TAHAN_LABEL[t.kode] ?? t.kode).join(" · ")}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatUang(x.nilai)}</span>
            </button>
          </li>
        ))}
      </ul>
      {buka && <DetailPengakuan orderId={buka} onClose={() => setBuka(null)} onSelesai={() => { setBuka(null); muat(); onSelesai?.(); }} />}
    </KartuPanel>
  );
}

function DetailPengakuan({ orderId, onClose, onSelesai }) {
  const { minta, dialogPin } = usePinStepUp();
  const [det, setDet] = useState(null);
  const [galat, setGalat] = useState("");
  const [f, setF] = useState({ dasarTanggal: "", tanggal: "", alasan: "", buktiReferensi: "", akuiPraCutoff: false });
  const [harga, setHarga] = useState({}); const [h, setH] = useState({ buktiHarga: "", alasan: "" });
  const [pratinjau, setPratinjau] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(async () => {
    try { const x = await api.getKoreksiPengakuanDetail(orderId); setDet(x); const dasar = dasarBawaan(x); setF((p) => ({ ...p, dasarTanggal: dasar, tanggal: tanggalDariDasar(x, dasar) })); } catch (e) { setGalat(e.message); }
  }, [orderId]);
  useEffect(() => { muat(); }, [muat]);
  const ubahDasar = (dasar) => { setPratinjau(null); setF((p) => ({ ...p, dasarTanggal: dasar, tanggal: tanggalDariDasar(det, dasar) })); };
  const akui = det ? susunBodyAkui(det, f) : { body: {}, galat: "Memuat" };
  const adaNol = det?.items?.some((i) => !i.harga);
  const hg = det ? susunBodyHarga(det, harga, h) : { body: {}, galat: "Memuat" };
  const jalankan = async (fn) => { setSibuk(true); setGalat(""); try { await fn(); } catch (e) { setGalat(e.message); } finally { setSibuk(false); } };
  const lihatPratinjau = () => jalankan(async () => { const r = await api.kirimKoreksiPengakuan(orderId, "akui", { ...akui.body, preview: true }); setPratinjau(r.pratinjau); });
  const simpan = () => jalankan(async () => { const key = kunciBaruKoreksi("akui"); const r = await denganPin(minta, (t) => api.kirimKoreksiPengakuan(orderId, "akui", akui.body, { stepUp: t, idempotencyKey: key })); if (r) onSelesai(); });
  const lihatHarga = () => jalankan(async () => { const r = await api.kirimKoreksiPengakuan(orderId, "harga", { ...hg.body, preview: true }); setPratinjau({ harga: r.pratinjau }); });
  const simpanHarga = () => jalankan(async () => { const key = kunciBaruKoreksi("harga"); const r = await denganPin(minta, (t) => api.kirimKoreksiPengakuan(orderId, "harga", hg.body, { stepUp: t, idempotencyKey: key })); if (r) { setPratinjau(null); setHarga({}); await muat(); } });
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={det ? `Pengakuan ${det.nomor}` : "Pengakuan pendapatan"} description={det ? `${det.pelanggan} · ${det.kategori}` : ""} className="w-[760px] max-w-[96vw]"
      footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11">Tutup</Button>}>
      {dialogPin}
      {!det && !galat && <p className="py-6 text-center text-[13px] text-ink3"><Loader2 className="mr-1 inline animate-spin" size={14} />Memuat…</p>}
      {galat && <KotakCatatan tone="red" testid="koreksi-galat">{galat}</KotakCatatan>}
      {det && (
        <div className="space-y-3 text-[12.5px]" data-testid="detail-pengakuan">
          <section className="space-y-1" aria-label="Bukti sumber">
            <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Bukti sumber</p>
            <Baris label="Status order">{det.status} / {det.statusBayar} · dibuat {tanggalPanjang(det.tanggalOrder)}</Baris>
            <Baris label="Nilai order">{formatUang(det.nilaiKotor)}{det.ongkir ? ` + ongkir ${formatUang(det.ongkir)}` : ""}{det.notaKredit ? ` · Nota Kredit ${formatUang(det.notaKredit)}` : ""}</Baris>
            <Baris label="Tanggal serah (POD)">{det.bukti.serah ? `${tanggalPanjang(det.bukti.serah.tanggal)} · ${det.bukti.serah.diverifikasi ? "POD terverifikasi" : "POD belum diverifikasi"}` : "Tidak ada pengiriman selesai"}</Baris>
            <Baris label="Riwayat status serah">{det.bukti.statusDiserahkan ? `${tanggalPanjang(det.bukti.statusDiserahkan.tanggal)} · ${det.bukti.statusDiserahkan.dari} → ${det.bukti.statusDiserahkan.ke}${det.bukti.statusDiserahkan.oleh ? ` oleh ${det.bukti.statusDiserahkan.oleh}` : ""}` : "Tidak ada perpindahan status ke serah"}</Baris>
            <Baris label="Pembayaran">{det.bukti.pembayaran.length ? det.bukti.pembayaran.map((p) => `${formatUang(p.jumlah)} ${p.metode} ${tanggalPanjang(p.tanggal)}${p.terverifikasi ? "" : " (belum diverifikasi)"}${p.dijurnal ? ` · jurnal ${p.dijurnal.nomor}` : " · belum dijurnal"}`).join("; ") : "Tidak ada pembayaran tercatat"}</Baris>
            <Baris label="Uang muka di buku">{formatUang(det.bukti.uangMukaDiBuku)}</Baris>
            {det.bukti.gapSistem.length > 0 && <Baris label="Gap sistem">{det.bukti.gapSistem.map((g) => `${g.alasan} (${tanggalPanjang(g.tanggal)})`).join("; ")}</Baris>}
            {det.items.map((i) => <Baris key={i.id} label="Item">{i.nama} — {i.harga ? formatUang(i.harga) : <span className="font-semibold text-red">Rp0</span>}{i.hargaKatalog ? ` (acuan katalog ${formatUang(i.hargaKatalog)}, bukan harga)` : ""}</Baris>)}
          </section>
          <section className="space-y-1" aria-label="Penyebab">
            <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Penyebab (hanya yang terbukti)</p>
            {det.penyebab.length === 0 ? <p className="m-0 text-ink3">—</p> : det.penyebab.map((p) => <Baris key={p.kode} label={PENYEBAB_LABEL[p.kode] ?? p.kode}>{p.uraian}</Baris>)}
          </section>
          {det.tahan.length > 0 && (
            <KotakCatatan tone="orange" testid="alasan-tertahan">
              <strong>Tertahan:</strong>
              <ul className="m-0 mt-1 list-disc pl-4">{det.tahan.map((t) => <li key={t.kode}>{t.pesan}</li>)}</ul>
            </KotakCatatan>
          )}
          {det.pengakuan.aktif && <KotakCatatan tone="green">Sudah diakui di jurnal {det.pengakuan.aktif.nomorJurnal} ({tanggalPanjang(det.pengakuan.aktif.tanggal)}).</KotakCatatan>}

          {adaNol && !det.pengakuan.aktif && (
            <section className="space-y-2 rounded-xl border border-[color:var(--hairline)] p-3" aria-label="Tetapkan harga" data-testid="form-harga">
              <p className="m-0 font-semibold">1. Tetapkan harga (item Rp0)</p>
              <p className="m-0 text-ink3">Harga hanya dari penawaran/kesepakatan yang Anda miliki — sistem tidak menebak. Menyimpan harga TIDAK memposting jurnal.</p>
              {det.items.filter((i) => !i.harga).map((i) => (
                <Field key={i.id} label={i.nama}><InputUang value={harga[i.id]} onChange={(v) => { setPratinjau(null); setHarga((p) => ({ ...p, [i.id]: v })); }} placeholder="Harga (Rp)" aria-label={`Harga ${i.nama}`} /></Field>
              ))}
              <Field label="Bukti harga" required hint="Nomor penawaran / pesan / kesepakatan"><Input value={h.buktiHarga} onChange={(e) => setH({ ...h, buktiHarga: e.target.value })} /></Field>
              <Field label="Alasan" required><Input value={h.alasan} onChange={(e) => setH({ ...h, alasan: e.target.value })} /></Field>
              {hg.galat && <p className="m-0 text-[11.5px] text-ink3">{hg.galat}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="neutral" disabled={!!hg.galat || sibuk} onClick={lihatHarga} className="max-sm:min-h-11">Lihat pratinjau harga</Button>
                <Button size="sm" disabled={!!hg.galat || sibuk || !pratinjau?.harga} onClick={simpanHarga} className="max-sm:min-h-11" data-testid="simpan-harga">Simpan harga (PIN)</Button>
              </div>
              {pratinjau?.harga && <p className="m-0 text-[12px]" data-testid="pratinjau-harga">Nilai order: {formatUang(pratinjau.harga.valueSebelum)} → <strong>{formatUang(pratinjau.harga.valueSesudah)}</strong>. {pratinjau.harga.dampakSales}</p>}
            </section>
          )}

          {!det.pengakuan.aktif && !adaNol && (
            <section className="space-y-2 rounded-xl border border-[color:var(--hairline)] p-3" aria-label="Akui pendapatan" data-testid="form-akui">
              <p className="m-0 font-semibold">Akui pendapatan</p>
              <Field label="Dasar tanggal pengakuan" required>
                <select value={f.dasarTanggal} onChange={(e) => ubahDasar(e.target.value)} className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm max-sm:h-11" aria-label="Dasar tanggal" data-testid="dasar-tanggal">
                  <option value="">Pilih dasar…</option>
                  {det.pilihanTanggal.map((p) => <option key={p.dasar} value={p.dasar} disabled={!p.tersedia}>{p.label}{p.tanggal ? ` — ${p.tanggal}` : ""}{!p.tersedia && p.alasanTidak ? ` (tidak tersedia: ${p.alasanTidak})` : ""}</option>)}
                </select>
              </Field>
              <Field label="Tanggal pengakuan" required hint={f.dasarTanggal === "KEPUTUSAN_OWNER" ? `Isi sendiri, antara ${det.cutoff} dan ${det.hariIni}` : "Terisi dari bukti"}>
                <Input type="date" value={f.tanggal} readOnly={!!f.dasarTanggal && f.dasarTanggal !== "KEPUTUSAN_OWNER"} min={det.cutoff} max={det.hariIni} onChange={(e) => { setPratinjau(null); setF({ ...f, tanggal: e.target.value }); }} aria-label="Tanggal pengakuan" />
              </Field>
              {f.dasarTanggal === "KEPUTUSAN_OWNER" && <Field label="Bukti referensi keputusan" required hint="Nomor dokumen / pesan / kesepakatan Owner"><Input value={f.buktiReferensi} onChange={(e) => setF({ ...f, buktiReferensi: e.target.value })} /></Field>}
              {det.praCutoff && (
                <label className="flex items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-orange">
                  <input type="checkbox" checked={f.akuiPraCutoff} onChange={(e) => setF({ ...f, akuiPraCutoff: e.target.checked })} className="mt-0.5" />
                  <span>Saya memutuskan mengakui order yang diserahkan SEBELUM cutoff ini di periode berjalan (menaikkan pendapatan periode tersebut).</span>
                </label>
              )}
              <Field label="Alasan" required><Input value={f.alasan} onChange={(e) => setF({ ...f, alasan: e.target.value })} /></Field>
              {akui.galat && <p className="m-0 text-[11.5px] text-ink3" data-testid="akui-galat">{akui.galat}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="neutral" disabled={!!akui.galat || sibuk} onClick={lihatPratinjau} className="max-sm:min-h-11" data-testid="lihat-pratinjau">Lihat pratinjau jurnal</Button>
                <Button size="sm" disabled={!!akui.galat || sibuk || !pratinjau?.jurnal} onClick={simpan} className="max-sm:min-h-11" data-testid="simpan-akui">Akui pendapatan (PIN)</Button>
              </div>
              {pratinjau?.jurnal && <PratinjauJurnal p={pratinjau} />}
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function PratinjauJurnal({ p }) {
  return (
    <div className="space-y-2 rounded-xl bg-inset p-3" data-testid="pratinjau-jurnal">
      <p className="m-0 font-semibold">Pratinjau jurnal — {tanggalPanjang(p.tanggal)}</p>
      <div className="overflow-x-auto"><table className="w-full text-[12px]"><thead><tr className="text-left text-ink3"><th className="py-0.5 pr-2">Akun</th><th className="px-2 text-right">Debit</th><th className="pl-2 text-right">Kredit</th></tr></thead>
        <tbody>{p.jurnal.baris.map((b, i) => <tr key={i}><td className="py-0.5 pr-2">{b.akun}</td><td className="px-2 text-right tabular-nums">{b.debit ? formatUang(b.debit) : ""}</td><td className="pl-2 text-right tabular-nums">{b.kredit ? formatUang(b.kredit) : ""}</td></tr>)}</tbody>
        <tfoot><tr className="font-semibold"><td>Total</td><td className="px-2 text-right tabular-nums">{formatUang(p.jurnal.totalDebit)}</td><td className="pl-2 text-right tabular-nums">{formatUang(p.jurnal.totalKredit)}</td></tr></tfoot></table></div>
      <ul className="m-0 list-disc pl-4">{ringkasDampak(p.dampak).map((t) => <li key={t}>{t}</li>)}</ul>
      {p.gapDitutup > 0 && <p className="m-0">Gap NILAI_ORDER_NOL ditutup: {p.gapDitutup}.</p>}
      {p.peringatan?.map((t) => <p key={t} className="m-0 text-orange">{t}</p>)}
    </div>
  );
}

// ─── ATRIBUSI ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function TabAtribusi({ periode, onSelesai }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  const [buka, setBuka] = useState(null);
  const muat = useCallback(async () => { setGalat(""); try { setD(await api.getKoreksiAtribusi(periode.from, periode.to)); } catch (e) { setGalat(e.message); } }, [periode.from, periode.to]);
  useEffect(() => { muat(); }, [muat]);
  if (galat) return <KotakCatatan tone="red">{galat}</KotakCatatan>;
  if (!d) return <p className="py-6 text-center text-[13px] text-ink3"><Loader2 className="mr-1 inline animate-spin" size={14} />Memuat…</p>;
  return (
    <KartuPanel testid="panel-koreksi-atribusi" judul="Atribusi beban divisi — keputusan per dokumen" deskripsi="Dokumen yang buktinya menunjuk lebih dari satu divisi. Keputusan hanya memilih divisi; jurnal dan total beban tidak berubah.">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <KotakAngka label="Menunggu keputusan" nilai={String(d.ringkasan.menunggu)} sub={formatUang(d.ringkasan.nilaiMenunggu)} tone={d.ringkasan.menunggu ? "orange" : undefined} />
        <KotakAngka label="Sudah diputuskan" nilai={String(d.ringkasan.diputuskan)} />
        <KotakAngka label="Baris konflik di laporan" nilai={String(d.ringkasan.barisKonflikLaporan)} sub={formatUang(d.ringkasan.nilaiBarisKonflikLaporan)} />
      </div>
      {d.daftar.length === 0 && <p className="py-4 text-center text-[13px] text-ink3" data-testid="atribusi-kosong">Tidak ada konflik atribusi pada periode ini.</p>}
      <ul className="m-0 list-none space-y-1.5 p-0" data-testid="daftar-atribusi">
        {d.daftar.map((x) => (
          <li key={`${x.modul}:${x.dokumenId ?? x.jurnal.join()}`}>
            <button type="button" disabled={!x.bisaDiputuskan} onClick={() => setBuka(x)} className="flex w-full min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2 text-left text-[12.5px] hover:bg-inset disabled:opacity-70" data-testid={`atribusi-${x.nomor ?? "tanpa"}`}>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-semibold">{x.nomor ?? x.jurnal.join(", ")}</span><Badge variant={x.status === "DIPUTUSKAN" ? "green" : "orange"}>{x.status === "DIPUTUSKAN" ? "Diputuskan" : "Menunggu keputusan"}</Badge></span>
                <span className="mt-0.5 block text-ink3">{x.deskripsi} · {x.akun.join(", ")} · kandidat: {x.kandidat.map((k) => k.label).join(" vs ")}</span>
                <span className="mt-0.5 block text-ink3">Saat ini di laporan: <strong>{x.divisiSaatIniLabel}</strong>{x.keputusan ? ` · diputuskan ${x.keputusan.oleh ?? ""} (${x.keputusan.sebelumLabel} → ${x.keputusan.scopeLabel})` : ""}{x.alasanTidakBisa ? ` · ${x.alasanTidakBisa}` : ""}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatUang(x.nilai)}</span>
            </button>
          </li>
        ))}
      </ul>
      {buka && <DetailAtribusi item={buka} onClose={() => setBuka(null)} onSelesai={() => { setBuka(null); muat(); onSelesai?.(); }} />}
    </KartuPanel>
  );
}

function DetailAtribusi({ item, onClose, onSelesai }) {
  const { minta, dialogPin } = usePinStepUp();
  const [det, setDet] = useState(null);
  const [galat, setGalat] = useState("");
  const [scope, setScope] = useState("");
  const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(async (s = "") => { try { setDet(await api.getKoreksiAtribusiDetail(item.modul, item.dokumenId, s)); } catch (e) { setGalat(e.message); } }, [item.modul, item.dokumenId]);
  useEffect(() => { muat(); }, [muat]);
  const pilih = (s) => { setScope(s); muat(s); };
  const q = susunBodyAtribusi(scope, alasan);
  const jalankan = async (fn) => { setSibuk(true); setGalat(""); try { await fn(); } catch (e) { setGalat(e.message); } finally { setSibuk(false); } };
  const simpan = () => jalankan(async () => { const key = kunciBaruKoreksi("atribusi"); const r = await denganPin(minta, (t) => api.kirimKeputusanAtribusi(item.modul, item.dokumenId, q.body, { stepUp: t, idempotencyKey: key })); if (r) onSelesai(); });
  const cabut = () => jalankan(async () => { const key = kunciBaruKoreksi("atribusi-cabut"); const r = await denganPin(minta, (t) => api.kirimKeputusanAtribusi(item.modul, item.dokumenId, { alasan: alasan.trim() }, { cabut: true, stepUp: t, idempotencyKey: key })); if (r) onSelesai(); });
  const p = det?.pratinjau;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={`Atribusi ${p?.nomor ?? item.nomor ?? ""}`} description={p?.deskripsi ?? ""} className="w-[720px] max-w-[96vw]" footer={<Button variant="neutral" onClick={onClose} className="max-sm:min-h-11">Tutup</Button>}>
      {dialogPin}
      {galat && <KotakCatatan tone="red" testid="koreksi-galat">{galat}</KotakCatatan>}
      {!det && !galat && <p className="py-6 text-center text-[13px] text-ink3"><Loader2 className="mr-1 inline animate-spin" size={14} />Memuat…</p>}
      {p && (
        <div className="space-y-3 text-[12.5px]" data-testid="detail-atribusi">
          <section className="space-y-1" aria-label="Bukti divisi">
            <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Bukti yang bertentangan</p>
            {p.bukti.map((b, i) => <Baris key={i} label={b.scopeLabel ?? b.mentah}>{b.sumber}</Baris>)}
            <Baris label="Aturan prioritas memilih">{p.aturanPrioritas.label} — {p.aturanPrioritas.aturan}</Baris>
            <Baris label="Jurnal dokumen">{p.jurnal.length ? p.jurnal.map((j) => `${j.nomor} (${tanggalPanjang(j.tanggal)}, ${j.status})`).join("; ") : "Belum ada jurnal"}</Baris>
            <Baris label="Nilai beban dokumen">{formatUang(p.nilaiBebanDokumen)}</Baris>
          </section>
          {p.tahan.filter((t) => t.kode !== "SCOPE_BUKAN_KANDIDAT").map((t) => <KotakCatatan key={t.kode} tone="orange" testid="alasan-tertahan">{t.pesan}</KotakCatatan>)}
          {p.bisaDiputuskan && (
            <section className="space-y-2" aria-label="Keputusan">
              <Field label="Divisi yang benar" required>
                <div className="flex flex-wrap gap-1.5" role="radiogroup">
                  {p.kandidat.map((k) => <Button key={k.scope} size="sm" variant={scope === k.scope ? "secondary" : "neutral"} onClick={() => pilih(k.scope)} aria-pressed={scope === k.scope} className="max-sm:min-h-11">{k.label}</Button>)}
                </div>
              </Field>
              <Field label="Alasan (bukti yang membuat divisi ini benar)" required><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} /></Field>
              {p.sesudah && p.dampak && <KotakCatatan testid="pratinjau-atribusi">{p.dampak.dariDivisi} → <strong>{p.dampak.keDivisi}</strong> untuk {formatUang(p.dampak.nilaiBeban)}. {p.dampak.catatan}</KotakCatatan>}
              {q.galat && <p className="m-0 text-[11.5px] text-ink3">{q.galat}</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!!q.galat || sibuk || !p.sesudah} onClick={simpan} className="max-sm:min-h-11" data-testid="simpan-atribusi">Simpan keputusan (PIN)</Button>
              </div>
            </section>
          )}
          {p.keputusanAktif && (
            <div className="space-y-1.5">
              <KotakCatatan tone="green">Keputusan aktif: <strong>{p.keputusanAktif.scopeLabel}</strong> (sebelumnya {p.keputusanAktif.sebelumLabel}) oleh {p.keputusanAktif.oleh ?? "—"}. Alasan: {p.keputusanAktif.alasan}</KotakCatatan>
              <Button size="sm" variant="neutral" disabled={sibuk || alasan.trim().length < 10} onClick={cabut} className="max-sm:min-h-11" data-testid="cabut-atribusi">Cabut keputusan (isi alasan di atas)</Button>
            </div>
          )}
          {det.riwayat.length > 0 && (
            <section aria-label="Riwayat keputusan" data-testid="riwayat-atribusi">
              <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-ink3">Riwayat sebelum/sesudah</p>
              <ul className="m-0 list-none space-y-1 p-0">{det.riwayat.map((r) => <li key={r.id} className="rounded-lg bg-inset px-3 py-1.5">{r.sebelumLabel} → <strong>{r.scopeLabel}</strong> · {r.oleh ?? "—"} · {r.alasan}{r.dicabutPada ? ` · dicabut: ${r.alasanPencabutan ?? ""}` : " · aktif"}</li>)}</ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
