// Minimal ambient declaration for the `qrcode` package.
//
// The project depends on `qrcode` (see package.json) but ships no bundled types
// and `@types/qrcode` is not installed. Only the small surface the restaurant
// Settings profile panel uses is declared here: `toDataURL`, which encodes a
// string into a scannable PNG data URL. The declaration is intentionally narrow
// so an accidental broader use surfaces as a type error rather than `any`.
declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    margin?: number;
    scale?: number;
    width?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: "low" | "medium" | "quartile" | "high" | "L" | "M" | "Q" | "H";
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;

  const QRCode: {
    toDataURL: typeof toDataURL;
  };
  export default QRCode;
}
