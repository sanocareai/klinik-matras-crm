import React, { useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Plus, Save, Trash2 } from "lucide-react-native";
import { simpanKomponen, useKomponen } from "@/api/komponen";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import {
  BAGIAN_HP, BAGIAN_KOMPONEN, KESESUAIAN_KELUHAN, KONDISI, MAKS_LAPISAN, SISTEM_FONDASI, TINDAKAN,
  barisSebelumKosong, barisSesudahKosong, drafDari, drafDariRencana, maksMedia, mediaKomponen, minMedia, payloadKomponen, penurunanFondasi, perbedaanDariRencana,
  ringkasLapisan, validasiKomponen, type Draf, type KunciBagian,
} from "@/features/komponen";
import { bolehCobaLagi } from "@/features/langkah";
import { LampiranKomponen, PemilihBahan } from "@/features/KomponenUI";
import { beratPemakai, teksBerat } from "@/features/model";
import { CentangBaris, Isian, PilihanChip } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, StateView, Screen, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// CATATAN KOMPONEN — satu bagian per layar (?bagian=…&runId=…). Versi baru setiap simpan (yang lama tetap ada); koreksi wajib beralasan.
// Meja: lapisan/fondasi sebelum bongkar & hasil aktual. PIC QC: QC sebelum bongkar, uji fondasi awal/baru, uji kasur jadi.
// Informasi saja: tidak memotong stok dan bukan BOM. Bila kartu menunggu catatan ini, tahap berikutnya terbuka setelah tersimpan.
export default function Komponen() {
  const { unitId, bagian: bagianParam, runId } = useLocalSearchParams<{ unitId: string; bagian: string; runId?: string }>();
  const bagian = (BAGIAN_HP as string[]).includes(bagianParam ?? "") ? (bagianParam as KunciBagian) : null;
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const q = useKomponen(unitId);
  const card = useRunCard(runId);
  const entri = bagian ? q.data?.sections?.[bagian] ?? null : null;
  const rencana = q.data?.sections?.PLAN_RACIKAN ?? null;
  const [ubahan, setUbahan] = useState<Draf | null>(null);
  const d: Draf | null = ubahan ?? (bagian && q.data ? drafDari(bagian, entri) : null);
  const [busy, setBusy] = useState(false);
  const [unggah, setUnggah] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-komp-${randomUUID()}`);
  const set = (p: Partial<Draf>) => { if (!d) return; setUbahan({ ...d, ...p }); setGalat(null); kunci.current = `pm-komp-${randomUUID()}`; };
  const koreksi = !!entri;
  const meta = bagian ? BAGIAN_KOMPONEN[bagian] : null;
  const bolehTulis = meta?.qc ? !!q.data?.canWriteQc : !!q.data?.canWrite;
  const pemakai = beratPemakai(card.data?.customer);
  const beda = useMemo(() => (bagian === "AFTER" && d ? perbedaanDariRencana(d, rencana) : []), [bagian, d, rencana]);

  const simpan = async () => {
    if (!d || !bagian || !unitId) return;
    if (unggah) { setGalat("Tunggu unggahan selesai."); return; }
    const v = validasiKomponen(bagian, d, { koreksi, rencana });
    if (v) { setGalat(v); return; }
    setBusy(true); setGalat(null);
    try {
      await simpanKomponen(unitId, bagian, { expectedVersion: entri?.version ?? 0, data: payloadKomponen(bagian, d), media: mediaKomponen(d), reason: koreksi ? d.reason.trim() : undefined }, kunci.current);
      await qc.invalidateQueries();
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-komp-${randomUUID()}`;
      setGalat(e instanceof ApiError && e.code === "COMPONENT_VERSION_CONFLICT" ? "Catatan ini sudah diubah orang lain — dimuat ulang. Periksa lalu simpan lagi." : pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "COMPONENT_VERSION_CONFLICT") { setUbahan(null); void q.refetch(); }
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen header={<NavBar judul={meta?.label ?? "Catatan Komponen"} kembali="Batal" />} bottomPad={140}>
        {!bagian ? <StateView kind="empty" title="Bagian ini diisi lewat SANSS Web" /> : null}
        {q.isLoading ? <StateView kind="loading" title="Memuat catatan…" /> : null}
        {q.error ? <StateView kind="error" title="Catatan tidak bisa dimuat" text={pesanUntukPengguna(q.error)} onRetry={() => void q.refetch()} /> : null}
        {q.data?.readerMode === "OFF" ? <StateView kind="empty" title="Produksi V2 belum aktif" /> : null}

        {bagian && d && q.data?.readerMode !== "OFF" ? (
          <>
            <Card style={{ gap: 4, backgroundColor: TONE.blue.tint }}>
              <T.Sub style={{ color: TONE.blue.text }}>
                {q.data?.unitCode ?? ""}{koreksi ? ` · koreksi versi ${entri!.version}${entri!.actor?.name ? ` (${entri!.actor.name})` : ""}` : " · belum dicatat"}
              </T.Sub>
              <T.Caption style={{ color: TONE.blue.text }}>Informasi komponen — tidak memotong stok dan bukan rencana bahan.</T.Caption>
            </Card>
            {!bolehTulis ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>{meta?.qc ? "Bagian pengujian hanya bisa diisi PIC QC." : "Akun ini tidak bisa menulis catatan komponen unit ini."}</T.Sub></Card> : null}

            {bagian === "LAYERS_BEFORE" ? (
              <>
                <CentangBaris label="Lapisan tidak diketahui" value={d.layersUnknown} onChange={(v) => set({ layersUnknown: v })} />
                {!d.layersUnknown ? (
                  <>
                    <T.Caption style={{ marginHorizontal: 4 }}>Urutan dari ATAS ke BAWAH.</T.Caption>
                    {d.layersBefore.map((l, i) => {
                      const ubahBaris = (p: Partial<typeof l>) => set({ layersBefore: d.layersBefore.map((x) => (x.id === l.id ? { ...x, ...p } : x)) });
                      return (
                        <Card key={l.id} style={{ gap: 10 }}>
                          <JudulBaris teks={`Lapisan ${i + 1}`} hapus={() => set({ layersBefore: d.layersBefore.filter((x) => x.id !== l.id) })} />
                          <PemilihBahan value={l.material} onChange={(m) => ubahBaris({ material: m })} />
                          <PilihanChip label="Kondisi" options={KONDISI} value={l.condition ? [l.condition as "BAIK"] : []} onChange={(v) => ubahBaris({ condition: v[0] ?? "" })} />
                          <Isian label="Ketebalan (opsional)" value={l.thickness} onChange={(v) => ubahBaris({ thickness: v })} keyboardType="decimal-pad" suffix="cm" />
                          <Isian label="Catatan (opsional)" value={l.note} onChange={(v) => ubahBaris({ note: v })} />
                        </Card>
                      );
                    })}
                    {d.layersBefore.length < MAKS_LAPISAN ? <Button kind="tinted" icon={<Plus color={TONE.blue.text} size={18} />} label="Tambah lapisan" onPress={() => set({ layersBefore: [...d.layersBefore, barisSebelumKosong()] })} /> : null}
                    <T.Caption style={{ marginHorizontal: 4 }}>{ringkasLapisan(d)}</T.Caption>
                  </>
                ) : null}
              </>
            ) : null}

            {bagian === "FOUNDATION_BEFORE" ? (
              <>
                <PilihanChip label="Jenis/sistem fondasi" options={SISTEM_FONDASI} value={d.system ? [d.system as "BONNELL"] : []} onChange={(v) => set({ system: v[0] ?? "" })} />
                <PemilihBahan label="Bahan fondasi" opsional value={d.material} onChange={(m) => set({ material: m })} />
                <PilihanChip label="Kondisi" options={KONDISI} value={d.condition ? [d.condition as "BAIK"] : []} onChange={(v) => set({ condition: v[0] ?? "" })} />
              </>
            ) : null}

            {bagian === "FOUNDATION_TEST_BEFORE" || bagian === "FOUNDATION_TEST_AFTER" ? (
              <>
                <PilihanChip label="Jenis/sistem fondasi" options={SISTEM_FONDASI} value={d.system ? [d.system as "BONNELL"] : []} onChange={(v) => set({ system: v[0] ?? "" })} />
                <PemilihBahan label="Bahan fondasi" opsional value={d.material} onChange={(m) => set({ material: m })} />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}><Isian label="Tanpa beban" value={d.unloadedHeight} onChange={(v) => set({ unloadedHeight: v })} keyboardType="decimal-pad" suffix="cm" /></View>
                  <View style={{ flex: 1 }}><Isian label="Dibebani" value={d.loadedHeight} onChange={(v) => set({ loadedHeight: v })} keyboardType="decimal-pad" suffix="cm" /></View>
                </View>
                {penurunanFondasi(d) != null ? <T.Sub style={{ marginHorizontal: 4 }}>Penurunan: {penurunanFondasi(d)} cm (dihitung ulang server)</T.Sub> : null}
                <UjiUmum d={d} set={set} pemakai={pemakai.length ? teksBerat(pemakai) : null} sesudah={bagian === "FOUNDATION_TEST_AFTER"} />
              </>
            ) : null}

            {bagian === "WHOLE_TEST_BEFORE" || bagian === "WHOLE_TEST_AFTER" ? (
              <>
                {card.data?.customer.complaints?.length ? <Card><T.Sub>Keluhan customer: {card.data.customer.complaints.join(", ")}</T.Sub></Card> : null}
                <PilihanChip label="Kesesuaian dengan keluhan" options={KESESUAIAN_KELUHAN} value={d.complaintMatch ? [d.complaintMatch as "SESUAI"] : []} onChange={(v) => set({ complaintMatch: v[0] ?? "" })} />
                <Isian label="Catatan keluhan (opsional)" value={d.complaintNote} onChange={(v) => set({ complaintNote: v })} multiline />
                <Isian label="Feel saat diuji" value={d.feelNote} onChange={(v) => set({ feelNote: v })} multiline placeholder="mis. tengah amblas, pinggir keras" />
                <Isian label="Penurunan kasur utuh" value={d.wholeDrop} onChange={(v) => set({ wholeDrop: v })} keyboardType="decimal-pad" suffix="cm" />
                <UjiUmum d={d} set={set} pemakai={pemakai.length ? teksBerat(pemakai) : null} sesudah={bagian === "WHOLE_TEST_AFTER"} />
                <CentangBaris label="Foto/video memperlihatkan PIC QC sedang menguji" value={d.qcInFrame} onChange={(v) => set({ qcInFrame: v })} />
              </>
            ) : null}

            {bagian === "AFTER" ? (
              <>
                {rencana ? <Button kind="tinted" label="Isi dari racikan rencana" onPress={() => set(drafDariRencana(rencana, d))} /> : null}
                <CentangBaris label="Catat fondasi" value={d.foundationOn} onChange={(v) => set({ foundationOn: v })} />
                {d.foundationOn ? (
                  <Card style={{ gap: 10 }}>
                    <T.Headline>Fondasi</T.Headline>
                    <PilihanChip label="Tindakan" options={TINDAKAN} value={d.foundation.action ? [d.foundation.action as "KEEP"] : []} onChange={(v) => set({ foundation: { ...d.foundation, action: v[0] ?? "" } })} />
                    {d.foundation.action === "REPLACE" ? <PilihanChip label="Jenis fondasi baru" options={SISTEM_FONDASI} value={d.foundation.system ? [d.foundation.system as "BONNELL"] : []} onChange={(v) => set({ foundation: { ...d.foundation, system: v[0] ?? "" } })} /> : null}
                    <PemilihBahan label="Bahan fondasi" opsional value={d.foundation.material} onChange={(m) => set({ foundation: { ...d.foundation, material: m } })} />
                  </Card>
                ) : null}
                <T.Caption style={{ marginHorizontal: 4 }}>Lapisan hasil akhir, dari ATAS ke BAWAH.</T.Caption>
                {d.layersAfter.map((l, i) => {
                  const ubahBaris = (p: Partial<typeof l>) => set({ layersAfter: d.layersAfter.map((x) => (x.id === l.id ? { ...x, ...p } : x)) });
                  return (
                    <Card key={l.id} style={{ gap: 10 }}>
                      <JudulBaris teks={`Lapisan ${i + 1}`} hapus={() => set({ layersAfter: d.layersAfter.filter((x) => x.id !== l.id) })} />
                      <PilihanChip label="Tindakan" options={TINDAKAN} value={l.action ? [l.action as "KEEP"] : []} onChange={(v) => ubahBaris({ action: v[0] ?? "" })} />
                      <PemilihBahan opsional={l.action === "KEEP"} value={l.material} onChange={(m) => ubahBaris({ material: m })} />
                      <Isian label="Ketebalan (opsional)" value={l.thickness} onChange={(v) => ubahBaris({ thickness: v })} keyboardType="decimal-pad" suffix="cm" />
                    </Card>
                  );
                })}
                {d.layersAfter.length < MAKS_LAPISAN ? <Button kind="tinted" icon={<Plus color={TONE.blue.text} size={18} />} label="Tambah lapisan" onPress={() => set({ layersAfter: [...d.layersAfter, barisSesudahKosong()] })} /> : null}
                {beda.length ? (
                  <Card style={{ backgroundColor: TONE.orange.tint, gap: 8 }}>
                    <T.Sub style={{ color: TONE.orange.text }}>Berbeda dari racikan rencana: {beda.join(", ")}.</T.Sub>
                    <Isian label="Alasan perbedaan (wajib)" value={d.deviationNote} onChange={(v) => set({ deviationNote: v })} multiline />
                  </Card>
                ) : null}
              </>
            ) : null}

            <LampiranKomponen unitId={unitId} items={d.media} onChange={(m) => set({ media: m })} min={minMedia(bagian)} maks={maksMedia(bagian)} disabled={busy} onSibuk={setUnggah} />
            <Isian label="Catatan (opsional)" value={d.note} onChange={(v) => set({ note: v })} multiline />
            {koreksi ? <Isian label="Alasan koreksi *" value={d.reason} onChange={(v) => set({ reason: v })} multiline placeholder="Kenapa catatan ini diubah?" /> : null}
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {bagian && d ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — simpan saat sinyal kembali.</T.Caption> : null}
          <Button kind="success" icon={<Save color="#fff" size={20} />} label={unggah ? "Menunggu unggahan…" : koreksi ? "Simpan koreksi" : "Simpan catatan"} onPress={() => void simpan()} busy={busy} disabled={!online || unggah || !bolehTulis} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** Isian bersama pengujian: berat penguji AKTUAL (tidak diisi otomatis — berat order hanya ditampilkan), metode, konfirmasi sebanding (uji setelah perbaikan). */
function UjiUmum({ d, set, pemakai, sesudah }: { d: Draf; set: (p: Partial<Draf>) => void; pemakai: string | null; sesudah: boolean }) {
  return (
    <>
      <Isian label="Berat penguji aktual" value={d.testerWeight} onChange={(v) => set({ testerWeight: v })} keyboardType="decimal-pad" suffix="kg" />
      {pemakai ? <T.Caption style={{ marginHorizontal: 4 }}>Acuan berat pemakai dari order: {pemakai}. Isi berat orang yang BENAR-BENAR menguji.</T.Caption> : null}
      <Isian label="Titik/metode pengujian" value={d.testMethod} onChange={(v) => set({ testMethod: v })} placeholder="mis. duduk di tengah, diukur dari lantai" />
      {sesudah ? <CentangBaris label="Metode & titik sama dengan uji awal (sebanding)" value={d.sameMethod} onChange={(v) => set({ sameMethod: v })} /> : null}
    </>
  );
}

function JudulBaris({ teks, hapus }: { teks: string; hapus: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <T.Headline>{teks}</T.Headline>
      <Pressable accessibilityRole="button" accessibilityLabel={`Hapus ${teks}`} onPress={hapus} style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}>
        <Trash2 color={TONE.red.text} size={20} />
      </Pressable>
    </View>
  );
}
