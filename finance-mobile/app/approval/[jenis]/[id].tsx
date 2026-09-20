import { Redirect, useLocalSearchParams } from "expo-router";

// Tautan push: sanofinance://approval/{jenis}/{id} → detail persetujuan (setelah kunci aplikasi dibuka).
export default function TautanApproval() {
  const { jenis, id } = useLocalSearchParams<{ jenis: string; id: string }>();
  return <Redirect href={{ pathname: "/persetujuan/[jenis]/[id]", params: { jenis, id } }} />;
}
