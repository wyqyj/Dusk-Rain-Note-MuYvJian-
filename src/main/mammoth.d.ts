declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<{ value: string; messages: unknown[] }>;
  export function convertToHtml(input: { buffer: Buffer } | { path: string }): Promise<{ value: string; messages: unknown[] }>;
}
