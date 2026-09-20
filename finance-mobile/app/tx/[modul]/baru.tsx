import { denganAkses } from "@/features/guard/RequireCapability";
import { FormTxScreen } from "@/features/transaksi/FormTx";

// Mencatat butuh FINANCE_POST (pengeluaran/pembelian juga boleh untuk pemegang izin mengajukan). Izin per modul diperiksa lagi di dalam formulir.
export default denganAkses(FormTxScreen, ["financePost", "expenseSubmit"], "any");
