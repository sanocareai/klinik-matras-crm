import { denganAkses } from "@/features/guard/RequireCapability";
import { DetailTxScreen } from "@/features/transaksi/DetailTx";

export default denganAkses(DetailTxScreen, "financeRead");
