import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, UbinApple } from "@/components/ikApple.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { formatUang, Pilihan, tanggalPendek, TombolAksi } from "@/features/finance/shared.jsx";
import { KenapaBeda } from "@/features/finance/kontrak.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import { KartuKpiApple, SegStatus, KolomCari, KosongDaftar } from "@/features/finance/DaftarGaya.jsx";
import { SelectPO } from "@/features/finance/po/KontrolPO.jsx";
import { Pembuka } from "@/features/finance/RingkasanKecil.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import {
  TAB_AGING, NADA_INDIKATOR, VARIAN_STATUS_PEMBAYARAN, VARIAN_STATUS_BARANG, VARIAN_STATUS_FAKTUR, teksJatuhTempo, teksTermin,
} from "@/features/finance/terminLogic.js";

// JADWAL & AGING UTANG SUPPLIER. Semua angka (kartu, tabel, detail) datang dari SATU read-model server (GET /finance/utang/aging) — sama dengan export Excel.
// Aging menurut TANGGAL JATUH TEMPO, bukan tanggal barang datang. Tiga status DIPISAH: barang, faktur, pembayaran. Layar ini tidak membayar apa pun:
// "Atur jadwal bayar" hanya menyimpan rencana; pembayaran tetap lewat tab Pembayaran.
const LABEL_BARANG = { BELUM_DATANG: "Belum Datang", DITERIMA_SEBAGIAN: "Diterima Sebagian", SIAP_DISIMPAN: "Siap Disimpan", SUDAH_MASUK_STOK: "Sudah Masuk Stok", SELESAI: "Selesai" };
const LABEL_FAKTUR = { BELUM_ADA_FAKTUR: "Belum Ada Faktur", FAKTUR_DITERIMA: "Faktur Diterima", PERLU_DITINJAU: "Perlu Ditinjau", DISETUJUI: "Disetujui", DIBATALKAN: "Dibatalkan" };
const LABEL_BAYAR = { BELUM_JATUH_TEMPO: "Belum Jatuh Tempo", JATUH_TEMPO_7_HARI: "Jatuh Tempo ≤7 Hari", JATUH_TEMPO_HARI_INI: "Jatuh Tempo Hari Ini", TERLAMBAT: "Terlambat", DIBAYAR_SEBAGIAN: "Dibayar Sebagian", LUNAS: "Lunas", TANPA_JATUH_TEMPO: "Jatuh Tempo Belum Diisi" };
const GARIS = { merah: "border-l-red", jingga: "border-l-orange", biru: "border-l-accent", hijau: "border-l-green", netral: "border-l-line" };

function TigaStatus({ r }) {
  return (
    <div className="flex flex-wrap gap-1" data-testid="tiga-status">
      {r.statusBarang ? <Badge variant={VARIAN_STATUS_BARANG[r.statusBarang]}>Barang: {LABEL_BARANG[r.statusBarang]}</Badge> : <Badge variant="neutral">Barang: tidak berlaku</Badge>}
      {r.adaBarangDitolak && <Badge variant="orange">Ada Barang Ditolak</Badge>}
      <Badge variant={VARIAN_STATUS_FAKTUR[r.statusFaktur]}>Faktur: {LABEL_FAKTUR[r.statusFaktur]}</Badge>
      <Badge variant={VARIAN_STATUS_PEMBAYARAN[r.statusPembayaran]}>Bayar: {LABEL_BAYAR[r.statusPembayaran]}</Badge>
    </div>
  );
}

export default function JadwalAgingUtang({ suppliers = [], rekening = [], bolehJadwal = false, onBukaPembayaran }) {
  const [kelompok, setKelompok] = useState("AKTIF");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const [supplierId, setSupplierId] = useState("");
  const [data, setData] = useState(null);
  const [galat, setGalat] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [tentang, setTentang] = useState(false);
  const pernah = useRef(false);

  const muat = useCallback(async () => {
    try {
      const params = { kelompok, q: qTunda.trim() || undefined, supplierId: supplierId || undefined };
      setData(await api.getAgingUtang(params)); setGalat("");
    } catch (e) { setGalat(e.message || "Gagal memuat jadwal utang"); }
  }, [kelompok, qTunda, supplierId]);
  useEffect(() => { muat(); pernah.current = true; }, [muat]);

  if (galat && !data) return <p role="alert" className="rounded-btn bg-redbg px-3 py-2 text-[13px] text-red">{galat}</p>;
  if (!data) return <p className="text-[13px] text-ink3">Memuat jadwal utang…</p>;
  const k = data.ringkasan.kartu;
  const baris = data.baris;
  const terlambat = k.jumlahTerlambat;
  const adaFilter = !!q || !!supplierId || kelompok !== "AKTIF";
  const itemSeg = TAB_AGING.map((t) => {
    const g = data.ringkasan.perKelompok.find((x) => x.kunci === t.kunci);
    const jumlah = t.kunci === "AKTIF" ? k.jumlahFakturAktif : t.kunci === "DIBAYAR_SEBAGIAN" ? k.jumlahDibayarSebagian : g?.jumlah;
    return { kunci: t.kunci, label: t.label, jumlah };
  });

  return (
    <div className="flex flex-col gap-4" data-testid="jadwal-aging">
      <p className="fin-tg-info" data-nada="biru">Utang supplier menurut <strong>tanggal jatuh tempo</strong> — status barang, faktur, dan pembayaran dipisahkan. Barang boleh sudah dipakai Produksi walau faktur belum dibayar. Halaman ini tidak membayar apa pun.</p>

      <section className="fin-kw-baris" data-kolom="3" aria-label="Ringkasan jadwal pembayaran" data-testid="kartu-aging">
        <KartuKpiApple ikon="dokumen" warna="biru" label="Total utang aktif" nilai={formatUang(k.totalUtangAktif)} ket={`${k.jumlahFakturAktif} faktur`} />
        <KartuKpiApple ikon="jam" warna={terlambat > 0 ? "merah" : "hijau"} label="Terlambat" nilai={formatUang(k.totalTerlambat)} ket={`${terlambat} faktur`} />
        <KartuKpiApple ikon="kalender" warna={k.jumlahJatuhTempo7Hari > 0 ? "jingga" : "tosca"} label="Jatuh tempo 7 hari" nilai={formatUang(k.jatuhTempo7Hari)} ket={`${k.jumlahJatuhTempo7Hari} faktur (termasuk hari ini)`} />
        <KartuKpiApple ikon="termin" warna="ungu" label="Jatuh tempo 30 hari" nilai={formatUang(k.jatuhTempo30Hari)} ket={`${k.jumlahJatuhTempo30Hari} faktur`} />
        <KartuKpiApple ikon="centang" warna="hijau" label="Sudah dijadwalkan" nilai={formatUang(k.sudahDijadwalkan)} ket={`${k.jumlahDijadwalkan} faktur — rencana, belum dibayar`} />
        <KartuKpiApple ikon="peringatan" warna={k.jumlahTanpaJatuhTempo > 0 ? "jingga" : "grafit"} label="Tanpa jatuh tempo" nilai={formatUang(k.tanpaJatuhTempo)} ket={`${k.jumlahTanpaJatuhTempo} faktur — tanggal belum diisi`} />
      </section>

      <div className="fin-tg-tentang" data-testid="tentang-angka-jadwal">
        <Pembuka buka={tentang} onToggle={() => setTentang((v) => !v)} id="tentang-jadwal-isi" className="fin-tg-tentang-tombol">Tentang angka dan pencatatan</Pembuka>
        {tentang && (
          <div id="tentang-jadwal-isi" className="fin-tg-tentang-isi">
            <p>Semua angka (kartu, daftar, rincian) datang dari satu perhitungan server yang sama dengan Export Excel. Aging dihitung dari <strong>tanggal jatuh tempo</strong>, bukan tanggal barang datang. “Atur jadwal bayar” hanya menyimpan rencana; pembayaran tetap dicatat di tab Pembayaran.</p>
            <KenapaBeda metrik={["utang_jatuh_tempo_aging", "utang_supplier"]} />
          </div>
        )}
      </div>

      <section className="fin-tg-panel" aria-label="Daftar jadwal utang">
        <div className="fin-tg-alat">
          <SegStatus item={itemSeg} nilai={kelompok} onPilih={setKelompok} label="Kelompok aging" testidAwalan="aging" />
          <div className="fin-tg-cari">
            <KolomCari nilai={q} onUbah={setQ} placeholder="Cari supplier, no. faktur, no. PO…" ariaLabel="Cari faktur" testid="cari-aging" />
            <div className="fin-tg-pilih"><SelectPO value={supplierId} onChange={setSupplierId} ariaLabel="Filter supplier" opsi={[{ nilai: "", label: "Semua supplier" }, ...suppliers.map((s) => ({ nilai: s.id, label: s.name }))]} /></div>
            <TombolExportExcel
              modul="aging-utang"
              ambilBody={() => ({ filter: { q: qTunda.trim() || undefined, supplierId: supplierId || undefined }, filterLabel: labelFilterAktif([["Pencarian", qTunda.trim()], ["Supplier", suppliers.find((s) => s.id === supplierId)?.name]]) })}
            />
          </div>
        </div>
        <p className="fin-tg-jumlah" role="status" aria-live="polite" data-testid="jumlah-aging">
          {baris.length} faktur
          {adaFilter && <button type="button" className="fin-tg-reset" onClick={() => { setQ(""); setSupplierId(""); setKelompok("AKTIF"); }}>Atur ulang</button>}
        </p>

        {baris.length === 0 ? (
          <KosongDaftar testid="aging-kosong" ikon="termin" judul="Tidak ada faktur di kelompok ini" ket="Faktur muncul di sini setelah disetujui. Aging dihitung dari tanggal jatuh tempo." />
        ) : (
          <div className="fin-dl-tabel" role="table" aria-label="Jadwal utang supplier" style={{ "--kolom-sedang": "minmax(240px, 2.4fr) 150px 130px minmax(220px, 1.6fr)", "--kolom-lebar": "minmax(250px, 2.4fr) 130px 150px 130px 130px minmax(230px, 1.6fr)" }}>
            <div className="fin-dl-judul" role="row">
              <span role="columnheader">Supplier / Faktur</span><span role="columnheader" className="fin-dl-lebar">PO</span><span role="columnheader">Jatuh tempo</span>
              <span role="columnheader" className="kanan fin-dl-lebar">Nilai</span><span role="columnheader" className="kanan">Sisa</span><span role="columnheader">Status</span>
            </div>
            {baris.map((r) => {
              const buka = () => setDetailId(r.billId);
              return (
                <div
                  key={r.rowKey ?? r.billId} className="fin-dl-baris" role="row" tabIndex={0} data-testid="baris-aging" data-garis={r.indikator}
                  onClick={(e) => { if (e.target.closest("button, a, input, select")) return; buka(); }}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); buka(); } }}
                  aria-label={`Faktur ${r.nomorFaktur || r.nomorTagihan} dari ${r.supplier}, ${teksJatuhTempo(r)}. Buka rincian`}
                >
                  <div className="fin-dl-sel fin-dl-utama" role="cell">
                    <UbinApple nama="gedung" ukuran={40} />
                    <span className="fin-dl-teks">
                      <span className="fin-dl-judul-baris" title={r.supplier}>{r.supplier}</span>
                      <span className="fin-dl-nomor">{r.nomorFaktur || r.nomorTagihan}</span>
                    </span>
                  </div>
                  <div className="fin-dl-sel fin-dl-lebar" role="cell"><span className="fin-dl-label">PO</span><span className="font-mono text-[12px]">{r.po?.nomor ?? "—"}</span></div>
                  <div className="fin-dl-sel" role="cell">
                    <span className="fin-dl-label">Jatuh tempo</span>
                    <span>{r.tanggalJatuhTempo ? tanggalPendek(r.tanggalJatuhTempo) : <span className="fin-dl-sub jingga">Belum diisi</span>}</span>
                    <span className={cn("fin-dl-sub", r.indikator === "merah" && "lewat", r.indikator === "jingga" && "jingga")}>{teksJatuhTempo(r)}</span>
                  </div>
                  <div className="fin-dl-sel fin-dl-angka fin-dl-lebar" role="cell"><span className="fin-dl-label">Nilai</span>{formatUang(r.nilaiFaktur)}<span className="fin-dl-sub">dibayar {formatUang(r.dibayar)}</span></div>
                  <div className="fin-dl-sel fin-dl-angka" role="cell"><span className="fin-dl-label">Sisa utang</span><strong>{formatUang(r.sisaUtang)}</strong></div>
                  <div className="fin-dl-sel" role="cell"><span className="fin-dl-label">Status</span><TigaStatus r={r} /></div>
                  <div className="fin-dl-sel fin-dl-sempit" role="cell"><span className="fin-dl-label">Tanggal faktur · termin</span>{tanggalPendek(r.tanggalFaktur)} · {teksTermin(r.termin)}</div>
                  <div className="fin-dl-sel fin-dl-sempit" role="cell"><span className="fin-dl-label">Barang diterima · PO</span>{r.tanggalBarangDiterima ? tanggalPendek(r.tanggalBarangDiterima) : "—"} · {r.po?.nomor ?? "—"}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      {detailId && <DetailUtang billId={detailId} rekening={rekening} bolehJadwal={bolehJadwal} onClose={() => setDetailId(null)} onChanged={muat} onBukaPembayaran={onBukaPembayaran} />}
    </div>
  );
}

function DetailUtang({ billId, rekening, bolehJadwal, onClose, onChanged, onBukaPembayaran }) {
  const [d, setD] = useState(null);
  const [galat, setGalat] = useState("");
  const [f, setF] = useState({ date: "", cashAccountId: "", note: "" });
  const [sibuk, setSibuk] = useState(false);
  const muat = useCallback(async () => {
    try {
      const r = await api.getAgingUtangDetail(billId); setD(r); setGalat("");
      setF({ date: r.jadwalBayar?.tanggal ?? "", cashAccountId: r.jadwalBayar?.rekeningId ?? "", note: r.jadwalBayar?.catatan ?? "" });
    } catch (e) { setGalat(e.message || "Gagal memuat detail"); }
  }, [billId]);
  useEffect(() => { muat(); }, [muat]);

  async function simpan(hapus = false) {
    setSibuk(true); setGalat("");
    try { setD(await api.aturJadwalBayar(billId, hapus ? { date: null } : { date: f.date, cashAccountId: f.cashAccountId, note: f.note })); await onChanged(); if (hapus) setF({ date: "", cashAccountId: "", note: "" }); }
    catch (e) { setGalat(e.message || "Gagal menyimpan jadwal"); } finally { setSibuk(false); }
  }

  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={d ? `${d.supplier} — ${d.nomorFaktur || d.nomorTagihan}` : "Memuat…"} description={d ? `Tagihan ${d.nomorTagihan}${d.po ? ` · ${d.po.nomor}` : ""}` : undefined} className="w-[720px]">
      {!d ? <p className="py-4 text-[13px] text-ink3">{galat || "Memuat…"}</p> : (
        <div className="space-y-4" data-testid="detail-utang">
          <TigaStatus r={d} />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-3">
            <div><dt className="text-ink3">Tanggal barang diterima</dt><dd className="m-0 font-medium">{d.tanggalBarangDiterima ? tanggalPendek(d.tanggalBarangDiterima) : "—"}</dd></div>
            <div><dt className="text-ink3">Tanggal faktur</dt><dd className="m-0 font-medium">{tanggalPendek(d.tanggalFaktur)}</dd></div>
            <div><dt className="text-ink3">Jatuh tempo</dt><dd className="m-0 font-medium">{d.tanggalJatuhTempo ? tanggalPendek(d.tanggalJatuhTempo) : "Belum diisi"} · {teksJatuhTempo(d)}</dd></div>
            <div><dt className="text-ink3">Termin</dt><dd className="m-0 font-medium">{teksTermin(d.termin)}</dd></div>
            <div><dt className="text-ink3">Umur utang</dt><dd className="m-0 font-medium">{d.umurUtangHari} hari sejak faktur</dd></div>
            <div><dt className="text-ink3">Rekening</dt><dd className="m-0 font-medium">{d.rekeningPembayaran ?? "—"}</dd></div>
            <div><dt className="text-ink3">Nilai faktur</dt><dd className="m-0 font-medium tabular-nums">{formatUang(d.nilaiFaktur)}</dd></div>
            <div><dt className="text-ink3">Sudah dibayar</dt><dd className="m-0 font-medium tabular-nums">{formatUang(d.dibayar)}</dd></div>
            <div><dt className="text-ink3">Sisa utang</dt><dd className="m-0 font-semibold tabular-nums">{formatUang(d.sisaUtang)}</dd></div>
          </dl>
          {d.termin.alasanOverride && (
            <p className="m-0 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange" data-testid="alasan-override">Termin/tanggal diganti{d.termin.oleh ? ` oleh ${d.termin.oleh}` : ""}: {d.termin.alasanOverride}</p>
          )}
          {!d.tanggalJatuhTempo && <p className="m-0 flex items-center gap-1.5 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-orange"><AlertTriangle size={13} aria-hidden /> Tanggal jatuh tempo belum diisi (data lama). Sistem tidak menebaknya — isi lewat Edit Info Tagihan.</p>}

          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Riwayat pembayaran</h4>
            {d.pembayaran.length === 0 ? <p className="m-0 text-[12.5px] text-ink3">Belum ada pembayaran aktif. Pembayaran dibatalkan lewat reversal dan tidak dihitung di sini.</p> : (
              <ul className="m-0 list-none space-y-1 p-0">
                {d.pembayaran.map((p) => (
                  <li key={p.paymentId} className="flex flex-wrap items-center gap-x-3 rounded-btn border border-line px-3 py-1.5 text-[12.5px]">
                    <span className="font-mono text-[12px] font-semibold">{p.nomor}</span><span className="text-ink3">{tanggalPendek(p.tanggal)}</span><span className="text-ink2">{p.rekening ?? "—"}</span>
                    <span className="ml-auto tabular-nums font-medium">{formatUang(p.jumlah)}</span>
                    {p.biayaTransfer > 0 && <span className="text-[11.5px] text-ink3">+ biaya transfer {formatUang(p.biayaTransfer)} (terpisah)</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink3">Jadwal bayar (rencana)</h4>
            {d.jadwalBayar && <p className="mb-2 text-[12.5px] text-ink2" data-testid="jadwal-tersimpan">Direncanakan {tanggalPendek(d.jadwalBayar.tanggal)} lewat {d.jadwalBayar.rekening ?? "—"}{d.jadwalBayar.oleh ? ` · oleh ${d.jadwalBayar.oleh}` : ""}{d.jadwalBayar.catatan ? ` · ${d.jadwalBayar.catatan}` : ""}</p>}
            {bolehJadwal && d.statusPembayaran !== "LUNAS" ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label="Tanggal rencana"><Input type="date" value={f.date} onChange={(e) => setF((s) => ({ ...s, date: e.target.value }))} aria-label="Tanggal rencana bayar" /></Field>
                <Field label="Rekening"><Pilihan value={f.cashAccountId} onChange={(v) => setF((s) => ({ ...s, cashAccountId: v }))} aria-label="Rekening rencana bayar"><option value="">— pilih —</option>{rekening.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Pilihan></Field>
                <Field label="Catatan"><Input value={f.note} onChange={(e) => setF((s) => ({ ...s, note: e.target.value }))} /></Field>
              </div>
            ) : <p className="m-0 text-[12px] text-ink3">{d.statusPembayaran === "LUNAS" ? "Faktur sudah lunas." : "Hanya pengguna dengan izin mencatat (finance:post) yang dapat mengatur jadwal bayar."}</p>}
            {galat && <p role="alert" className="mt-2 text-[12.5px] text-red">{galat}</p>}
            <p className="mt-2 text-[11.5px] text-ink3">Jadwal hanya rencana: tidak membayar, tidak membuat jurnal. Pembayaran sebenarnya dicatat di tab Pembayaran dan tidak menutup faktur bila hanya sebagian.</p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {d.jadwalBayar && bolehJadwal && <Button variant="neutral" size="sm" disabled={sibuk} onClick={() => simpan(true)}>Hapus jadwal</Button>}
              {bolehJadwal && d.statusPembayaran !== "LUNAS" && <TombolAksi disabled={sibuk || !f.date || !f.cashAccountId} onClick={() => simpan(false)}>Simpan jadwal</TombolAksi>}
              {onBukaPembayaran && d.statusPembayaran !== "LUNAS" && <Button size="sm" variant="secondary" onClick={() => { onClose(); onBukaPembayaran(d); }}>Catat pembayaran…</Button>}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
