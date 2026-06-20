// pdf-parse ships types for its main entry, but we import the inner module
// (pdf-parse/lib/pdf-parse.js) to dodge index.js's debug-mode file read under
// bundlers. Declare the subpath here.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfData {
    text: string;
    numpages: number;
    info?: unknown;
    metadata?: unknown;
  }
  function pdf(dataBuffer: Buffer | Uint8Array): Promise<PdfData>;
  export default pdf;
}
