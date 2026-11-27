// GIF89a application extension: NETSCAPE2.0, loop count zero (infinite).
const infiniteLoop = Uint8Array.from([0x21,0xff,0x0b,78,69,84,83,67,65,80,69,50,46,48,3,1,0,0,0]);
const invalid = () => new Error("GIFのデータが破損しています。");

function requireBytes(bytes: Uint8Array, offset: number, count: number): void {
  if (offset < 0 || count < 0 || offset + count > bytes.length) throw invalid();
}
function subblocksEnd(bytes: Uint8Array, offset: number): number {
  for (;;) {
    requireBytes(bytes, offset, 1);
    const length = bytes[offset++];
    if (!length) return offset;
    requireBytes(bytes, offset, length);
    offset += length;
  }
}

/**
 * Normalize only the container's loop metadata. Do not alter LZW data, delays,
 * disposal methods, color tables or transparency. Do not use byte-pattern
 * search inside compressed image data.
 */
export function forceInfiniteGifLoop(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  requireBytes(bytes, 0, 13);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (signature !== "GIF87a" && signature !== "GIF89a") throw invalid();
  const tableSize = (flags: number) => flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0;
  const headerEnd = 13 + tableSize(bytes[10]);
  requireBytes(bytes, 0, headerEnd);
  const result = new Uint8Array(bytes.length + infiniteLoop.length);
  result.set(bytes.subarray(0, headerEnd));
  result.set([71,73,70,56,57,97], 0); // GIF89a: application extensions are supported.
  result.set(infiniteLoop, headerEnd);
  let cursor = headerEnd;
  let written = headerEnd + infiniteLoop.length;
  let frames = 0;

  while (cursor < bytes.length) {
    const start = cursor;
    const tag = bytes[cursor++];
    let remove = false;
    if (tag === 0x3b) {
      if (!frames) throw invalid();
      result[written++] = tag;
      return result.slice(0, written);
    }
    if (tag === 0x21) {
      requireBytes(bytes, cursor, 2);
      const label = bytes[cursor++];
      const first = cursor;
      const size = bytes[first];
      requireBytes(bytes, first + 1, size);
      const end = subblocksEnd(bytes, first);
      if (label === 0xff && size === 11) {
        const identifier = String.fromCharCode(...bytes.subarray(first + 1, first + 12));
        const second = first + 12;
        // FFmpeg 5.1's GIF demuxer recognizes this loop subblock even
        // for some unrecognized application identifiers. Prevent overrides.
        const loopPayload = second + 4 <= end && bytes[second] === 3 && bytes[second + 1] === 1;
        remove = identifier === "NETSCAPE2.0" || identifier === "ANIMEXTS1.0" || loopPayload;
      }
      cursor = end;
    } else if (tag === 0x2c) {
      requireBytes(bytes, cursor, 9);
      cursor += 9 + tableSize(bytes[cursor + 8]);
      requireBytes(bytes, cursor, 1); // LZW minimum code size
      cursor = subblocksEnd(bytes, cursor + 1);
      frames++;
    } else {
      throw invalid();
    }
    if (!remove) {
      result.set(bytes.subarray(start, cursor), written);
      written += cursor - start;
    }
  }
  throw invalid(); // no trailer
}
