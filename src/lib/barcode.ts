// Parcel barcodes look like BK-1004-P1, or BK-802-R2-P1 for a repacked parcel (the number after R is the repack round).
const PARCEL_CODE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*-(?:R\d+-)?P\d+$/;

/** Cleans what a scanner or a person typed and returns the parcel barcode, or null when it is not one (spaces and case do not matter). */
export function parseParcelCode(raw: string): string | null {
  const code = raw.replace(/\s+/g, "").toUpperCase();
  return PARCEL_CODE.test(code) ? code : null;
}

/** The booking code inside a parcel barcode: BK-802-R2-P1 gives BK-802. */
export function bookingCodeOf(parcelCode: string): string {
  return parcelCode.replace(/-(?:R\d+-)?P\d+$/, "");
}
