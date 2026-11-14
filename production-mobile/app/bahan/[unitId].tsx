import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { Check, CheckCircle2, Minus, Plus, Trash2 } from "lucide-react-native";
import { cariKatalogBahan, catatBahanUnit, kelompokPengajuan, pratinjauPembetulan, useAdopsiUnit, usePengajuanMenunggu, type BahanKatalogQc, type Pratinjau } from "@/api/bahanQc";
import { pesanUntukPengguna } from "@/api/errors";
import {
  angka, bolehKirimKeranjang, bolehKonfirmasi, geserJumlah, hapusKeranjang, hariIniWib, hppBaris, isianDari, keadaanSaldo, kemarinWib, parseJumlah, perluPembetulan, qtyStok,
  ringkasHpp, rupiah, sidik, tambahKeranjang, teksStok, tubuhBiasa, tubuhPembetulan, tubuhPratinjau, ubahKeranjang, validasi, type BarisKeranjang, type Bersama,
} from "@/features/catatBahanQc";
import { CentangBaris, Isian } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Segmented } from "@/design/Segmented";
import { Baris, Button, Card, Chip, KeteranganPanel, KolomCari, Screen, Section, StateView, T, TeksBaris } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { Letup } from "@/design/gerak";
import { C, F, TONE } from "@/design/tokens";

// CATAT BAHAN (tim QC & Dokumentasi) — GAYA KASIR, cermin drawer "Catat pemakaian bahan" di web (CatatBahanBaru.jsx):
//   Katalog (cari + kategori Gudang + harga + stok)  →  Dipilih (jumlah per bahan, subtotal, total HPP)  →  catat semuanya sekaligus.
// Tiap bahan tetap dikirim sebagai SATU pencatatan resmi (POST /units/:id/materials, Idempotency-Key sendiri) — sama dengan web.
// Selain ADMIN → PENGAJUAN yang diverifikasi ADMIN (stok & HPP berubah sesudahnya). Unit TERKIRIM → pembetulan: alasan + tanggal
// (sekali untuk semua bahan) + "Lihat dampak" per bahan dari server sebelum boleh dicatat.
type StatusBaris = { fase: "sibuk" } | { fase: "ok"; aju: boolean; pesan: string } | { fase: "galat"; pesan: string };
type PraBaris = { pra: Pratinjau; sidik: string; periksa: boolean };
const NADA_STOK = { green: TONE.green.text, orange: TONE.orange.text, red: TONE.red.text, gray: C.ink3 } as const;

export default function CatatBahanQc() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const a = useAdopsiUnit(unitId);
  const aju = usePengajuanMenunggu();
  const menunggu = kelompokPengajuan(aju.data?.pengajuan).get(unitId ?? "") ?? [];

  const [tab, setTab] = useState<"katalog" | "dipilih">("katalog");
  const [cari, setCari] = useState("");
  const [tunda, setTunda] = useState("");
  const [kelompok, setKelompok] = useState("");
  const [keranjang, setKeranjang] = useState<BarisKeranjang[]>([]);
  const [bersama, setBersama] = useState<Bersama>({ catatan: "", alasan: "", tanggal: hariIniWib() });
  const [status, setStatus] = useState<Record<string, StatusBaris>>({});
  const [pra, setPra] = useState<Record<string, PraBaris>>({});
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(new Map<string, string>());

  useEffect(() => { const t = setTimeout(() => setTunda(cari.trim()), 250); return () => clearTimeout(t); }, [cari]);
  const katalog = useQuery({ queryKey: ["katalog-bahan", tunda, kelompok], queryFn: () => cariKatalogBahan(tunda, kelompok), staleTime: 60_000, placeholderData: (lama) => lama });

  const u = a.data?.unit;
  const boleh = !!a.data?.izin?.pemakaianAktual;
  const pembetulan = perluPembetulan(u?.status);
  const selesai = (id: string) => status[id]?.fase === "ok";
  const tunggu = keranjang.filter((b) => !selesai(b.bahan.materialId)); // yang belum tercatat
  const hpp = useMemo(() => ringkasHpp(keranjang.filter((b) => status[b.bahan.materialId]?.fase !== "ok")), [keranjang, status]);
  const dipilihIds = useMemo(() => new Set(keranjang.map((b) => b.bahan.materialId)), [keranjang]);
  const sidikBaris = (b: BarisKeranjang) => sidik(isianDari(b, bersama));
  const praSah = (b: BarisKeranjang) => { const p = pra[b.bahan.materialId]; return bolehKonfirmasi(p?.pra ?? null, sidikBaris(b), p?.sidik ?? null, !!p?.periksa); };
  const semuaPraAda = tunggu.length > 0 && tunggu.every((b) => pra[b.bahan.materialId]?.sidik === sidikBaris(b));
  const kunciUntuk = (s: string) => { if (!kunci.current.has(s)) kunci.current.set(s, `qc-bahan-${randomUUID()}`); return kunci.current.get(s)!; };

  const pilih = (r: BahanKatalogQc) => {
    haptic.tick(); setGalat(null);
    if (dipilihIds.has(r.materialId)) { if (!selesai(r.materialId)) setKeranjang((x) => hapusKeranjang(x, r.materialId)); return; }
    setKeranjang((x) => tambahKeranjang(x, { materialId: r.materialId, nama: r.nama, kode: r.kode, satuan: r.satuan, satuanPakai: r.satuanPakai, tersedia: r.tersedia, saldoDiketahui: r.saldoDiketahui, keadaan: r.keadaan ?? null, harga: r.harga }));
  };
  const ubah = (id: string, p: Partial<Pick<BarisKeranjang, "qty" | "satuan">>) => { setKeranjang((x) => ubahKeranjang(x, id, p)); setGalat(null); setStatus((s) => (s[id]?.fase === "galat" ? { ...s, [id]: undefined as never } : s)); };
  const setB = (p: Partial<Bersama>) => { setBersama((x) => ({ ...x, ...p })); setGalat(null); };

  /** Unit terkirim: minta pratinjau dampak (baca-saja) untuk tiap bahan yang belum tercatat. */
  async function lihatDampak() {
    const v = bolehKirimKeranjang(tunggu, bersama, u!.status);
    if (!v.ok) { setGalat(v.galat); return; }
    setBusy(true); setGalat(null);
    for (const b of tunggu) {
      const isi = isianDari(b, bersama); const q = validasi(isi, u!.status);
      if (!q.ok) continue;
      try {
        const p = await pratinjauPembetulan(unitId!, tubuhPratinjau(isi, q.qty), `qc-pra-${randomUUID()}`);
        setPra((x) => ({ ...x, [b.bahan.materialId]: { pra: p, sidik: sidik(isi), periksa: false } }));
        setStatus((s) => ({ ...s, [b.bahan.materialId]: undefined as never }));
      } catch (e) { setStatus((s) => ({ ...s, [b.bahan.materialId]: { fase: "galat", pesan: pesanUntukPengguna(e) } })); }
    }
    setBusy(false);
  }

  /** Catat semua bahan yang belum tercatat — satu permintaan per bahan; yang gagal tetap di keranjang dengan pesannya. */
  async function catat() {
    const v = bolehKirimKeranjang(tunggu, bersama, u!.status);
    if (!v.ok) { setGalat(v.galat); return; }
    if (pembetulan && !tunggu.every(praSah)) { setGalat("Lihat dampak dulu untuk semua bahan (isian berubah sejak pratinjau, atau ada yang perlu diperiksa)."); return; }
    setBusy(true); setGalat(null);
    let berhasil = 0;
    for (const b of tunggu) {
      const id = b.bahan.materialId; const isi = isianDari(b, bersama); const q = validasi(isi, u!.status);
      if (!q.ok) continue;
      setStatus((s) => ({ ...s, [id]: { fase: "sibuk" } }));
      try {
        const body = pembetulan ? tubuhPembetulan(isi, q.qty, pra[id]!.pra, pra[id]!.periksa) : tubuhBiasa(isi, q.qty);
        const r = await catatBahanUnit(unitId!, body, kunciUntuk(sidik(isi)));
        berhasil += 1;
        setStatus((s) => ({ ...s, [id]: { fase: "ok", aju: !!r.menungguVerifikasi, pesan: r.menungguVerifikasi ? "Diajukan — menunggu verifikasi Admin" : "Tercatat" } }));
      } catch (e) { setStatus((s) => ({ ...s, [id]: { fase: "galat", pesan: pesanUntukPengguna(e) } })); }
    }
    setBusy(false);
    if (berhasil) {
      haptic.sukses();
      void qc.invalidateQueries({ queryKey: ["bahan-belum"] }); void qc.invalidateQueries({ queryKey: ["pengajuan-pemakaian"] }); void qc.invalidateQueries({ queryKey: ["adopsi", unitId] }); void qc.invalidateQueries({ queryKey: ["katalog-bahan"] });
    }
  }
  const tambahLagi = () => { setKeranjang((x) => x.filter((b) => !selesai(b.bahan.materialId))); setTab("katalog"); };

  const nTunggu = tunggu.length; const nSelesai = keranjang.length - nTunggu;
  const ringkas = `${nTunggu} bahan${hpp.tampil ? ` · ${rupiah(hpp.total)}` : ""}`;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<NavBar judul="Catat bahan" />} refreshing={a.isRefetching} onRefresh={() => void a.refetch()} bottomPad={boleh ? 150 : 40}>
        {a.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
        {a.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(a.error)} onRetry={() => void a.refetch()} /> : null}

        {u ? (
          <>
            <Card style={{ gap: 8 }}>
              <Baris style={{ alignItems: "flex-start" }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <T.Row numberOfLines={1} style={{ fontSize: 15 }}>{u.unitCode}</T.Row>
                  <T.RowSub numberOfLines={2}>{[u.order?.customer?.name, [u.merk, u.ukuran].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Detail kasur belum dicatat"}</T.RowSub>
                  {pembetulan ? <Chip label="Unit sudah terkirim — pembetulan bahan" tone="orange" style={{ marginTop: 4 }} /> : null}
                </View>
              </Baris>
            </Card>

            {!boleh ? (
              <StateView kind="empty" title="Hanya bisa melihat" text="Akun ini belum punya izin mencatat bahan. Minta Admin memeriksa peran di Pengguna & Peran." />
            ) : (
              <Segmented value={tab} onChange={setTab} options={[{ key: "katalog", label: "Katalog bahan" }, { key: "dipilih", label: `Dipilih${keranjang.length ? ` · ${keranjang.length}` : ""}` }]} />
            )}

            {boleh && tab === "katalog" ? (
              <Card style={{ gap: 8 }}>
                <KolomCari accessibilityLabel="Cari bahan" value={cari} onChangeText={setCari} placeholder="Cari bahan (nama atau kode)" />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
                  {[{ kode: "", label: "Semua", jumlah: null as number | null }, ...(katalog.data?.kelompok ?? []).filter((k) => k.jumlah > 0 || k.kode === kelompok)].map((k) => {
                    const on = kelompok === k.kode;
                    return (
                      <Pressable key={k.kode || "semua"} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { haptic.tick(); setKelompok(k.kode); }}
                        style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: on ? TONE.blue.fill : C.white }}>
                        <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: on ? F.bold : F.semibold, fontSize: 13.5, color: on ? C.white : "#42526B" }}>{k.label}</Text>
                        {k.jumlah != null ? <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 12, color: on ? "#DCEBFF" : C.ink3 }}>{k.jumlah}</Text> : null}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {katalog.error ? <T.RowSub style={{ color: TONE.red.text, fontSize: 13 }}>{pesanUntukPengguna(katalog.error)}</T.RowSub> : null}
                {katalog.isLoading ? <StateView kind="loading" title="Memuat katalog…" /> : null}
                {(katalog.data?.rows ?? []).map((r) => {
                  const ada = dipilihIds.has(r.materialId); const stok = teksStok(r);
                  return (
                    <Baris key={r.materialId} onPress={() => pilih(r)} accessibilityLabel={ada ? `${r.nama} sudah dipilih, ketuk untuk membatalkan` : `Pilih ${r.nama}`}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T.Row numberOfLines={2}>{r.nama}</T.Row>
                        <T.RowSub numberOfLines={1}>
                          {r.harga ? (r.harga.harga != null ? `${rupiah(r.harga.harga)} / ${String(r.satuan ?? "").toLowerCase()}` : "Harga belum ada") : r.kode}
                          {kelompok ? "" : ` · ${r.kelompok?.label ?? ""}`}
                        </T.RowSub>
                        <T.RowSub numberOfLines={1} style={{ color: NADA_STOK[stok.nada] }}>{stok.teks}</T.RowSub>
                      </View>
                      <View style={{ height: 38, paddingHorizontal: 12, borderRadius: 19, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: ada ? TONE.green.tint : "#D8E9FF" }}>
                        {ada ? <Check size={15} color={TONE.green.text} strokeWidth={2.8} /> : <Plus size={15} color="#0056B3" strokeWidth={2.8} />}
                        <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.bold, fontSize: 13, color: ada ? TONE.green.text : "#0056B3" }}>{ada ? "Dipilih" : "Pilih"}</Text>
                      </View>
                    </Baris>
                  );
                })}
                {!katalog.isLoading && !katalog.error && !(katalog.data?.rows ?? []).length ? (
                  <StateView kind="empty" title="Bahan tidak ditemukan" text={kelompok ? "Coba kategori Semua, atau kata kunci lain." : "Bahan baru diusulkan lewat SANSS Web."} />
                ) : null}
                {katalog.data && katalog.data.total > katalog.data.rows.length ? <T.RowSub style={{ textAlign: "center" }}>Menampilkan {katalog.data.rows.length} dari {katalog.data.total}. Persempit dengan kata kunci atau kategori.</T.RowSub> : null}
              </Card>
            ) : null}

            {boleh && tab === "dipilih" ? (
              <>
                <Section title="Bahan dipilih" right={<KeteranganPanel>{keranjang.length} bahan</KeteranganPanel>}>
                  {!keranjang.length ? <StateView kind="empty" title="Belum ada bahan dipilih" text="Buka Katalog bahan, ketuk Pilih pada bahan yang dipakai, lalu isi jumlahnya di sini." /> : null}
                  {keranjang.map((b) => (
                    <BarisPilihan key={b.bahan.materialId} b={b} status={status[b.bahan.materialId]} pembetulan={pembetulan} sibuk={busy}
                      pra={pra[b.bahan.materialId]?.sidik === sidikBaris(b) ? pra[b.bahan.materialId] : undefined}
                      onPeriksa={(v) => setPra((x) => ({ ...x, [b.bahan.materialId]: { ...x[b.bahan.materialId]!, periksa: v } }))}
                      onUbah={(p) => ubah(b.bahan.materialId, p)} onHapus={() => { haptic.tick(); setKeranjang((x) => hapusKeranjang(x, b.bahan.materialId)); }} />
                  ))}
                </Section>

                {nTunggu ? (
                  <Card style={{ gap: 12 }}>
                    {pembetulan ? (
                      <>
                        <Isian label="Alasan pembetulan (wajib, untuk semua bahan)" value={bersama.alasan} onChange={(v) => setB({ alasan: v })} multiline placeholder="mis. Bahan dipakai saat pengerjaan tetapi belum dicatat" />
                        <View style={{ gap: 6 }}>
                          <Isian label="Tanggal bahan dipakai" value={bersama.tanggal} onChange={(v) => setB({ tanggal: v })} placeholder="TTTT-BB-HH" />
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <Button kind="tinted" label="Hari ini" onPress={() => setB({ tanggal: hariIniWib() })} style={{ minHeight: 40, flex: 1 }} />
                            <Button kind="tinted" label="Kemarin" onPress={() => setB({ tanggal: kemarinWib() })} style={{ minHeight: 40, flex: 1 }} />
                          </View>
                        </View>
                      </>
                    ) : (
                      <Isian label="Catatan untuk pemakaian ini (opsional)" value={bersama.catatan} onChange={(v) => setB({ catatan: v })} placeholder="mis. untuk lapisan atas" />
                    )}
                    {hpp.tampil ? (
                      <View style={{ borderRadius: 16, padding: 14, backgroundColor: C.isian, gap: 2 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                          <T.RowSub style={{ fontSize: 13 }}>Total HPP operasional</T.RowSub>
                          <Text maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 20, color: C.ink, fontVariant: ["tabular-nums"] }}>{rupiah(hpp.total)}</Text>
                        </View>
                        {hpp.nTanpaHarga ? <T.RowSub style={{ color: TONE.orange.text }}>{hpp.nTanpaHarga} bahan belum punya Harga Berlaku — belum masuk total (bukan Rp0). Minta Gudang mengisi harga.</T.RowSub> : null}
                        {hpp.nBelumJumlah ? <T.RowSub>{hpp.nBelumJumlah} bahan belum diisi jumlahnya.</T.RowSub> : null}
                        <T.RowSub>Perkiraan dari harga saat ini; angka resmi ditetapkan server saat dicatat.</T.RowSub>
                      </View>
                    ) : null}
                  </Card>
                ) : null}

                {menunggu.length ? (
                  <Section title="Sudah diajukan" right={<KeteranganPanel>menunggu Admin</KeteranganPanel>}>
                    {menunggu.flatMap((p) => (p.ringkasan?.baris ?? []).map((x, i) => ({ key: `${p.id}-${i}`, x, p }))).map(({ key, x, p }) => (
                      <Baris key={key}><TeksBaris judul={x.bahan ?? "Bahan"} sub={`${angka(Number(x.qty))} ${String(x.satuanInput ?? x.satuanStok ?? "").toLowerCase()} · diajukan ${p.pengaju ?? "—"}`} /></Baris>
                    ))}
                  </Section>
                ) : null}
                {a.data?.pemakaianAktual?.total?.length ? (
                  <Section title="Sudah tercatat" right={<KeteranganPanel>{a.data.pemakaianAktual.total.length} bahan</KeteranganPanel>}>
                    {a.data.pemakaianAktual.total.map((t) => (
                      <Baris key={t.materialId}>
                        <TeksBaris judul={t.nama ?? t.kode ?? "Bahan"} />
                        <T.Row style={{ fontVariant: ["tabular-nums"] }}>{angka(Number(t.dipakai))} {String(t.satuan ?? "").toLowerCase()}</T.Row>
                      </Baris>
                    ))}
                  </Section>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </Screen>

      {/* BATANG KASIR: jumlah bahan + total selalu terlihat; satu tombol utama sesuai langkah. */}
      {u && boleh ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 26, gap: 8, backgroundColor: C.white, boxShadow: "0 -6px 24px rgba(20,60,140,0.08)" }}>
          {galat ? <T.RowSub style={{ color: TONE.red.text, fontSize: 13 }}>{galat}</T.RowSub> : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T.RowSub numberOfLines={1}>{nTunggu ? "Belum dicatat" : nSelesai ? "Selesai" : "Keranjang"}</T.RowSub>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 17, color: C.ink, fontVariant: ["tabular-nums"] }}>{nTunggu ? ringkas : nSelesai ? `${nSelesai} terkirim` : "Kosong"}</Text>
            </View>
            {!nTunggu && nSelesai ? (
              <>
                <Button kind="tinted" label="Tambah lagi" onPress={tambahLagi} style={{ paddingHorizontal: 16 }} />
                <Button label="Selesai" onPress={() => router.back()} style={{ paddingHorizontal: 22 }} />
              </>
            ) : tab === "katalog" ? (
              <Button label={`Lihat pilihan${nTunggu ? ` (${nTunggu})` : ""}`} disabled={!keranjang.length} onPress={() => setTab("dipilih")} style={{ paddingHorizontal: 20 }} />
            ) : pembetulan && !semuaPraAda ? (
              <Button label="Lihat dampak dulu" busy={busy} disabled={!nTunggu} onPress={() => void lihatDampak()} style={{ paddingHorizontal: 20 }} />
            ) : (
              <Button label={`Catat ${nTunggu} bahan`} busy={busy} disabled={!nTunggu || (pembetulan && !tunggu.every(praSah))} onPress={() => void catat()} style={{ paddingHorizontal: 20 }} />
            )}
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** Satu bahan di keranjang: jumlah (− / ketik / +), satuan, harga & subtotal, keadaan stok, dan hasil kirimnya. */
function BarisPilihan({ b, status, pembetulan, sibuk, pra, onPeriksa, onUbah, onHapus }: {
  b: BarisKeranjang; status?: StatusBaris; pembetulan: boolean; sibuk: boolean; pra?: PraBaris;
  onPeriksa: (v: boolean) => void; onUbah: (p: Partial<Pick<BarisKeranjang, "qty" | "satuan">>) => void; onHapus: () => void;
}) {
  const h = hppBaris(b); const stok = teksStok(b.bahan); const saldo = pembetulan ? null : keadaanSaldo(b);
  const aturan = b.bahan.satuanPakai; const satuanIsi = (aturan ? b.satuan ?? aturan.satuanPakai : b.bahan.satuan ?? "").toLowerCase();
  const stokSetara = qtyStok(b); const jumlah = parseJumlah(b.qty);
  const ok = status?.fase === "ok"; const kunci = ok || sibuk;
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T.Row numberOfLines={2}>{b.bahan.nama}</T.Row>
          <T.RowSub numberOfLines={1}>{b.bahan.kode} · <Text style={{ color: NADA_STOK[stok.nada] }}>{stok.teks}</Text></T.RowSub>
        </View>
        {ok ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${b.bahan.nama} dari pilihan`} disabled={sibuk} hitSlop={6} onPress={onHapus}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: TONE.red.tint, alignItems: "center", justifyContent: "center" }}>
            <Trash2 size={16} color={TONE.red.text} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      {ok ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 14, backgroundColor: TONE.green.tint }}>
          <Letup kunci={status.pesan}><CheckCircle2 size={20} color={TONE.green.text} /></Letup>
          <T.RowSub style={{ flex: 1, color: TONE.green.text, fontSize: 13 }}>{angka(jumlah ?? 0)} {satuanIsi} · {status.pesan}</T.RowSub>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TombolJumlah label={`Kurangi ${b.bahan.nama}`} disabled={kunci || !(jumlah && jumlah > 0)} onPress={() => { haptic.tick(); onUbah({ qty: geserJumlah(b.qty, -1) }); }}><Minus size={18} color={C.ink} strokeWidth={2.6} /></TombolJumlah>
            <TextInput accessibilityLabel={`Jumlah ${b.bahan.nama}`} value={b.qty} onChangeText={(v) => onUbah({ qty: v })} editable={!kunci} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={C.ink3}
              style={{ width: 84, height: 44, borderRadius: 14, backgroundColor: C.isian, textAlign: "center", fontFamily: F.heavy, fontSize: 17, color: C.ink, paddingVertical: 0 }} />
            <TombolJumlah utama label={`Tambah ${b.bahan.nama}`} disabled={kunci} onPress={() => { haptic.tick(); onUbah({ qty: geserJumlah(b.qty, 1) }); }}><Plus size={18} color={C.white} strokeWidth={2.6} /></TombolJumlah>
            <T.RowSub style={{ fontSize: 13 }}>{satuanIsi}</T.RowSub>
          </View>

          {aturan ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {[aturan.satuanPakai, aturan.satuanStok].map((s) => {
                const on = (b.satuan ?? aturan.satuanPakai) === s;
                return (
                  <Pressable key={s} accessibilityRole="radio" accessibilityState={{ selected: on }} disabled={kunci} onPress={() => onUbah({ satuan: s })}
                    style={{ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: "center", backgroundColor: on ? TONE.blue.fill : C.isian }}>
                    <Text style={{ fontFamily: F.bold, fontSize: 13, color: on ? C.white : "#42526B" }}>{s.toLowerCase()}</Text>
                  </Pressable>
                );
              })}
              <T.RowSub style={{ flex: 1 }}>1 {aturan.satuanStok.toLowerCase()} = {angka(aturan.faktor)} {aturan.satuanPakai.toLowerCase()}{stokSetara != null && stokSetara > 0 && (b.satuan ?? aturan.satuanPakai) === aturan.satuanPakai ? ` · = ${angka(stokSetara)} ${aturan.satuanStok.toLowerCase()}` : ""}</T.RowSub>
            </View>
          ) : null}

          {h.status === "ada" ? (
            <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <T.RowSub numberOfLines={1} style={{ flexShrink: 1 }}>{rupiah(h.harga)} / {String(b.bahan.satuan ?? "").toLowerCase()}</T.RowSub>
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={{ fontFamily: F.heavy, fontSize: 15, color: h.subtotal != null ? C.ink : C.ink3, fontVariant: ["tabular-nums"] }}>{h.subtotal != null ? rupiah(h.subtotal) : "Rp0"}</Text>
            </View>
          ) : null}
          {h.status === "tanpa_harga" ? <T.RowSub style={{ color: TONE.orange.text }}>Harga Berlaku belum ada — bahan ini belum masuk total.</T.RowSub> : null}
          {saldo?.teks ? <T.RowSub style={{ color: saldo.blok ? TONE.red.text : C.ink3 }}>{saldo.teks}</T.RowSub> : null}
          {pra ? <Dampak pra={pra.pra} periksa={pra.periksa} setPeriksa={onPeriksa} /> : null}
          {status?.fase === "sibuk" ? <T.RowSub>Mengirim…</T.RowSub> : null}
          {status?.fase === "galat" ? <T.RowSub style={{ color: TONE.red.text, fontSize: 13 }}>{status.pesan}</T.RowSub> : null}
        </>
      )}
    </Card>
  );
}

function TombolJumlah({ children, onPress, disabled, utama, label }: { children: React.ReactNode; onPress: () => void; disabled?: boolean; utama?: boolean; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress}
      style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: utama ? TONE.blue.fill : C.isian, opacity: disabled ? 0.4 : 1 }}>
      {children}
    </Pressable>
  );
}

/** Ringkasan pratinjau server untuk satu bahan (unit terkirim) — angka dari server, tidak dihitung ulang di HP. */
function Dampak({ pra, periksa, setPeriksa }: { pra: Pratinjau; periksa: boolean; setPeriksa: (v: boolean) => void }) {
  const koma = (n: number | null | undefined) => (n == null ? "belum diketahui" : angka(n));
  const sat = pra.bahan?.satuan?.toLowerCase() ?? "";
  const kemungkinan = [...(pra.sudahTercatat?.tertaut ?? []), ...(pra.sudahTercatat?.kemungkinan ?? [])];
  return (
    <View style={{ borderRadius: 14, padding: 12, backgroundColor: C.isian, gap: 4 }}>
      <T.Row style={{ fontSize: 13 }}>Dampak</T.Row>
      {pra.stok ? <T.RowSub>Stok: {koma(pra.stok.saldoSebelum)} → {koma(pra.stok.saldoSesudah)} {sat}</T.RowSub> : null}
      <T.RowSub>Pemakaian di unit: {koma(pra.pemakaianBersih?.sebelum)} → {koma(pra.pemakaianBersih?.sesudah)} {sat}</T.RowSub>
      {pra.hppOperasional?.teks ? <T.RowSub>{pra.hppOperasional.teks}</T.RowSub> : null}
      {(pra.peringatan ?? []).map((p) => <T.RowSub key={p.kode} style={{ color: TONE.orange.text }}>{p.pesan}</T.RowSub>)}
      {(pra.penghalang ?? []).map((p) => <T.RowSub key={p.kode} style={{ color: TONE.red.text }}>{p.pesan}</T.RowSub>)}
      {pra.pengecualianStok?.perlu ? <T.RowSub style={{ color: TONE.red.text }}>Stok tidak cukup. Pengecualian hanya untuk Admin/Owner/Kepala Produksi — minta mereka mencatat lewat SANSS Web.</T.RowSub> : null}
      {kemungkinan.length ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          <T.RowSub style={{ color: C.ink2 }}>Mungkin sudah tercatat — periksa dulu:</T.RowSub>
          {kemungkinan.slice(0, 5).map((k, i) => <T.RowSub key={i}>• {("catatan" in k && k.catatan) || k.kind}</T.RowSub>)}
          {pra.sudahTercatat?.perluKonfirmasi ? <CentangBaris label="Saya sudah memeriksa. Ini pemakaian BARU, bukan yang sudah tercatat." value={periksa} onChange={setPeriksa} /> : null}
        </View>
      ) : null}
    </View>
  );
}
