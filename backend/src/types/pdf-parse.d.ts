declare module "pdf-parse" {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    info?: unknown;
    metadata?: unknown;
    version?: string;
  }

  function pdfParse(
    buffer: Buffer,
    options?: unknown
  ): Promise<PdfParseResult>;

  export default pdfParse;
}
