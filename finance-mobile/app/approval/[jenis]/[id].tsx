import { Redirect, useLocalSearchParams } from "expo-router";

// Tautan push: sanofinance://approval/{jenis}/{id} → detail persetujuan.
export default function TautanApproval() {
  const { id } = useLocalSearchParams<{ jenis: string; id: string }>();
  return <Redirect href={`/persetujuan/${id}`} />;
}
