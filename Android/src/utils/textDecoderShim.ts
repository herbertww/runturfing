/**
 * Hermes ships a TextDecoder that only knows utf-8. h3-js is an emscripten
 * build whose glue code reads strings out of the heap with
 * `new TextDecoder('utf-16le')`, so importing it threw
 *
 *   RangeError: Unknown encoding: utf-16le
 *
 * at module scope — which killed the app on launch before anything rendered.
 *
 * This wraps the built-in decoder and handles the utf-16 encodings itself,
 * delegating everything else. Imported for its side effect, and it must run
 * before any module that pulls in h3-js.
 */

const UTF16_LABELS = new Set(['utf-16le', 'utf-16', 'utf16le', 'ucs-2', 'ucs2']);

function decodeUtf16LE(input: ArrayBufferView | ArrayBuffer): string {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  // Build in chunks: String.fromCharCode with a huge spread blows the stack,
  // and these buffers can be long.
  let out = '';
  const CHUNK = 4096;
  const units = new Array<number>(Math.min(CHUNK, bytes.length >> 1));

  for (let start = 0; start < bytes.length - 1; start += CHUNK * 2) {
    const end = Math.min(start + CHUNK * 2, bytes.length - 1);
    let n = 0;
    for (let i = start; i < end; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8);
      // emscripten terminates strings with a NUL rather than passing a length.
      if (code === 0) {
        out += String.fromCharCode(...units.slice(0, n));
        return out;
      }
      units[n++] = code;
    }
    out += String.fromCharCode(...units.slice(0, n));
  }
  return out;
}

const Native = (globalThis as any).TextDecoder;

class PatchedTextDecoder {
  readonly encoding: string;
  private native: any = null;

  constructor(label: string = 'utf-8', options?: any) {
    this.encoding = String(label).toLowerCase();
    if (!UTF16_LABELS.has(this.encoding) && Native) {
      this.native = new Native(label, options);
    }
  }

  decode(input?: ArrayBufferView | ArrayBuffer): string {
    if (input == null) return '';
    if (UTF16_LABELS.has(this.encoding)) return decodeUtf16LE(input);
    if (this.native) return this.native.decode(input);
    // No native decoder at all: fall back to latin1, which is wrong for
    // multi-byte utf-8 but better than throwing.
    const bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return String.fromCharCode(...bytes);
  }
}

let needsPatch = !Native;
if (Native) {
  try {
    new Native('utf-16le');
  } catch {
    needsPatch = true;
  }
}

if (needsPatch) {
  (globalThis as any).TextDecoder = PatchedTextDecoder;
}

export const textDecoderPatched = needsPatch;
