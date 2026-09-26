// Galat domain Pengajuan Biaya — dipisah dari service.js supaya guard.js/access.js bisa memakainya tanpa impor melingkar.
export class SubmissionError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "SubmissionError";
    this.statusCode = statusCode;
  }
}
