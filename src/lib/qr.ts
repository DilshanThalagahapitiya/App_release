import QRCode from "qrcode";

const QUIET = 4; // modules of white border required by the QR spec

function matrix(text: string): { size: number; get: (r: number, c: number) => boolean } {
  // Error correction M: good scan reliability on printed/low-res screens without bloating the symbol.
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { size: q.modules.size, get: (r, c) => !!q.modules.get(r, c) };
}

/** Pure-JS SVG renderer (works in Workers). High contrast: black on white with a 4-module quiet zone. */
export function qrSvg(text: string, scale = 8): string {
  const m = matrix(text);
  const dim = (m.size + QUIET * 2) * scale;
  let path = "";
  for (let r = 0; r < m.size; r++)
    for (let c = 0; c < m.size; c++)
      if (m.get(r, c)) path += `M${(c + QUIET) * scale} ${(r + QUIET) * scale}h${scale}v${scale}h-${scale}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const w = cs.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

/** Minimal 8-bit grayscale PNG encoder (no dependencies). */
export async function qrPng(text: string, scale = 10): Promise<Uint8Array> {
  const m = matrix(text);
  const dim = (m.size + QUIET * 2) * scale;
  const raw = new Uint8Array((dim + 1) * dim).fill(255);
  for (let y = 0; y < dim; y++) {
    raw[y * (dim + 1)] = 0; // filter: none
    const r = Math.floor(y / scale) - QUIET;
    for (let x = 0; x < dim; x++) {
      const c = Math.floor(x / scale) - QUIET;
      if (r >= 0 && c >= 0 && r < m.size && c < m.size && m.get(r, c)) raw[y * (dim + 1) + 1 + x] = 0;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, dim); dv.setUint32(4, dim);
  ihdr[8] = 8; ihdr[9] = 0; // bit depth 8, grayscale
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
