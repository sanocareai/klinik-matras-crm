import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { CheckCircle2, Search } from "lucide-react-native";
import { cariKatalogBahan, catatBahanUnit, kelompokPengajuan, pratinjauPembetulan, useAdopsiUnit, usePengajuanMenunggu, type BahanKatalogQc, type Pratinjau } from "@/api/bahanQc";
import { pesanUntukPengguna } from "@/api/errors";
import { bolehKonfirmasi, hariIniWib, kemarinWib, perluPembetulan, satuanKirim, sidik, tubuhBiasa, tubuhPembetulan, tubuhPratinjau, validasi, type Isian as IsianBahan } from "@/features/catatBahanQc";
import { CentangBaris, Isian } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Chip, Divider, Screen, Section, StateView, T } from "@/design/ui";
import { haptic } from "@/design/haptics";
import { Letup } from "@/design/gerak";
import { C, F, G, TONE } from "@/design/tokens";

// CATAT BAHAN (tim QC & Dokumentasi) — satu bahan per catatan, jalur resmi yang SAMA dengan web (POST /units/:id/materials).
// Selain ADMIN → PENGAJUAN yang diverifikasi ADMIN (stok & HPP berubah sesudahnya). Unit TERKIRIM → pembetulan: alasan + tanggal + pratinjau dampak.
const KOSONG: IsianBahan = { bahan: null, qty: "", satuan: null, catatan: "", alasan: "", tanggal: hariIniWib() };

export default function CatatBahanQc() {
  const { unitId } = useLocalSearchParams<{ unitId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const a = useAdopsiUnit(unitId);
  const aju = usePengajuanMenunggu();
  const menunggu = kelompokPengajuan(aju.data?.pengajuan).get(unitId ?? "") ?? [];
  const [isi, setIsi] = useState<IsianBahan>(KOSONG);
  const [cari, setCari] = useState("");
  const [pra, setPra] = useState<Pratinjau | null>(null);
  const [sidikPra, setSidikPra] = useState<string | null>(null);
  const [periksa, setPeriksa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [selesai, setSelesai] = useState<string | null>(null);
  // Sesudah berhasil, katalog ditutup supaya pesan berhasil & "Sudah diajukan" langsung terlihat (temuan uji emulator 14 Nov 2026).
  const [pilihTerbuka, setPilihTerbuka] = useState(true);
  const kunci = useRef(new Map<string, string>());
  const katalog = useQuery({ queryKey: ["katalog-bahan", cari.trim()], queryFn: () => cariKatalogBahan(cari.trim()), enabled: !isi.bahan, staleTime: 60_000 });

  const u = a.data?.unit;
  const boleh = !!a.data?.izin?.pemakaianAktual;
  const pembetulan = perluPembetulan(u?.status);
  const set = (p: Partial<IsianBahan>) => { setIsi((x) => ({ ...x, ...p })); setGalat(null); };
  const kunciUntuk = (s: string) => { if (!kunci.current.has(s)) kunci.current.set(s, `qc-bahan-${randomUUID()}`); return kunci.current.get(s)!; };

  async function lihatDampak() {
    const v = validasi(isi, u!.status);
    if (!v.ok) { setGalat(v.galat); return; }
    setBusy(true); setGalat(null);
    try { setPra(await pratinjauPembetulan(unitId!, tubuhPratinjau(isi, v.qty), `qc-pra-${randomUUID()}`)); setSidikPra(sidik(isi)); setPeriksa(false); }
    catch (e) { setGalat(pesanUntukPengguna(e)); } finally { setBusy(false); }
  }

  async function catat() {
    const v = validasi(isi, u!.status);
    if (!v.ok) { setGalat(v.galat); return; }
    const s = sidik(isi);
    if (pembetulan && !bolehKonfirmasi(pra, s, sidikPra, periksa)) { setGalat("Lihat dampak dulu (isian berubah sejak pratinjau)."); return; }
    setBusy(true); setGalat(null);
    try {
      const body = pembetulan ? tubuhPembetulan(isi, v.qty, pra!, periksa) : tubuhBiasa(isi, v.qty);
      const r = await catatBahanUnit(unitId!, body, kunciUntuk(s));
      haptic.sukses();
      setSelesai(r.menungguVerifikasi ? (r.pesan ?? "Tercatat sebagai PENGAJUAN — stok & HPP berubah sesudah diverifikasi Admin.") : "Pemakaian bahan tercatat.");
      setIsi({ ...KOSONG, tanggal: isi.tanggal }); setPra(null); setSidikPra(null); setCari(""); setPilihTerbuka(false);
      void qc.invalidateQueries({ queryKey: ["bahan-belum"] }); void qc.invalidateQueries({ queryKey: ["pengajuan-pemakaian"] }); void qc.invalidateQueries({ queryKey: ["adopsi", unitId] });
    } catch (e) { setGalat(pesanUntukPengguna(e)); } finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen lembar header={<NavBar judul={u ? u.unitCode : "Catat bahan"} />} refreshing={a.isRefetching} onRefresh={() => void a.refetch()} bottomPad={60}>
        {a.isLoading ? <StateView kind="loading" title="Memuat unit…" /> : null}
        {a.error ? <StateView kind="error" title="Unit tidak bisa dimuat" text={pesanUntukPengguna(a.error)} onRetry={() => void a.refetch()} /> : null}

        {u ? (
          <>
            <Card style={{ gap: 6 }}>
              <T.Title>{u.order?.customer?.name ?? "—"}</T.Title>
              <T.Sub>{[u.merk, u.ukuran].filter(Boolean).join(" ") || "Detail kasur belum dicatat"}{u.order?.orderNumber ? ` · ${u.order.orderNumber}` : ""}</T.Sub>
              {pembetulan ? <Chip label="Unit sudah terkirim — pembetulan bahan" tone="orange" /> : null}
            </Card>

            {selesai ? (
              <Card style={{ flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: TONE.green.tint }}>
                <Letup kunci={selesai}><CheckCircle2 color={TONE.green.text} size={22} /></Letup>
                <T.Sub style={{ flex: 1, color: TONE.green.text }}>{selesai}</T.Sub>
              </Card>
            ) : null}

            {menunggu.length ? (
              <Section title="Sudah diajukan (menunggu Admin)">
                <Card padded={false}>
                  {menunggu.flatMap((p) => (p.ringkasan?.baris ?? []).map((b, i) => ({ key: `${p.id}-${i}`, b, p }))).map((x, i) => (
                    <View key={x.key}>
                      {i > 0 ? <Divider /> : null}
                      <View style={{ padding: 14, gap: 2 }}>
                        <T.Headline numberOfLines={1}>{x.b.bahan ?? "Bahan"}</T.Headline>
                        <T.Sub>{x.b.qty} {String(x.b.satuanInput ?? x.b.satuanStok ?? "").toLowerCase()} · diajukan {x.p.pengaju ?? "—"}</T.Sub>
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {a.data?.pemakaianAktual?.total?.length ? (
              <Section title="Sudah tercatat">
                <Card padded={false}>
                  {a.data.pemakaianAktual.total.map((t, i) => (
                    <View key={t.materialId}>
                      {i > 0 ? <Divider /> : null}
                      <View style={{ padding: 14, flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
                        <T.Headline numberOfLines={1} style={{ flex: 1 }}>{t.nama ?? t.kode}</T.Headline>
                        <T.Sub>{t.dipakai} {String(t.satuan ?? "").toLowerCase()}</T.Sub>
                      </View>
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {!boleh ? (
              <StateView kind="empty" title="Hanya bisa melihat" text="Akun ini belum punya izin mencatat bahan. Minta Admin memeriksa peran di Pengguna & Peran." />
            ) : (
              <Section title="Tambah bahan">
                <View style={{ gap: 12 }}>
                  {isi.bahan ? (
                    <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <T.Headline>{isi.bahan.nama}</T.Headline>
                        <T.Caption>{isi.bahan.kode}{isi.bahan.satuan ? ` · satuan stok ${isi.bahan.satuan.toLowerCase()}` : ""}</T.Caption>
                      </View>
                      <Button kind="tinted" label="Ganti" onPress={() => { set({ bahan: null, satuan: null }); setPra(null); }} style={{ minHeight: 44 }} />
                    </Card>
                  ) : pilihTerbuka ? (
                    <PemilihBahan cari={cari} setCari={setCari} rows={katalog.data?.rows ?? []} memuat={katalog.isLoading} galat={katalog.error ? pesanUntukPengguna(katalog.error) : null}
                      onPilih={(r) => { haptic.tick(); set({ bahan: { materialId: r.materialId, nama: r.nama, kode: r.kode, satuan: r.satuan, satuanPakai: r.satuanPakai }, satuan: r.satuanPakai?.satuanPakai ?? null }); }} />
                  ) : (
                    <Button kind="tinted" label="Tambah bahan lain" onPress={() => { setSelesai(null); setPilihTerbuka(true); }} />
                  )}

                  {isi.bahan ? (
                    <>
                      <Isian label="Jumlah dipakai" value={isi.qty} onChange={(v) => set({ qty: v })} keyboardType="decimal-pad" placeholder="mis. 2 atau 1,5" suffix={(satuanKirim(isi) ?? isi.bahan.satuan ?? "").toLowerCase()} />
                      {isi.bahan.satuanPakai ? (
                        <View style={{ gap: 6 }}>
                          <T.Caption style={{ marginLeft: 4 }}>Satuan · 1 {isi.bahan.satuanPakai.satuanStok.toLowerCase()} = {isi.bahan.satuanPakai.faktor} {isi.bahan.satuanPakai.satuanPakai.toLowerCase()}</T.Caption>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {[isi.bahan.satuanPakai.satuanPakai, isi.bahan.satuanPakai.satuanStok].map((s) => (
                              <Pressable key={s} accessibilityRole="radio" accessibilityState={{ selected: satuanKirim(isi) === s }} onPress={() => set({ satuan: s })}
                                style={{ minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: "center", backgroundColor: satuanKirim(isi) === s ? TONE.blue.text : C.card }}>
                                <Text style={{ fontFamily: F.bold, fontSize: 15, color: satuanKirim(isi) === s ? C.white : C.ink }}>{s.toLowerCase()}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      ) : null}
                      {pembetulan ? (
                        <>
                          <Isian label="Alasan pembetulan (wajib)" value={isi.alasan} onChange={(v) => set({ alasan: v })} multiline placeholder="mis. Bahan dipakai saat pengerjaan tetapi belum dicatat" />
                          <View style={{ gap: 6 }}>
                            <Isian label="Tanggal bahan dipakai" value={isi.tanggal} onChange={(v) => set({ tanggal: v })} placeholder="TTTT-BB-HH" />
                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <Button kind="tinted" label="Hari ini" onPress={() => set({ tanggal: hariIniWib() })} style={{ minHeight: 40, flex: 1 }} />
                              <Button kind="tinted" label="Kemarin" onPress={() => set({ tanggal: kemarinWib() })} style={{ minHeight: 40, flex: 1 }} />
                            </View>
                          </View>
                        </>
                      ) : (
                        <Isian label="Catatan (opsional)" value={isi.catatan} onChange={(v) => set({ catatan: v })} placeholder="mis. untuk lapisan atas" />
                      )}

                      {pembetulan && pra && sidikPra === sidik(isi) ? <Dampak pra={pra} periksa={periksa} setPeriksa={setPeriksa} /> : null}
                      {galat ? <T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub> : null}
                      {pembetulan && !(pra && sidikPra === sidik(isi))
                        ? <Button label="Lihat dampak dulu" busy={busy} onPress={() => void lihatDampak()} />
                        : <Button label="Catat bahan" busy={busy} disabled={pembetulan && !bolehKonfirmasi(pra, sidik(isi), sidikPra, periksa)} onPress={() => void catat()} />}
                      <T.Caption style={{ textAlign: "center" }}>Catatanmu menjadi pengajuan; stok & HPP berubah sesudah diverifikasi Admin.</T.Caption>
                    </>
                  ) : null}
                </View>
              </Section>
            )}
            <Button kind="plain" label="Selesai" onPress={() => router.back()} />
          </>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function PemilihBahan({ cari, setCari, rows, memuat, galat, onPilih }: { cari: string; setCari: (v: string) => void; rows: BahanKatalogQc[]; memuat: boolean; galat: string | null; onPilih: (r: BahanKatalogQc) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 52, paddingHorizontal: 16, borderRadius: 26, backgroundColor: C.isian, borderWidth: 1, borderColor: G.stroke }}>
        <Search size={20} color={C.ink3} />
        <TextInput accessibilityLabel="Cari bahan" value={cari} onChangeText={setCari} placeholder="Cari bahan (nama atau kode)" placeholderTextColor={C.ink3} style={{ flex: 1, fontFamily: F.medium, fontSize: 16, color: C.ink }} />
      </View>
      {galat ? <T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub> : null}
      {memuat ? <T.Caption>Memuat katalog…</T.Caption> : null}
      <Card padded={false}>
        {rows.slice(0, 25).map((r, i) => (
          <View key={r.materialId}>
            {i > 0 ? <Divider /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`Pilih ${r.nama}`} onPress={() => onPilih(r)} style={{ padding: 14, minHeight: 60, gap: 2 }}>
              <T.Headline numberOfLines={1}>{r.nama}</T.Headline>
              <T.Caption numberOfLines={1}>{[r.kode, r.kelompok?.label, r.saldoDiketahui ? `tersedia ${r.tersedia ?? 0} ${String(r.satuan ?? "").toLowerCase()}` : "stok belum diketahui"].filter(Boolean).join(" · ")}</T.Caption>
            </Pressable>
          </View>
        ))}
        {!memuat && !rows.length ? <View style={{ padding: 16 }}><T.Sub>Bahan tidak ditemukan. Bahan baru diusulkan lewat SANSS Web.</T.Sub></View> : null}
      </Card>
    </View>
  );
}

/** Ringkasan pratinjau server (tidak menghitung angka sendiri) + konfirmasi bukan-ganda bila diminta server. */
function Dampak({ pra, periksa, setPeriksa }: { pra: Pratinjau; periksa: boolean; setPeriksa: (v: boolean) => void }) {
  const koma = (n: number | null | undefined) => (n == null ? "belum diketahui" : String(Math.round(n * 10000) / 10000).replace(".", ","));
  const kemungkinan = [...(pra.sudahTercatat?.tertaut ?? []), ...(pra.sudahTercatat?.kemungkinan ?? [])];
  return (
    <Card style={{ gap: 8 }}>
      <T.Headline>Dampak</T.Headline>
      <T.Sub>{pra.tindakan?.judul}. {pra.waktu?.teks}</T.Sub>
      {pra.stok ? <T.Sub>Stok: {koma(pra.stok.saldoSebelum)} → {koma(pra.stok.saldoSesudah)} {pra.bahan?.satuan?.toLowerCase()}</T.Sub> : null}
      <T.Sub>Pemakaian di unit: {koma(pra.pemakaianBersih?.sebelum)} → {koma(pra.pemakaianBersih?.sesudah)} {pra.bahan?.satuan?.toLowerCase()}</T.Sub>
      {/* HPP (nominal rupiah) sengaja TIDAK ditampilkan ke tim QC & Dokumentasi — server tetap memakainya untuk validasi (hppSidik). */}
      {(pra.peringatan ?? []).map((p) => <T.Sub key={p.kode} style={{ color: TONE.orange.text }}>{p.pesan}</T.Sub>)}
      {(pra.penghalang ?? []).map((p) => <T.Sub key={p.kode} style={{ color: TONE.red.text }}>{p.pesan}</T.Sub>)}
      {pra.pengecualianStok?.perlu ? <T.Sub style={{ color: TONE.red.text }}>Stok tidak cukup. Pengecualian hanya untuk Admin/Owner/Kepala Produksi — minta mereka mencatat lewat SANSS Web.</T.Sub> : null}
      {kemungkinan.length ? (
        <View style={{ gap: 6 }}>
          <T.Caption>Mungkin sudah tercatat — periksa dulu:</T.Caption>
          {kemungkinan.slice(0, 5).map((k, i) => <T.Sub key={i}>• {("catatan" in k && k.catatan) || k.kind}</T.Sub>)}
          {pra.sudahTercatat?.perluKonfirmasi ? <CentangBaris label="Saya sudah memeriksa. Ini pemakaian BARU, bukan yang sudah tercatat." value={periksa} onChange={setPeriksa} /> : null}
        </View>
      ) : null}
    </Card>
  );
}
