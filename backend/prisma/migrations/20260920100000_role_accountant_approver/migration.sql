-- Finance Mobile S2: dua role baru (additive). Tidak ada pengguna yang diberi role ini otomatis.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'APPROVER';
