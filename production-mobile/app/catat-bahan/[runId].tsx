import React, { useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetInfo } from "@react-native-community/netinfo";
import { randomUUID } from "expo-crypto";
import { Save } from "lucide-react-native";
import { catatRacikanBahan, usePengajuanTertunda } from "@/api/picBahan";
import { ApiError, pesanUntukPengguna } from "@/api/errors";
import { useRunCard } from "@/api/production";
import { alurCatat, barisDari, bodyCatatBahan, formCatatAwal, pengaturanBahan, validasiCatatBahan, type FormCatatBahan } from "@/features/picBahan";
import { bolehCobaLagi } from "@/features/langkah";
import { BahanDipakai } from "@/features/Bahan";
import { Isian } from "@/design/Form";
import { NavBar } from "@/design/NavBar";
import { Button, Card, Screen, StateView, T } from "@/design/ui";
import { C, TONE } from "@/design/tokens";

// CATAT RACIKAN & BAHAN — PIC Bahan per pekerjaan (cermin MaterialRecordSheet web). POST /production-v2/runs/:runId/build/materials.
// Jalur Pengerjaan Pesanan: racikan fondasi/lapisan (kasur) + bahan Gudang yang dipakai. LAYANAN: hanya bahan dipakai (racikan = Catatan Komponen).
// Bahan HANYA dari yang diserahkan Gudang; mencatat tidak mengeluarkan stok. Non-ADMIN → PENGAJUAN (menunggu verifikasi ADMIN).
// Versi terbaru = keadaan sekarang: isian dibuka dari catatan terakhir (atau dari pengajuan yang masih menunggu), koreksi = kirim ulang lengkap.
type Baris = { materialId: string; qty: string };

export default function CatatBahan() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const net = useNetInfo();
  const online = net.isConnected !== false && net.isInternetReachable !== false;
  const card = useRunCard(runId);
  const tertunda = usePengajuanTertunda(runId);
  const c = card.data;
  const alur = c ? alurCatat(c) : "RESTORATION";
  const rec = c ? pengaturanBahan(c)?.record : null;

  // Isian awal: catatan terakhir; bila ada pengajuan yang masih menunggu, baris bahan dibuka dari pengajuan itu.
  const awal = useMemo<{ form: FormCatatBahan; bahan: Baris[] } | null>(() => {
    if (!c || tertunda.isLoading) return null;
    const form = formCatatAwal(c);
    const dariPengajuan = (tertunda.data?.ringkasan?.baris ?? []).filter((b) => b.materialId).map((b) => ({ materialId: b.materialId!, qty: String(b.qty) }));
    const bahan = dariPengajuan.length ? dariPengajuan : (rec?.materials ?? []).map((m) => ({ materialId: m.materialId, qty: String(m.qty) }));
    return { form, bahan };
  }, [c, rec, tertunda.isLoading, tertunda.data]);
  const [ubahan, setUbahan] = useState<{ form: FormCatatBahan; bahan: Baris[] } | null>(null);
  const isi = ubahan ?? awal;
  const [busy, setBusy] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const kunci = useRef(`pm-bahan-${randomUUID()}`);
  const set = (p: Partial<{ form: FormCatatBahan; bahan: Baris[] }>) => {
    if (!isi) return;
    setUbahan({ ...isi, ...p }); setGalat(null); kunci.current = `pm-bahan-${randomUUID()}`;
  };
  const setForm = (p: Partial<FormCatatBahan>) => isi && set({ form: { ...isi.form, ...p } });
  const judul = c?.track === "BUILD" ? "Catat Racikan & Bahan" : "Catat Bahan Dipakai";

  const simpan = async () => {
    if (!c || !isi) return;
    const form: FormCatatBahan = { ...isi.form, rows: barisDari(isi.bahan) };
    const v = validasiCatatBahan(form, alur, c.issuedMaterials ?? []);
    if (v) { setGalat(v); return; }
    setBusy(true); setGalat(null);
    try {
      const r = await catatRacikanBahan(c.runId, bodyCatatBahan(form, alur, c.revision), kunci.current);
      await qc.invalidateQueries();
      const build = c.track === "BUILD";
      Alert.alert(r?.menungguVerifikasi ? "Dilaporkan" : "Tersimpan", r?.menungguVerifikasi
        ? `${build ? "Racikan tersimpan. " : ""}Pemakaian bahan dilaporkan — menunggu verifikasi ADMIN (stok & HPP belum berubah). Pekerjaan tetap bisa dilanjutkan.`
        : r?.changed === false ? "Tidak ada perubahan." : `${build ? "Racikan & bahan" : "Bahan dipakai"} tersimpan${r?.version ? ` (versi ${r.version})` : ""}.`);
      router.back();
    } catch (e) {
      if (!bolehCobaLagi(e)) kunci.current = `pm-bahan-${randomUUID()}`;
      setGalat(pesanUntukPengguna(e));
      if (e instanceof ApiError && e.code === "STEP_REVISION_CONFLICT") { setUbahan(null); void card.refetch(); }
    } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen lembar header={<NavBar judul={judul} kembali="Batal" />} bottomPad={140}>
        {card.isLoading ? <StateView kind="loading" title="Memuat…" /> : null}
        {card.error ? <StateView kind="error" title="Kartu tidak bisa dimuat" text={pesanUntukPengguna(card.error)} onRetry={() => void card.refetch()} /> : null}

        {c && isi ? (
          <>
            <Card style={{ backgroundColor: TONE.blue.tint, gap: 4 }}>
              <T.Sub style={{ color: TONE.blue.text }}>{c.unit.unitCode}{rec?.version ? ` · versi ${rec.version}` : " · belum dicatat"}</T.Sub>
              <T.Caption style={{ color: TONE.blue.text }}>Catat racikan dan bahan yang benar-benar dipakai. Bahan hanya dari yang sudah diserahkan Gudang. Mencatat di sini tidak mengeluarkan stok — sisa bahan otomatis menjadi retur saat produksi selesai.</T.Caption>
            </Card>
            {alur === "RESTORATION" ? <Card><T.Sub>Racikan fondasi/lapisan ditentukan PIC Meja/PIC QC di Catatan Komponen (Racikan rencana). Di sini cukup catat bahan yang benar-benar dipakai.</T.Sub></Card> : null}
            {alur === "UNCONFIRMED" ? <Card style={{ backgroundColor: TONE.orange.tint }}><T.Sub style={{ color: TONE.orange.text }}>Jenis produk belum jelas pada order — racikan kasur ditahan sampai Sales mengonfirmasi. Pemakaian bahan tetap bisa dicatat.</T.Sub></Card> : null}
            {alur === "NON_KASUR" ? <Card><T.Sub>Produk non-kasur (divan/sofa): tidak ada racikan kasur — catat bahan yang dipakai.</T.Sub></Card> : null}
            {alur === "KASUR" ? (
              <>
                <T.Headline style={{ marginHorizontal: 4 }}>Racikan kasur (fondasi & lapisan)</T.Headline>
                <Isian label="Racikan fondasi" value={isi.form.racikanFondasi} onChange={(v) => setForm({ racikanFondasi: v })} placeholder="mis. pocket spring 25 cm + penguat pinggir" />
                <Isian label="Racikan lapisan" value={isi.form.racikanLapisan} onChange={(v) => setForm({ racikanLapisan: v })} placeholder="mis. latex 3 cm + busa D23 2 cm" />
              </>
            ) : null}
            <T.Headline style={{ marginHorizontal: 4 }}>Bahan dari Gudang yang dipakai</T.Headline>
            <BahanDipakai diserahkan={c.issuedMaterials ?? []} value={isi.bahan} onChange={(v) => set({ bahan: v })} kosong="Belum ada bahan yang diserahkan Gudang untuk unit ini." />
            <Isian label="Catatan (opsional)" value={isi.form.note} onChange={(v) => setForm({ note: v })} multiline />
            {tertunda.data ? (
              <Card style={{ backgroundColor: TONE.orange.tint }}>
                <T.Sub style={{ color: TONE.orange.text }}>Pemakaian terakhir yang dilaporkan masih menunggu verifikasi ADMIN — isian dibuka dari laporan itu. Mengirim lagi menggantikan laporan tersebut (tidak dihitung dua kali).</T.Sub>
              </Card>
            ) : null}
            {galat ? <Card style={{ backgroundColor: TONE.red.tint }}><T.Sub style={{ color: TONE.red.text }}>{galat}</T.Sub></Card> : null}
          </>
        ) : null}
      </Screen>

      {c && isi ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, backgroundColor: C.barBg, borderTopWidth: 1, borderTopColor: C.barLine, gap: 6 }}>
          {!online ? <T.Caption style={{ textAlign: "center" }}>Offline — simpan saat sinyal kembali.</T.Caption> : null}
          <Button kind="success" icon={<Save color="#fff" size={20} />} label={c.track === "BUILD" ? "Simpan Racikan & Bahan" : "Simpan Bahan Dipakai"} onPress={() => void simpan()} busy={busy} disabled={!online} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
