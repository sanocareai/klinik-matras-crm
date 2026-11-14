import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Image } from "expo-image";
import { Check, ChevronLeft, ChevronRight, Plus, Search, Send, Trash2, X } from "lucide-react-native";
import { catatLangkah, cariBahan } from "@/api/aksi";
import { kirimDiagnosa, useDiagnosa, useDraftDiagnosa } from "@/api/diagnosa";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import {
  BAGIAN, KESIMPULAN_MIN, KOMPONEN, MAKS_BAHAN_MANUAL, MAKS_LAPISAN, PAYLOAD_TUTUP_TAHAP5, TINDAKAN_FONDASI, TINDAKAN_LAPISAN, TINGKAT_KERUSAKAN,
  bagianLengkap, benihServer, bodyDiagnosa, bomTanpaJumlah, lapisanKosong, validasiDiagnosa, type DraftDiagnosa, type KunciBagian, type Lapisan, type Temuan,
} from "@/features/diagnosa";
import { bolehCobaLagi } from "@/features/langkah";
import { PanelLampiran, useLampiran } from "@/features/Lampiran";
import { beratPemakai, kodePendek } from "@/features/model";
import { Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, F, TONE } from "@/design/tokens";
import { urlMedia } from "@/lib/env";

// DIAGNOSA (tahap 5) — wizard 6 bagian, cermin DiagnosisWizard web. Kirim = POST diagnosis/:runId/submit (menulis rencana
// bahan/Planned BOM), lalu tahap 5 ditutup (POST steps/5). Bila penutupan gagal, diagnosis tetap tersimpan → tombol "Tutup tahap".
// Draf di memori aplikasi per unit (pindah bagian / keluar layar tidak menghapus isian selama aplikasi tetap terbuka).
export default function Diagnosa() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const diag = useDiagnosa(runId);
  const lamp = useLampiran(runId);
  const simpanDraf = useDraftDiagnosa((s) => s.simpan);
  const hapusDraf = useDraftDiagnosa((s) => s.hapus);
  const drafLama = useDraftDiagnosa((s) => (runId ? s.draf[runId] : undefined));
  const [ubahan, setUbahan] = useState<DraftDiagnosa | null>(drafLama ?? null);
  const [bagian, setBagian] = useState<KunciBagian>("sales");
  const [busy, setBusy] = useState<"kirim" | "tutup" | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [tersimpan, setTersimpan] = useState(false); // diagnosis diterima server, tahap 5 belum tertutup
  const kunci = useRef(`pm-diag-${randomUUID()}`);

  // Isian = draf memori (bila ada) ATAU benih dari diagnosis server (revisi) — dihitung, bukan disalin di effect.
  const d: DraftDiagnosa | null = ubahan ?? (diag.data ? benihServer(diag.data.current) : null);
  const ubah = (fn: (x: DraftDiagnosa) => DraftDiagnosa) => {
    if (!d) return;
    const baru = fn(d);
    setUbahan(baru); setGalat(null); kunci.current = `pm-diag-${randomUUID()}`;
  };
  useEffect(() => { if (runId && ubahan) simpanDraf(runId, ubahan); }, [runId, ubahan, simpanDraf]);
  const setTemuan = (fn: (t: Temuan) => Temuan) => ubah((x) => ({ ...x, temuan: fn(x.temuan) }));

  const c = card.data;
  const sudahRecorded = diag.data?.current?.status === "RECORDED";
  const idx = BAGIAN.findIndex((b) => b.key === bagian);

  const tutupTahap = async () => {
    if (!c) return;
    setBusy("tutup"); setGalat(null);
    try {
      // Revisi kartu diambil SEGAR (kiriman diagnosis bisa saja mengubahnya); kunci per revisi → aman diulang.
      const k = (await card.refetch()).data ?? c;
      await catatLangkah({ runId: k.runId, revision: k.revision, workCenterId: k.workCenterId }, 5, { ...PAYLOAD_TUTUP_TAHAP5 }, [], `pm-5-tutup-${k.runId}-${k.revision}`);
      if (runId) hapusDraf(runId);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      setGalat(`Diagnosis tersimpan, tetapi tahap belum tertutup: ${pesanUntukPengguna(e)}`);
      void card.refetch();
    } finally { setBusy(null); }
  };

  const kirim = async () => {
    if (!c || !d) return;
    if (lamp.sibuk) { setGalat("Tunggu unggahan selesai."); return; }
    if (lamp.adaGagal) { setGalat("Ada unggahan gagal — ulangi atau hapus dulu."); return; }
    const v = validasiDiagnosa(d, lamp.selesai.length);
    if (v) { setBagian(v.bagian); setGalat(v.pesan); return; }
    setBusy("kirim"); setGalat(null);
    try {
      await kirimDiagnosa(c.runId, bodyDiagnosa(d, { revision: diag.data?.current?.revision ?? 0, workCenterId: c.workCenterId }, lamp.selesai.map((m) => m.url)), kunci.current);
      setTersimpan(true);
      if (runId) hapusDraf(runId);
      setBusy(null);
      await tutupTahap();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-diag-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "DIAGNOSIS_REVISION_CONFLICT") void diag.refetch();
      setBusy(null);
    }
  };

  const pemakai = beratPemakai(c?.customer);
  const tanpaJumlah = d ? bomTanpaJumlah(d) : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Screen lembar header={<NavBar judul={c ? `Diagnosa · ${kodePendek(c.unit.unitCode)}` : "Diagnosa"} kembali="Tutup" />} bottomPad={150}>
        {card.isLoading || diag.isLoading ? <StateView kind="loading" title="Memuat diagnosis…" /> : null}
        {diag.error ? <StateView kind="error" title="Diagnosis tidak bisa dimuat" text={pesanUntukPengguna(diag.error)} onRetry={() => void diag.refetch()} /> : null}

        {c && d ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {BAGIAN.map((b, i) => {
                const on = b.key === bagian;
                const ok = bagianLengkap(b.key, d, lamp.selesai.length);
                return (
                  <Pressable key={b.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setBagian(b.key)}
                    style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 20, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: on ? TONE.blue.fill : C.card }}>
                    {ok && b.key !== "sales" ? <Check color={on ? "#fff" : TONE.green.text} size={14} strokeWidth={3} /> : null}
                    <Text style={{ fontFamily: F.semibold, fontSize: 13.5, color: on ? "#fff" : C.ink }}>{i + 1}. {b.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {sudahRecorded && !ubahan ? (
              <Card style={{ backgroundColor: TONE.blue.tint, gap: 8 }}>
                <T.Sub style={{ color: TONE.blue.text }}>Diagnosis unit ini sudah pernah dikirim. Ubah isiannya untuk mengirim revisi, atau langsung tutup tahap Diagnosa.</T.Sub>
                <Button kind="tinted" label="Tutup tahap Diagnosa saja" onPress={() => void tutupTahap()} busy={busy === "tutup"} disabled={!online || !!busy} />
              </Card>
            ) : null}

            {bagian === "sales" ? (
              <Card style={{ gap: 8 }}>
                <T.Caption>Data Sales — hanya untuk referensi, tidak bisa diubah di sini.</T.Caption>
                <Baris k="Layanan dipesan" v={c.customer.salesServices?.length ? c.customer.salesServices.join(" + ") : "Belum dicatat"} />
                <Baris k="Berat pemakai" v={pemakai.length ? pemakai.map((p) => `${p.label} ${p.kg} kg`).join(" · ") : "Belum dicatat"} />
                <Baris k="Keluhan customer" v={c.customer.complaints?.length ? c.customer.complaints.join(", ") : "Belum dicatat"} />
                {c.customer.request ? <Baris k="Permintaan customer" v={c.customer.request} /> : null}
              </Card>
            ) : null}

            {bagian === "bongkar" ? (
              <>
                <Isian label="Kondisi kasur *" value={d.temuan.general.condition} onChange={(v) => setTemuan((t) => ({ ...t, general: { ...t.general, condition: v } }))} multiline placeholder="Kondisi kasur secara umum" />
                <Isian label="Kerusakan utama *" value={d.temuan.general.mainDamage} onChange={(v) => setTemuan((t) => ({ ...t, general: { ...t.general, mainDamage: v } }))} multiline placeholder="Kerusakan paling signifikan" />
                <PilihanChip label="Tingkat kerusakan *" options={TINGKAT_KERUSAKAN} value={d.temuan.general.damageLevel ? [d.temuan.general.damageLevel as "RINGAN"] : []} onChange={(v) => setTemuan((t) => ({ ...t, general: { ...t.general, damageLevel: v[0] ?? "" } }))} />
                <Isian label="Catatan hasil bongkar" value={d.temuan.general.teardownNote} onChange={(v) => setTemuan((t) => ({ ...t, general: { ...t.general, teardownNote: v } }))} multiline />
                {d.fotoServer.length ? (
                  <View style={{ gap: 6 }}>
                    <T.Sub style={{ marginHorizontal: 4 }}>Foto/video diagnosis sebelumnya</T.Sub>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {d.fotoServer.map((ft) => (
                        <View key={ft.url}>
                          <Image source={{ uri: urlMedia(ft.previewUrl) ?? undefined }} style={{ width: 84, height: 84, borderRadius: 12, backgroundColor: C.fill }} contentFit="cover" />
                          <Pressable accessibilityRole="button" accessibilityLabel="Hapus foto" onPress={() => ubah((x) => ({ ...x, fotoServer: x.fotoServer.filter((f) => f.url !== ft.url) }))}
                            style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" }}>
                            <X color="#fff" size={15} />
                          </Pressable>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
                <PanelLampiran l={lamp} aturan={{ min: d.fotoServer.length ? 0 : 1, video: false }} disabled={!!busy} />
              </>
            ) : null}

            {bagian === "fondasi" ? (
              <>
                <Isian label="Kondisi fondasi lama" value={d.temuan.foundation.oldCondition} onChange={(v) => setTemuan((t) => ({ ...t, foundation: { ...t.foundation, oldCondition: v } }))} multiline />
                <PilihanChip label="Tindakan *" options={TINDAKAN_FONDASI} value={d.temuan.foundation.action ? [d.temuan.foundation.action as "KEEP"] : []} onChange={(v) => setTemuan((t) => ({ ...t, foundation: { ...t.foundation, action: v[0] ?? "" } }))} />
                {d.temuan.foundation.action === "REPLACE" ? (
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 2 }}><Isian label="Ukuran" value={d.temuan.foundation.size} onChange={(v) => setTemuan((t) => ({ ...t, foundation: { ...t.foundation, size: v } }))} placeholder="180x200 cm" /></View>
                    <View style={{ flex: 1 }}><Isian label="Jumlah" value={d.temuan.foundation.qty} onChange={(v) => setTemuan((t) => ({ ...t, foundation: { ...t.foundation, qty: v } }))} keyboardType="decimal-pad" /></View>
                  </View>
                ) : null}
                <Isian label="Catatan" value={d.temuan.foundation.note} onChange={(v) => setTemuan((t) => ({ ...t, foundation: { ...t.foundation, note: v } }))} multiline />
              </>
            ) : null}

            {bagian === "lapisan" ? (
              <>
                {d.temuan.layers.map((l, i) => (
                  <BarisLapisan key={i} i={i} l={l}
                    ubah={(p) => setTemuan((t) => ({ ...t, layers: t.layers.map((x, xi) => (xi === i ? { ...x, ...p } : x)) }))}
                    hapus={() => setTemuan((t) => ({ ...t, layers: t.layers.filter((_, xi) => xi !== i) }))} />
                ))}
                {d.temuan.layers.length < MAKS_LAPISAN ? (
                  <Button kind="tinted" icon={<Plus color={TONE.blue.text} size={18} />} label="Tambah lapisan" onPress={() => setTemuan((t) => ({ ...t, layers: [...t.layers, lapisanKosong()] }))} />
                ) : null}
                <T.Headline style={{ marginHorizontal: 4, marginTop: 6 }}>Komponen lain</T.Headline>
                {KOMPONEN.map((k) => (
                  <Isian key={k.key} label={k.label} value={d.temuan.components[k.key]} onChange={(v) => setTemuan((t) => ({ ...t, components: { ...t.components, [k.key]: v } }))} />
                ))}
              </>
            ) : null}

            {bagian === "bahan" ? <BagianBahan d={d} ubah={ubah} /> : null}

            {bagian === "review" ? (
              <>
                <Isian label={`Kesimpulan diagnosis * (minimal ${KESIMPULAN_MIN} huruf)`} value={d.temuan.serviceNote} onChange={(v) => setTemuan((t) => ({ ...t, serviceNote: v }))} multiline
                  placeholder="mis. Fondasi diganti karena keropos, lapisan atas diperkuat sesuai keluhan sakit pinggang" />
                <Card style={{ gap: 4 }}>
                  <T.Headline>Ringkasan</T.Headline>
                  <T.Sub>{d.bom.length} bahan katalog · {d.manual.length} bahan manual{d.manual.length ? " (dipetakan Production Lead)" : ""} · {d.fotoServer.length + lamp.selesai.length} foto/video</T.Sub>
                  {tanpaJumlah.length ? <T.Sub style={{ color: TONE.orange.text }}>Tanpa jumlah (tidak masuk rencana bahan): {tanpaJumlah.join(", ")}</T.Sub> : null}
                  <T.Caption>Rute pengerjaan mengikuti pemetaan Layanan Sales yang diatur Admin — tidak dipilih di sini.</T.Caption>
                </Card>
              </>
            ) : null}

            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
            {ubahan ? <T.Caption style={{ textAlign: "center" }}>Isian tersimpan di aplikasi ini sampai dikirim (hilang bila aplikasi ditutup penuh). Foto/video baru perlu diambil ulang bila layar ini ditutup sebelum dikirim.</T.Caption> : null}
          </>
        ) : null}
      </Screen>

      {c && d ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — kirim saat sinyal kembali.</T.Caption> : null}
          {tersimpan ? (
            <Button kind="success" label="Tutup tahap Diagnosa" onPress={() => void tutupTahap()} busy={busy === "tutup"} disabled={!online || !!busy} />
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              {idx > 0 ? <Button kind="tinted" icon={<ChevronLeft color={TONE.blue.text} size={20} />} label="Kembali" onPress={() => setBagian(BAGIAN[idx - 1]!.key)} style={{ flex: 1 }} /> : null}
              {idx < BAGIAN.length - 1 ? (
                <Button label="Lanjut" icon={<ChevronRight color="#fff" size={20} />} onPress={() => setBagian(BAGIAN[idx + 1]!.key)} style={{ flex: 2 }} />
              ) : (
                <Button kind="success" icon={<Send color="#fff" size={20} />} label={sudahRecorded ? "Kirim Revisi Diagnosis" : "Kirim Diagnosis"} onPress={() => void kirim()} busy={busy === "kirim"} disabled={!online || !!busy || lamp.sibuk} style={{ flex: 2 }} />
              )}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function Baris({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ backgroundColor: C.fill, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
      <T.Caption>{k}</T.Caption>
      <Text style={{ fontFamily: F.semibold, fontSize: 15, color: C.ink }}>{v}</Text>
    </View>
  );
}

function BarisLapisan({ i, l, ubah, hapus }: { i: number; l: Lapisan; ubah: (p: Partial<Lapisan>) => void; hapus: () => void }) {
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <T.Headline>Lapisan #{i + 1}</T.Headline>
        <Pressable accessibilityRole="button" accessibilityLabel={`Hapus lapisan ${i + 1}`} onPress={hapus} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
          <Trash2 color={TONE.red.text} size={20} />
        </Pressable>
      </View>
      <Isian label="Kondisi lama" value={l.oldCondition} onChange={(v) => ubah({ oldCondition: v })} />
      <PilihanChip label="Tindakan" options={TINDAKAN_LAPISAN} value={l.action ? [l.action as "KEEP"] : []} onChange={(v) => ubah({ action: v[0] ?? "" })} />
      {l.action === "REPLACE" ? (
        <>
          <Isian label="Material" value={l.material} onChange={(v) => ubah({ material: v })} placeholder="mis. Latex" />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Isian label="Tebal" value={l.thickness} onChange={(v) => ubah({ thickness: v })} placeholder="3 cm" /></View>
            <View style={{ flex: 1 }}><Isian label="Density" value={l.density} onChange={(v) => ubah({ density: v })} placeholder="D23" /></View>
            <View style={{ flex: 1 }}><Isian label="Jumlah" value={l.qty} onChange={(v) => ubah({ qty: v })} keyboardType="decimal-pad" /></View>
          </View>
        </>
      ) : null}
      <Isian label="Catatan" value={l.note} onChange={(v) => ubah({ note: v })} />
    </Card>
  );
}

function BagianBahan({ d, ubah }: { d: DraftDiagnosa; ubah: (fn: (x: DraftDiagnosa) => DraftDiagnosa) => void }) {
  const [cari, setCari] = useState("");
  const q = cari.trim();
  const hasil = useQuery({ queryKey: ["bahan", q], queryFn: () => cariBahan(q), enabled: q.length >= 2, staleTime: 60_000 });
  const daftar = useMemo(() => (hasil.data?.items ?? []).filter((m) => !d.bom.some((l) => l.materialId === m.id)), [hasil.data, d.bom]);
  return (
    <>
      <T.Headline style={{ marginHorizontal: 4 }}>Bahan dari katalog</T.Headline>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 12, paddingHorizontal: 12, height: 46 }}>
        <Search color={C.ink3} size={18} />
        <TextInput accessibilityLabel="Cari bahan katalog" value={cari} onChangeText={setCari} placeholder="Cari kode/nama bahan (min. 2 huruf)" placeholderTextColor={C.ink3}
          style={{ flex: 1, fontFamily: F.regular, fontSize: 16, color: C.ink }} />
      </View>
      {q.length >= 2 && hasil.isLoading ? <T.Caption>Mencari…</T.Caption> : null}
      {daftar.length ? (
        <Card padded={false}>
          {daftar.slice(0, 12).map((m) => (
            <Pressable key={m.id} accessibilityRole="button" onPress={() => { ubah((x) => ({ ...x, bom: [...x.bom, { materialId: m.id, code: m.code, name: m.name, unit: m.unit, onHandQty: m.onHandQty, qty: "" }] })); setCari(""); }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 52 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T.Headline numberOfLines={1}>{m.name}</T.Headline>
                <T.Caption>{m.code} · stok {m.onHandQty ?? 0} {m.unit ?? ""}</T.Caption>
              </View>
              <Plus color={TONE.blue.text} size={20} />
            </Pressable>
          ))}
        </Card>
      ) : null}
      {d.bom.map((l) => (
        <View key={l.materialId} style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.isian, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T.Headline numberOfLines={1}>{l.name}</T.Headline>
            <T.Caption>{l.code}{l.onHandQty != null ? ` · stok ${l.onHandQty}` : ""} {l.unit ?? ""}</T.Caption>
          </View>
          <TextInput accessibilityLabel={`Jumlah ${l.name}`} value={l.qty} onChangeText={(t) => ubah((x) => ({ ...x, bom: x.bom.map((b) => (b.materialId === l.materialId ? { ...b, qty: t } : b)) }))}
            keyboardType="decimal-pad" placeholder="Qty" placeholderTextColor={C.ink3}
            style={{ width: 70, height: 46, borderRadius: 12, backgroundColor: C.fill, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink }} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${l.name}`} onPress={() => ubah((x) => ({ ...x, bom: x.bom.filter((b) => b.materialId !== l.materialId) }))}
            style={{ minHeight: 44, minWidth: 40, alignItems: "center", justifyContent: "center" }}>
            <X color={TONE.red.text} size={20} />
          </Pressable>
        </View>
      ))}

      <T.Headline style={{ marginHorizontal: 4, marginTop: 8 }}>Bahan belum terdaftar (manual)</T.Headline>
      <T.Caption style={{ marginHorizontal: 4 }}>Tidak memotong/mereservasi stok — Production Lead memetakannya ke katalog nanti.</T.Caption>
      {d.manual.map((m, i) => {
        const set = (p: Partial<typeof m>) => ubah((x) => ({ ...x, manual: x.manual.map((y, yi) => (yi === i ? { ...y, ...p } : y)) }));
        return (
          <Card key={i} style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T.Headline>Bahan manual #{i + 1}</T.Headline>
              <Pressable accessibilityRole="button" accessibilityLabel={`Hapus bahan manual ${i + 1}`} onPress={() => ubah((x) => ({ ...x, manual: x.manual.filter((_, yi) => yi !== i) }))}
                style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
                <Trash2 color={TONE.red.text} size={20} />
              </Pressable>
            </View>
            <Isian label="Nama/deskripsi bahan" value={m.description} onChange={(v) => set({ description: v })} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}><Isian label="Satuan" value={m.estimatedUnit} onChange={(v) => set({ estimatedUnit: v })} placeholder="meter" /></View>
              <View style={{ flex: 1 }}><Isian label="Jumlah" value={m.qty} onChange={(v) => set({ qty: v })} keyboardType="decimal-pad" /></View>
            </View>
            <Isian label="Kenapa tidak ada di katalog?" value={m.reason} onChange={(v) => set({ reason: v })} multiline />
          </Card>
        );
      })}
      {d.manual.length < MAKS_BAHAN_MANUAL ? (
        <Button kind="tinted" icon={<Plus color={TONE.blue.text} size={18} />} label="Tambah bahan manual"
          onPress={() => ubah((x) => ({ ...x, manual: [...x.manual, { description: "", estimatedUnit: "", qty: "", reason: "" }] }))} />
      ) : null}
    </>
  );
}
