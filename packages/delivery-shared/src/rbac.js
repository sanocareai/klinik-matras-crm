// Akses aplikasi Delivery Control. SUMBER KEBENARAN peran->izin tetap SERVER
// (backend/src/services/capabilities.js); klien hanya membaca objek capabilities
// dari /auth/me dan TIDAK PERNAH menebak dari nama role (aturan repo: tidak ada
// peta role->izin ganda di klien).

export class AccessDeniedError extends Error {
  constructor(message = "Akun ini tidak punya akses ke Sano Delivery Control") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export function canUseControlApp(capabilities) {
  return capabilities?.deliveryControlApp === true;
}

export function assertControlAccess(capabilities) {
  if (!canUseControlApp(capabilities)) throw new AccessDeniedError();
  return capabilities;
}

// Izin biaya armada dipisah tegas: mengajukan, memverifikasi bukti, menyetujui,
// dan membayar adalah empat kemampuan berbeda (bisa dimiliki orang berbeda).
export function deliveryExpenseAbilities(capabilities) {
  const e = capabilities?.deliveryExpense || {};
  return {
    submit: e.submit === true,
    verify: e.verify === true,
    approve: e.approve === true,
    pay: e.pay === true,
  };
}
