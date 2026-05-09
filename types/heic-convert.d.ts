declare module "heic-convert" {
  type ConvertOptions = {
    buffer: Buffer | Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  };
  const convert: (opts: ConvertOptions) => Promise<ArrayBuffer | Uint8Array>;
  export default convert;
}
