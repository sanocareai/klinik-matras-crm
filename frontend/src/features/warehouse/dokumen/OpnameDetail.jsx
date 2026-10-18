import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { EyeOff, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import KartuJalurKoreksi from "@/features/warehouse/koreksi/KartuJalurKoreksi.jsx";
import { UNIT_LABEL } from "@/features/warehouse/inventoryReal.js";
import JejakDokumen from "./JejakDokumen.jsx";
import TabelItemDokumen from "./TabelItemDokumen.jsx";
import KolomJumlah from "./KolomJumlah.jsx";
import { HalamanDokumen, KartuStatusDokumen, KartuAksiDokumen, useDokumen } from "./KartuDokumen.jsx";
import { JENIS_HITUNG, METODE_HITUNG } from "./labelDokumen.js";
import { angka, tanggalPendek, teksJumlah, waktuTeks } from "./dokumenLogic.js";

// DETAIL STOCK OPNAME — halaman. Alur: Terjadwal → Mulai hitung (saldo sistem direkam) → isi hasil hitung → Serahkan → tinjau selisih → Selesaikan (satu penyesuaian per bahan berselisih). Aturan pemisahan tugas,
// tanda pergerakan selama sesi, dan pemeriksaan hitungan (Opname Penuh) TIDAK diubah; halaman hanya menjelaskannya dan hanya menawarkan aksi yang boleh dilakukan akun ini (server tetap menolak yang tidak berhak).
const satuan = (u) => UNIT_LABEL[u] || String(u || "").toLowerCase();

export default function OpnameDetail() {
  const { id } = useParams();
  const { r, galat, memuat, sibuk, setSibuk, versi, muat } = useDokumen(api.getStockCount, id);
  const [edit, setEdit] = useState({}); const [menandai, setMenandai] = useState(null); const [galatLokal, setGalatLokal] = useState("");
  const nilai = (l, f) => (edit[l?.id] && f in edit[l.id] ? edit[l.id][f] : (l?.[f] ?? ""));
  const ubah = (lineId, f, v) => setEdit((e) => ({ ...e, [lineId]: { ...e[lineId], [f]: v } }));
  const adaEdit = Object.keys(edit).length > 0;

  const gabung = useMemo(() => (r ? r.lines.map((l) => ({ ...l, countedQty: nilai(l, "countedQty"), reason: nilai(l, "reason") })) : []), [r, edit]); // eslint-disable-line react-hooks/exhaustive-deps -- nilai bergantung pada edit
  const baris = (l) => { const dihitung = l.countedQty === "" || l.countedQty == null ? null : angka(l.countedQty); const sistem = l.systemQty == null ? null : Number(l.systemQty); return { dihitung, sistem, selisih: dihitung !== null && sistem !== null ? Math.round((dihitung - sistem) * 10000) / 10000 : null }; };

  const simpanEdit = async () => { await Promise.all(Object.entries(edit).map(([lineId, patch]) => api.updateStockCountLine(id, lineId, patch))); setEdit({}); };
  const jalankan = async (kode, v = {}) => {
    setSibuk(true); setGalatLokal("");
    try {
      if (["SERAHKAN_HITUNGAN", "SELESAIKAN_OPNAME"].includes(kode) && adaEdit) await simpanEdit();
      if (kode === "MULAI_HITUNG") await api.startStockCount(id);
      else if (kode === "SERAHKAN_HITUNGAN") await api.submitStockCount(id);
      else if (kode === "HITUNG_ULANG") await api.recountStockCount(id);
      else if (kode === "PERIKSA_HITUNGAN") await api.periksaHitungan(id);
      else if (kode === "SELESAIKAN_OPNAME") await api.completeStockCount(id);
      else if (kode === "UBAH") await api.updateStockCount(id, { scheduledDate: v.jadwal || null, notes: v.notes });
      else if (kode === "BATALKAN") await api.cancelStockCount(id, v.alasan);
      await muat(); setEdit({});
    } catch (e) { await muat(); throw e; } finally { setSibuk(false); }
  };
  const tandai = async (movementId, tercermin) => {
    setMenandai(movementId); setGalatLokal("");
    try { await api.tandaiPergerakanSesi(id, movementId, tercermin); await muat(); } catch (e) { setGalatLokal(e.message); } finally { setMenandai(null); }
  };
  const simpanBaris = async () => { setSibuk(true); setGalatLokal(""); try { await simpanEdit(); await muat(); } catch (e) { setGalatLokal(e.message); } finally { setSibuk(false); } };

  if (!r) return <HalamanDokumen r={r} memuat={memuat} galat={galat} kembali={{ to: "/warehouse/stock-count", label: "Stock Opname" }} nama="stock opname" />;
  const t = r.tampilan; const status = r.status; const blind = r.blindCount && status === "IN_PROGRESS"; const selesai = ["COMPLETED", "CANCELLED"].includes(status);
  const belumDitandai = r.sesi?.belumDitandai ?? 0;
  const berselisih = gabung.filter((l) => { const b = baris(l); return b.selisih !== null && b.selisih !== 0; });
  const tanpaAlasan = berselisih.filter((l) => !String(l.reason ?? "").trim());
  const galatSelesai = belumDitandai > 0 ? `${belumDitandai} pergerakan selama sesi belum ditandai (sudah/belum masuk hitungan fisik). Tandai dulu di kartu Pergerakan stok selama sesi.` : tanpaAlasan.length ? `Alasan wajib diisi untuk selisih pada ${tanpaAlasan.map((l) => l.material.code).join(", ")}.` : "";
  const SPEC = {
    HITUNG_ULANG: { panel: { judul: "Hitung ulang?", tombol: "Ya, hitung ulang", peringatan: "Hitungan kembali ke tahap Sedang dihitung. Saldo sistem tetap dari saat Mulai hitung; semua tanda pergerakan sesi dan pemeriksaan hitungan direset (fisik baru bisa sudah memuat pergerakan yang tadinya belum).", bidang: [] } },
    SELESAIKAN_OPNAME: { panel: { judul: "Selesaikan opname dan bukukan selisih?", tombol: "Selesaikan & bukukan", peringatan: "Untuk tiap bahan berselisih, SATU penyesuaian dibukukan ke stok SEKARANG (tidak bisa dibatalkan dari sini; salah input lewat jalur koreksi resmi). Angka akhir dihitung server dengan memperhitungkan tanda pergerakan sesi.", galat: galatSelesai,
      judulRingkasan: "Perkiraan dampak ke stok (selisih hitung − saldo sistem)", ringkasan: berselisih.length ? berselisih.map((l) => { const b = baris(l); return `${l.material.code}: stok ${b.selisih > 0 ? "bertambah" : "berkurang"} ${teksJumlah(Math.abs(b.selisih))} ${satuan(l.material.unit)} — ${l.reason || "alasan belum diisi"}`; }) : ["Tidak ada selisih: tidak ada stok yang berubah."], bidang: [] } },
    UBAH: { panel: { judul: "Ubah jadwal & catatan", tombol: "Simpan", peringatan: "Perubahan tercatat.", bidang: [{ nama: "jadwal", label: "Tanggal jadwal", tipe: "date", awal: r.scheduledDate ? String(r.scheduledDate).slice(0, 10) : "" }, { nama: "notes", label: "Catatan", tipe: "area", maks: 500, awal: r.notes ?? "" }] } },
    BATALKAN: { panel: { judul: "Batalkan opname ini?", tombol: "Ya, batalkan", peringatan: "Dokumen tersimpan sebagai Dibatalkan beserta alasan. Stok tidak berubah.", bidang: [{ nama: "alasan", label: "Alasan pembatalan", wajib: true, min: 3, maks: 300 }] } },
  };
  const itemBaris = gabung.map((l) => {
    const b = baris(l); const u = satuan(l.material.unit); const sel = [];
    if (!blind && b.sistem !== null) sel.push({ kunci: "sistem", label: "Saldo sistem", numeric: true, isi: `${teksJumlah(b.sistem)} ${u}` });
    if (status === "IN_PROGRESS") sel.push({ kunci: "hitung", label: "Hasil hitung fisik", numeric: true, isi: <KolomJumlah nilai={nilai(r.lines.find((x) => x.id === l.id), "countedQty")} onUbah={(v) => ubah(l.id, "countedQty", v)} label={`Hasil hitung ${l.material.code}`} testid={`hitung-${l.material.code}`} /> });
    else if (["WAITING_REVIEW", "COMPLETED"].includes(status)) {
      sel.push({ kunci: "hitung", label: "Hasil hitung", numeric: true, tebal: true, isi: b.dihitung === null ? "—" : `${teksJumlah(b.dihitung)} ${u}` });
      sel.push({ kunci: "selisih", label: "Selisih", numeric: true, isi: b.selisih === null ? "—" : <span data-testid="selisih" className={b.selisih > 0 ? "font-semibold text-green" : b.selisih < 0 ? "font-semibold text-red" : undefined}>{b.selisih > 0 ? `+${teksJumlah(b.selisih)}` : teksJumlah(b.selisih)}</span> });
      if (b.selisih) sel.push({ kunci: "alasan", label: "Alasan selisih", lebar: true, isi: status === "WAITING_REVIEW" ? <input type="text" value={nilai(r.lines.find((x) => x.id === l.id), "reason")} onChange={(e) => ubah(l.id, "reason", e.target.value)} placeholder="mis. salah catat lokasi, rusak belum dilaporkan" aria-label={`Alasan selisih ${l.material.code}`} data-testid={`alasan-${l.material.code}`} className="w-64 rounded-btn border border-border bg-surface px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent max-sm:min-h-11 max-sm:w-full" /> : (l.reason || "—") });
    } else sel.push({ kunci: "belum", label: "Hasil hitung", lebar: true, isi: "Diisi setelah Mulai hitung" });
    if (!sel.length) sel.push({ kunci: "belum", label: "Hasil hitung", lebar: true, isi: "—" });
    return { id: l.id, kode: l.material.code, nama: l.material.name, sel };
  });
  const identitas = [
    { label: "No. opname", isi: r.countNumber, testid: "id-nomor" }, { label: "Jenis", isi: JENIS_HITUNG[r.countType] ?? r.countType }, { label: "Metode", isi: METODE_HITUNG[r.countMethod] ?? r.countMethod }, { label: "Jadwal", isi: tanggalPendek(r.scheduledDate) },
    { label: "Ditugaskan ke", isi: r.assignedTo?.name }, { label: "Dibuat oleh", isi: r.createdBy?.name }, { label: "Ditinjau oleh", isi: r.reviewedBy?.name }, { label: "Jumlah bahan", isi: r.lines.length },
  ];
  return (
    <HalamanDokumen judul={r.countNumber} subjudul={`${JENIS_HITUNG[r.countType] ?? r.countType} · ${r.lines.length} bahan`} kembali={{ to: "/warehouse/stock-count", label: "Stock Opname" }} r={r} memuat={memuat} galat={galat} onMuat={muat} nama="stock opname">
      <KartuStatusDokumen tampilan={t} identitas={identitas} alurLabel="Alur stock opname" catatan={r.notes} tambahan={blind ? <span className="inline-flex items-center gap-1 rounded-chip bg-accentbg px-2 py-1 text-[11px] text-accent"><EyeOff size={12} /> Blind count: saldo sistem disembunyikan sampai hitungan diserahkan</span> : null} />
      <KartuAksiDokumen tampilan={t} izin={r.izin} spec={SPEC} onJalankan={jalankan} sibuk={sibuk} versi={versi} namaDokumen="opname ini" kaki="Pemisahan tugas: selisih hanya dibukukan penyetuju (Owner/Finance) yang bukan pembuat, penugas, atau pengisi hitungan; Opname Penuh juga wajib diperiksa petugas lain." />
      <Card className="space-y-3 p-4">
        <h3 className="m-0 text-[11px] font-bold uppercase tracking-wide text-ink3">Bahan yang dihitung</h3>
        <TabelItemDokumen baris={itemBaris} />
        {adaEdit && ["IN_PROGRESS", "WAITING_REVIEW"].includes(status) && <Button variant="secondary" size="sm" onClick={simpanBaris} disabled={sibuk} data-testid="simpan-baris" className="max-sm:min-h-11">{sibuk ? <Loader2 size={14} className="animate-spin" /> : null} Simpan perubahan baris</Button>}
        {galatLokal && <p role="alert" className="m-0 text-[12px] text-red" data-testid="galat-isian">{galatLokal}</p>}
      </Card>
      {["IN_PROGRESS", "WAITING_REVIEW", "COMPLETED"].includes(status) && (
        <div className="rounded-btn border-l-[3px] border-accent bg-accentbg px-3 py-2.5" data-testid="identitas-hitungan">
          <p className="m-0 text-[12px] font-bold text-ink">Petugas hitungan</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink2" data-testid="penghitung-hitungan">Dihitung oleh: {r.identitas?.penghitung?.length ? r.identitas.penghitung.map((p) => p.nama).join(", ") : "belum ada angka dimasukkan"}</p>
          <p className="m-0 text-[11.5px] text-ink2" data-testid="pemeriksa-hitungan">Diperiksa oleh: {r.identitas?.pemeriksa?.length ? r.identitas.pemeriksa.map((p) => p.nama).join(", ") : "belum diperiksa"}</p>
          {status === "WAITING_REVIEW" && <p className="m-0 mt-1 text-[11px] text-ink3">Pemeriksa harus petugas lain dari penghitung. Pemeriksaan batal bila angka diubah atau hitungan diulang.</p>}
        </div>
      )}
      {r.pergerakanSesi?.length > 0 && (
        <div className="rounded-btn border-l-[3px] border-orange bg-orangebg px-3 py-2.5" data-testid="pergerakan-sesi">
          <p className="m-0 text-[12px] font-bold text-ink">Pergerakan stok selama sesi hitung</p>
          <p className="m-0 mt-0.5 text-[11.5px] text-ink2">Saldo sistem direkam {r.sesi?.snapshotPada ? waktuTeks(r.sesi.snapshotPada) : "saat Mulai hitung"}. Tandai satu per satu apakah barang ini SUDAH ikut terhitung di fisik — sistem tidak menebak.</p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {r.pergerakanSesi.map((p) => {
              const bisa = ["IN_PROGRESS", "WAITING_REVIEW"].includes(status); const mat = r.lines.find((l) => l.materialId === p.materialId)?.material;
              return (
                <li key={p.id} className="rounded-btn bg-surface px-2.5 py-2 text-[12px]">
                  <p className="m-0 font-semibold text-ink">{mat?.code} · {p.type} {p.qty > 0 ? "+" : ""}{p.qty} {satuan(mat?.unit)}</p>
                  <p className="m-0 text-[11px] text-ink3">{waktuTeks(p.at)}{p.dokumen ? ` · ${p.dokumen}` : ""}{p.note ? ` · ${p.note}` : ""}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant={p.tanda === "SUDAH_TERHITUNG" ? "primary" : "secondary"} disabled={!bisa || menandai === p.id} onClick={() => tandai(p.id, true)} className="max-sm:min-h-11">Sudah masuk hitungan fisik</Button>
                    <Button size="sm" variant={p.tanda === "BELUM_TERHITUNG" ? "primary" : "secondary"} disabled={!bisa || menandai === p.id} onClick={() => tandai(p.id, false)} className="max-sm:min-h-11">Belum masuk hitungan</Button>
                    {p.tanda === null && <span className="text-[11px] font-semibold text-red">belum ditandai</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {!selesai || status === "COMPLETED" ? <KartuJalurKoreksi tipe="STOCK_COUNT" id={id} versi={`${status}-${versi}`} ringkas /> : null}
      <JejakDokumen jejak={r.jejak} basePath="/warehouse/stock-count" />
    </HalamanDokumen>
  );
}
