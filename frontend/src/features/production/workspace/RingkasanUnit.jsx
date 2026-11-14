import React, { useRef, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, HeartPulse } from "lucide-react";
import { api } from "@/api.js";
import { Badge } from "@/components/ui/badge.jsx";
import KonfirmasiCepat from "@/features/production/rencana/KonfirmasiCepat.jsx";
import KoreksiPenerimaanModal from "@/features/production/KoreksiPenerimaanModal.jsx";
import KelengkapanBagian from "@/features/production/KelengkapanBagian.jsx";
import { CatatanRingkas } from "@/features/production/bahan/CatatanHistorisBagian.jsx";
import { Hasil } from "@/features/production/workspace/Hasil.jsx";
import LangkahBerikutnya from "@/features/production/workspace/LangkahBerikutnya.jsx";
import { badgeTarget } from "@/features/production/workspace/workListModel.js";
import { ringkasPekerjaan } from "@/features/production/bahan/bahanModel.js";
import { KERJA_PERLU_KONFIRMASI, formatJumlah, konfirmasiKerja, teksKoreksi, waktuWib } from "@/features/production/orderProduksiModel.js";
import { KERJA_WAJIB_CATATAN, barisBahan, barisFoto, isoTarget, penjelasanTertahan, ringkasHpp, segmenKerja, tanggalWib } from "@/features/production/workspace/profilModel.js";
import { rpNilai } from "@/features/warehouse/stok/hargaBerlakuLogic.js";
import { formatTanggal } from "@/utils/formatDate.js";
import "@/features/production/bahan/bahan.css";

// RINGKASAN PROFIL UNIT — satu layar yang menjawab "apa berikutnya" lalu fakta yang bisa langsung diubah di tempat (tanpa tab Pekerjaan terpisah):
//   Berikutnya (satu tombol) · Pekerjaan: status kerja (segmen), jadwal, target (ketuk), PIC/meja, status order (ketuk), penerimaan (koreksi) · Bahan & Foto (satu baris, ketuk = buka tab)
//   · Order: layanan, kasur, kondisi pelanggan, janji, catatan Sales, komplain · Lainnya (dilipat). Tidak ada kode status mentah; kartu kosong diganti satu baris.
export { penjelasanTertahan };

const IK = { strokeWidth: 1.75 };

function Grup({ judul, children, testid }) {
  return (
    <section className="pf-grup-wadah" data-testid={testid} aria-label={judul}>
      {judul && <h3 className="pf-grup-judul">{judul}</h3>}
      <div className="pf-grup">{children}</div>
    </section>
  );
}
function Baris({ label, sub, nilai, kuat = false, onClick, id, testid, nilaiTestid, tanpaChevron = false }) {
  const isi = (
    <>
      <span className="pf-label">{label}{sub && <small>{sub}</small>}</span>
      {nilai != null && <span className={`pf-nilai${kuat ? " kuat" : ""}`} data-testid={nilaiTestid}>{nilai}</span>}
      {onClick && !tanpaChevron && <ChevronRight {...IK} size={16} className="pf-chevron" aria-hidden />}
    </>
  );
  return onClick
    ? <button type="button" id={id} className="pf-baris" onClick={onClick} data-testid={testid}>{isi}</button>
    : <div id={id} className="pf-baris" data-testid={testid}>{isi}</div>;
}

// ── Status kerja: kontrol segmen. "Sudah dikerjakan"/"Selesai" dikonfirmasi dulu; "Tertunda" wajib catatan. Unit yang dikerjakan lewat aplikasi Meja = hanya-baca.
function BarisKerja({ data, aktif, onDone, onPesan }) {
  const { adopsi: ad, izin = {}, unit: u, kerjaManual: km } = data;
  const pk = ringkasPekerjaan(data);
  const [konf, setKonf] = useState(null); const [catatan, setCatatan] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null);
  const kunci = useRef(false);
  if (km?.dikunciAplikasi) return <Baris id="pf-kerja" testid="status-kerja-form" label="Status kerja" sub="Mengikuti aplikasi Meja" nilai={ad.kerja?.label || "—"} kuat />;
  const bisa = !!izin.statusKerja && aktif; const sekarang = ad.kerja?.key;
  async function simpan(key, note) {
    if (kunci.current) return; kunci.current = true; setSibuk(true); setGalat(null);
    try {
      const r = await api.postStatusKerjaManual(u.id, { status: key, note: note?.trim() || undefined, expectedLatestId: km?.terakhirId ?? null });
      setKonf(null); setCatatan(""); onPesan?.(r?.dicatat === false ? "Sudah sama dengan catatan terakhir." : konfirmasiKerja(key, u.unitCode)?.sukses ?? `Status kerja ${u.unitCode}: ${km.nilaiBoleh.find((n) => n.key === key)?.label || key}.`); await onDone();
    } catch (e) { setKonf(null); setGalat(e); } finally { setSibuk(false); kunci.current = false; }
  }
  function pilih(key, el) {
    if (!bisa || key === sekarang || sibuk) return;
    if (KERJA_PERLU_KONFIRMASI.includes(key) || KERJA_WAJIB_CATATAN.includes(key)) { setCatatan(""); setKonf({ key, anchor: el }); return; }
    simpan(key);
  }
  const wajibCatatan = konf && KERJA_WAJIB_CATATAN.includes(konf.key); const labelKonf = konf ? km.nilaiBoleh.find((n) => n.key === konf.key)?.label : "";
  // Sudah dikerjakan / Selesai memakai teks konfirmasi resmi dari orderProduksiModel.js (sama dengan pencatatan manual sebelumnya)
  const teksResmi = konf ? konfirmasiKerja(konf.key, u.unitCode) : null;
  const terakhir = km?.riwayat?.length ? km.riwayat[km.riwayat.length - 1] : null;
  return (
    <div className="pf-blok" id="pf-kerja" data-testid="status-kerja-form">
      <div className="mb-2 flex items-baseline justify-between gap-3"><span className="text-[15px]">Status kerja</span>{pk.sumber && <span className="pf-kecil" data-testid="pekerjaan-sumber">{pk.sumber}</span>}</div>
      <div className="pf-segmen kecil" role="group" aria-label="Status kerja" data-testid="kerja-segmen">
        {segmenKerja(km).map((s) => (
          <button key={s.key} type="button" className="pf-segmen-btn" aria-pressed={sekarang === s.key} title={s.judul} disabled={!bisa && sekarang !== s.key} data-testid={`kerja-${s.key}`} onClick={(e) => pilih(s.key, e.currentTarget)}>
            {sekarang === s.key && <motion.span layoutId={`pf-kerja-pil-${u.id}`} className="pf-segmen-pil" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            {s.label}
          </button>
        ))}
      </div>
      {!bisa && <p className="pf-kecil mt-2">{!aktif ? "Unit sudah selesai/dibatalkan." : "Akun Anda hanya bisa melihat."}</p>}
      {terakhir && <p className="pf-kecil mt-2" data-testid="kerja-riwayat">Terakhir dicatat {terakhir.by || "—"}, {waktuWib(terakhir.at)}{terakhir.note ? ` — “${terakhir.note}”` : ""}</p>}
      <Hasil hasil={{ galat, ok: "" }} onMuat={onDone} />
      {konf && (
        <KonfirmasiCepat anchor={konf.anchor} testid="konfirmasi-kerja" lebar={teksResmi ? 340 : 300} judul={teksResmi?.judul ?? `Catat ${u.unitCode} “${labelKonf}”?`} labelYa={teksResmi?.ya ?? "Catat"} sibuk={sibuk}
          isi={teksResmi?.isi ?? "Tulis alasan singkat supaya tim lain tahu."}
          yaNonaktif={wajibCatatan && catatan.trim().length < 3} onYa={() => simpan(konf.key, catatan)} onClose={() => !sibuk && setKonf(null)}>
          {wajibCatatan ? <input className="pf-input" value={catatan} maxLength={500} onChange={(e) => setCatatan(e.target.value)} placeholder="Mis. menunggu kain dari supplier" data-testid="kerja-catatan" /> : null}
        </KonfirmasiCepat>
      )}
    </div>
  );
}

// ── Target selesai: ketuk → pilih tanggal (atau kosongkan).
function BarisTarget({ data, aktif, onDone, onPesan }) {
  const { adopsi: ad, izin = {}, unit: u } = data;
  const t = badgeTarget(ad.targetSelesai?.at);
  const [konf, setKonf] = useState(null); const [tgl, setTgl] = useState(""); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null);
  const bisa = !!izin.target && aktif;
  async function simpan(nilai) {
    setSibuk(true); setGalat(null);
    try { await api.updateUnitProduction(u.id, { productionDueAt: isoTarget(nilai), expected: { productionDueAt: u.productionDueAt ?? null } }); setKonf(null); onPesan?.(nilai ? `Target ${u.unitCode}: ${formatTanggal(isoTarget(nilai))}.` : `Target ${u.unitCode} dikosongkan.`); await onDone(); }
    catch (e) { setKonf(null); setGalat(e.code === "UNIT_CONFLICT" || e.status === 409 ? Object.assign(e, { code: "RIWAYAT_BERUBAH" }) : e); } finally { setSibuk(false); }
  }
  const sumber = ad.targetSelesai ? (ad.targetSelesai.sumber === "UNIT" ? null : "Dari Rencana Produksi") : null;
  return (
    <>
      <Baris id="pf-target" testid="target-pic-form" label="Target selesai" sub={sumber} kuat={t.ada}
        nilai={t.ada ? <span className={t.nada === "red" ? "text-red" : t.nada === "orange" ? "text-orange" : ""}>{t.teks}</span> : "Belum ada"}
        onClick={bisa ? (e) => { setTgl(tanggalWib(u.productionDueAt || ad.targetSelesai?.at)); setKonf({ anchor: e.currentTarget }); } : undefined} />
      {galat && <div className="px-4 pb-3"><Hasil hasil={{ galat, ok: "" }} onMuat={onDone} /></div>}
      {konf && (
        <KonfirmasiCepat anchor={konf.anchor} testid="konfirmasi-target" judul="Target selesai" labelYa="Simpan" sibuk={sibuk} yaNonaktif={!tgl} onYa={() => simpan(tgl)} onClose={() => !sibuk && setKonf(null)}>
          <input type="date" className="pf-input" value={tgl} onChange={(e) => setTgl(e.target.value)} data-testid="target-tanggal" aria-label="Tanggal target selesai" />
          {(u.productionDueAt || ad.targetSelesai) && <button type="button" className="pf-tautan mt-1" onClick={() => simpan("")} disabled={sibuk} data-testid="target-kosongkan">Kosongkan target</button>}
        </KonfirmasiCepat>
      )}
    </>
  );
}

// ── Status order (sama dengan yang dilihat Sales & Delivery): ketuk → pilih Diproses / Siap Kirim.
const OPSI_ORDER = [{ key: "PROCESSING", label: "Diproses" }, { key: "READY", label: "Siap Kirim" }];
function BarisStatusOrder({ data, ruang, aktif, onDone, onPesan }) {
  const { adopsi: ad, izin = {}, unit: u } = data;
  const so = ruang?.order?.statusOrder || ad.orderSales;
  const [konf, setKonf] = useState(null); const [pilihan, setPilihan] = useState("PROCESSING"); const [sibuk, setSibuk] = useState(false); const [galat, setGalat] = useState(null);
  const bisa = !!izin.statusOrder && aktif;
  async function simpan() {
    setSibuk(true); setGalat(null);
    try { await api.updateOrder(u.order.id, { status: pilihan, statusOverrideNote: "Diubah dari profil unit Produksi" }); setKonf(null); onPesan?.(`Order ${u.order.orderNumber} kini ${OPSI_ORDER.find((o) => o.key === pilihan)?.label}. Sales dan Delivery melihat status yang sama.`); await onDone(); }
    catch (e) { setKonf(null); setGalat(e); } finally { setSibuk(false); }
  }
  return (
    <>
      <Baris testid="status-order-form" label="Status order" sub={so?.terkunci ? "Dikunci manual" : "Dilihat Sales & Delivery"} nilai={so?.label || "—"} kuat nilaiTestid="order-saat-ini"
        onClick={bisa ? (e) => { setPilihan(so?.mentah === "PROCESSING" || so?.key === "DIPROSES" ? "READY" : "PROCESSING"); setKonf({ anchor: e.currentTarget }); } : undefined} />
      {galat && <div className="px-4 pb-3"><Hasil hasil={{ galat, ok: "" }} onMuat={onDone} /></div>}
      {konf && (
        <KonfirmasiCepat anchor={konf.anchor} testid="konfirmasi-order" judul={`Ubah status order ${u.order.orderNumber}?`} isi={`Berlaku di semua workspace.${u.order.jumlahUnit > 1 ? ` Order ini punya ${u.order.jumlahUnit} unit.` : ""}`} labelYa="Ubah" sibuk={sibuk} onYa={simpan} onClose={() => !sibuk && setKonf(null)}>
          <div className="pf-segmen" role="radiogroup" aria-label="Status order baru">
            {OPSI_ORDER.map((o) => (
              <button key={o.key} type="button" role="radio" aria-checked={pilihan === o.key} aria-pressed={pilihan === o.key} className="pf-segmen-btn" onClick={() => setPilihan(o.key)} data-testid={`order-${o.key}`}>
                {pilihan === o.key && <motion.span layoutId="pf-order-pil" className="pf-segmen-pil" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}{o.label}
              </button>
            ))}
          </div>
        </KonfirmasiCepat>
      )}
    </>
  );
}

// ── Penerimaan di workshop (catatan asli tidak pernah dihapus; koreksi lewat modal resmi).
function BarisPenerimaan({ data, aktif, onDone, onPesan }) {
  const { penerimaan: p, riwayatPenerimaan: riwayat = [], izin = {}, unit: u } = data;
  const [buka, setBuka] = useState(false);
  const batal = riwayat.filter((r) => !r.aktif).length;
  if (!p) return batal ? <Baris testid="penerimaan-dibatalkan" label="Penerimaan di workshop" sub="Belum ada penerimaan yang berlaku — penerimaan sebelumnya dinyatakan belum diterima fisik" nilai="Dibatalkan" /> : null;
  const boleh = aktif && (izin.koreksiLokasiPenerimaan || izin.koreksiBelumDiterima);
  const sub = [`${p.receivedBy?.name || "petugas"} · ${waktuWib(p.receivedAt)}`, p.koreksi?.length ? `dikoreksi ${p.koreksi.length}×` : null, batal ? `${batal} catatan lama dibatalkan` : null].filter(Boolean).join(" · ");
  return (
    <>
      <Baris testid="kartu-penerimaan" label="Diterima di workshop" sub={<span data-testid="penerimaan-ringkas">{sub}{p.note ? ` — “${p.note}”` : ""}</span>} nilai={p.location?.code} onClick={boleh ? () => setBuka(true) : undefined} />
      {p.koreksi?.length > 0 && <ul className="m-0 list-none px-4 pb-3 pl-4 text-[12px] text-ink3" data-testid="penerimaan-koreksi">{p.koreksi.map((k) => <li key={k.id}>{teksKoreksi(k)}</li>)}</ul>}
      {buka && <KoreksiPenerimaanModal unit={{ unitId: u.id, unitCode: u.unitCode }} onClose={() => setBuka(false)} onDone={async (pesan) => { setBuka(false); onPesan?.(pesan); await onDone(); }} />}
    </>
  );
}

// ── HPP & bahan dipakai — TERBUKA untuk semua yang membuka profil (keputusan Owner 14 Nov 2026: dievaluasi bersama tim di rapat untuk efisiensi bahan baku).
// Sumber: read-model server hppOperasionalUnit (data.hppOperasional; harga berlaku dibekukan saat pemakaian) — BUKAN biaya perolehan Finance (PO/supplier, tetap Finance).
// Pemakaian tanpa harga ≠ Rp0: ditandai "tanpa harga" dan total berstatus sebagian.
function GrupHpp({ data, onBagian }) {
  const ring = ringkasHpp(data.hppOperasional);
  const lama = data.komponenLama?.total?.pemakaianKembali?.jumlahItem ?? 0; const sementara = data.adopsi?.pemakaianBahan?.sementaraPerluRekonsiliasi ?? 0;
  const daftar = ring?.perBahan ?? [];
  const kosong = daftar.length === 0 && !lama && !sementara;
  return (
    <Grup judul="HPP bahan" testid="ringkasan-hpp">
      <div className="pf-blok" data-testid="hpp-total">
        {!ring ? <p className="pf-kecil m-0">HPP belum tersedia. Rincian bahan ada di tab Bahan.</p> : (
          <>
            <p className="pf-hpp-total m-0" data-testid="hpp-nilai">{ring.total != null ? rpNilai(ring.total) : "Belum ada"}</p>
            <p className="pf-kecil m-0 mt-0.5">{kosong ? "HPP muncul otomatis begitu bahan dicatat" : ring.total == null ? "Bahan sudah dicatat, tetapi harganya belum dibekukan" : ring.parsial ? `Sebagian: ${ring.tanpaHarga} pemakaian belum punya harga (tidak dihitung Rp0)` : "Lengkap menurut harga berlaku saat pemakaian"}</p>
          </>
        )}
      </div>
      {daftar.map((b) => (
        <Baris key={b.kode} testid="hpp-bahan" label={b.nama} sub={`${formatJumlah(b.dipakai)} ${b.satuan}${b.kode ? ` · ${b.kode}` : ""}`} kuat
          nilai={b.nilai != null ? <span className={b.tanpaHarga ? "text-orange" : ""}>{rpNilai(b.nilai)}{b.tanpaHarga ? " +" : ""}</span> : <span className="text-orange">tanpa harga</span>} />
      ))}
      {lama > 0 && <Baris label="Komponen lama dipakai kembali" sub="Dari kasur ini — bukan stok, tanpa biaya" nilai={`${lama} item`} />}
      {sementara > 0 && <Baris label="Pemakaian sementara" sub="Bahan belum di katalog — perlu rekonsiliasi Gudang" nilai={`${sementara} catatan`} />}
      {ring && ring.susut > 0 && <Baris label="Susut (sisa/rusak)" sub="Dicatat terpisah dari HPP" nilai={rpNilai(ring.susut)} />}
      {ring && ring.belumMemakai > 0 && <Baris label="Akan dipakai (belum keluar)" sub="Pratinjau harga terbaru, belum dibekukan" nilai={ring.pratinjauBelumMemakai != null ? rpNilai(ring.pratinjauBelumMemakai) : `${ring.belumMemakai} bahan`} />}
      <Baris label={kosong ? "Catat bahan" : "Rincian & catat bahan"} nilai={barisBahan(data)} onClick={() => onBagian("bahan")} testid="cuplikan-buka-bahan" />
      <p className="pf-kecil m-0 px-4 pb-3 pt-1">Harga berlaku saat pemakaian · bukan nilai persediaan Finance.</p>
    </Grup>
  );
}

function GrupOrder({ data, ruang }) {
  const { unit: u } = data; const d = ruang?.order?.detail; const k = d?.kondisiPelanggan;
  const layanan = ruang?.order?.layanan?.join(" + ");
  return (
    <Grup judul="Order" testid="ringkasan-order">
      <Baris label="Layanan" nilai={layanan || "Belum tercatat"} kuat={!!layanan} testid="pekerjaan-layanan" />
      <Baris label="Kasur" nilai={[u.merk, u.ukuran].filter(Boolean).join(" · ") || "—"} kuat />
      <Baris label="Kondisi pelanggan" sub={k?.sakit === true && k.keluhan?.length ? <span data-testid="keluhan-pelanggan">Keluhan: {k.keluhan.join(", ")}</span> : null}
        nilai={<span data-testid="kondisi-pelanggan">{k?.sakit === true ? <Badge variant="red" className="bh-b-red"><HeartPulse size={11} className="mr-1" aria-hidden />{k.label}</Badge> : k?.label || "—"}</span>} />
      <Baris label="Janji ke pelanggan" nilai={d?.janjiPelanggan ? formatTanggal(d.janjiPelanggan) : "Belum ada"} kuat={!!d?.janjiPelanggan} />
      {d?.catatanProduksi && <div className="pf-blok"><p className="pf-catatan" data-testid="catatan-produksi"><span className="pf-catatan-cap">Catatan Sales untuk Produksi</span>{d.catatanProduksi}</p></div>}
      {d?.komplain && <div className="pf-blok"><p className="pf-catatan merah" data-testid="komplain-order"><span className="pf-catatan-cap">Komplain {d.komplain.selesai ? "· sudah selesai" : "· belum selesai"}{d.komplain.tanggal ? ` · ${formatTanggal(d.komplain.tanggal)}` : ""}</span>{d.komplain.rincian || "Tanpa rincian."}</p></div>}
    </Grup>
  );
}

function GrupLainnya({ data, ruang }) {
  const { unit: u, adopsi: ad } = data;
  return (
    <section className="pf-grup" data-testid="detail-lanjutan">
      <details className="pf-lipat">
        <summary>Info lainnya<ChevronRight {...IK} size={16} className="pf-chevron" aria-hidden /></summary>
        <div>
          <Baris label="Pelanggan" nilai={u.order?.customer?.name || "—"} />
          <Baris label="Order" nilai={`${u.order?.orderNumber || "—"} · ${u.order?.jumlahUnit ?? 1} unit`} />
          {u.order?.unitLain?.length > 0 && <Baris label="Unit lain di order ini" nilai={u.order.unitLain.map((x) => x.unitCode).join(", ")} />}
          <Baris label="Prioritas" nilai={u.priority === "URGENT" ? "Mendesak" : u.priority === "HIGH" ? "Tinggi" : "Normal"} />
          <Baris label="Posisi" sub={ad.posisi?.detail || data.receivedBasisLabel || null} nilai={ad.posisi?.label || "—"} />
          <Baris label="Terakhir diubah" nilai={waktuWib(u.updatedAt)} />
          {ruang?.order?.statusOrder?.terkunci && <Baris label="Status order" nilai="Dikunci manual" />}
        </div>
      </details>
    </section>
  );
}

export default function RingkasanUnit({ data, ruang, aktif, onDone, onBagian, onPesan, adaMeja = false, fokusKelengkapan = false }) {
  const { adopsi: ad } = data; const pk = ringkasPekerjaan(data);
  const fokus = (id) => { const el = document.getElementById(id); if (!el) return; el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); (el.matches("button") ? el : el.querySelector("button:not(:disabled)"))?.focus({ preventScroll: true }); };
  const kel = ad.kelengkapan;
  const tampilKelengkapan = fokusKelengkapan || !!kel?.keys?.length || !!kel?.pernyataan || (kel?.dataOrder && kel.dataOrder.status !== "BELUM_DINILAI");
  const adaCatatanHistoris = (data.catatanHistoris?.ringkas?.total ?? 0) > 0 || !!data.hppBahan;
  return (
    <div className="pf-ringkasan" data-testid="bagian-ringkasan">
      <div className="pf-kolom" data-testid="ringkasan-kiri-atas">
        <LangkahBerikutnya data={data} aktif={aktif} adaMeja={adaMeja} onDone={onDone} onBagian={onBagian} onFokus={fokus} onPesan={onPesan} />
        <Grup judul="Pekerjaan" testid="ringkasan-pekerjaan">
          <BarisKerja data={data} aktif={aktif} onDone={onDone} onPesan={onPesan} />
          <Baris label="Jadwal produksi" nilai={<span data-testid="pekerjaan-jadwal">{pk.faktaJadwal || pk.jadwal}</span>} kuat={!!ad.jadwal} />
          <BarisTarget data={data} aktif={aktif} onDone={onDone} onPesan={onPesan} />
          <Baris label="PIC" sub={ad.pic ? (ad.pic.sumber === "TAHAP" ? "Penugasan tahap" : "Dari Rencana Produksi") : "Diatur di Rencana Produksi"} nilai={[ad.pic?.nama || "Belum ada", ad.meja ? String(ad.meja).replace("TABLE_", "Meja ") : null].filter(Boolean).join(" · ")} kuat={!!ad.pic} testid="pic-teks" />
          <BarisStatusOrder data={data} ruang={ruang} aktif={aktif} onDone={onDone} onPesan={onPesan} />
          <BarisPenerimaan data={data} aktif={aktif} onDone={onDone} onPesan={onPesan} />
        </Grup>
        <Grup testid="ringkasan-kiri-bawah">
          <Baris label="Foto" nilai={barisFoto(ruang)} onClick={() => onBagian("dokumentasi")} testid="cuplikan-buka-dokumentasi" />
          {adaMeja && <Baris label="Meja & QC" sub="Tahap, diagnosis, QC & serah ke Gudang" nilai={ruang?.alurMeja?.tahap || null} onClick={() => onBagian("meja")} testid="buka-meja" />}
        </Grup>
      </div>
      <div className="pf-kolom" data-testid="ringkasan-kanan">
        <GrupHpp data={data} onBagian={onBagian} />
        <GrupOrder data={data} ruang={ruang} />
        {(tampilKelengkapan || adaCatatanHistoris) && (
          <Grup judul={tampilKelengkapan ? "Kelengkapan" : "Biaya bahan"} testid="ringkasan-kelengkapan">
            {tampilKelengkapan && <div className="pf-blok" id="sec-kelengkapan"><KelengkapanBagian data={data} aktif={aktif} onDone={onDone} ringkas terbukaAwal={fokusKelengkapan} /></div>}
            {adaCatatanHistoris && <div className="pf-blok"><CatatanRingkas data={data} /></div>}
          </Grup>
        )}
        <GrupLainnya data={data} ruang={ruang} />
      </div>
    </div>
  );
}
