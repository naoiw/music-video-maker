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
export function prepareLoopingGif(bytes: Uint8Array): { bytes: Uint8Array<ArrayBuffer>; frameDelays: number[] } {
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
  const frameDelays: number[] = [];
  let delay = 10; // FFmpeg GIF demuxer default: 10 centiseconds.

  while (cursor < bytes.length) {
    const start = cursor;
    const tag = bytes[cursor++];
    let remove = false;
    if (tag === 0x3b) {
      if (!frameDelays.length) throw invalid();
      result[written++] = tag;
      return { bytes: result.slice(0, written), frameDelays };
    }
    if (tag === 0x21) {
      requireBytes(bytes, cursor, 2);
      const label = bytes[cursor++];
      const first = cursor;
      const size = bytes[first];
      requireBytes(bytes, first + 1, size);
      const end = subblocksEnd(bytes, first);
      if (label === 0xf9) {
        if (size !== 4 || end !== first + 6) throw invalid();
        const rawDelay = bytes[first + 2] | (bytes[first + 3] << 8);
        delay = rawDelay < 2 ? 10 : rawDelay; // Match min_delay=2 / default_delay=10.
      }
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
      frameDelays.push(delay);
      delay = 10;
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

/**
 * Rebuild timestamps from the source centisecond delays instead of relying on
 * FFmpeg 5.1's generated timestamps across GIF loop boundaries.
 * The frame index N remains monotonic across demuxer loops. Use a balanced
 * expression for unequal delays so evaluation depth is logarithmic.
 */
export function gifTimelineFilter(delays: readonly number[], convertFps = true, fps = 30): string {
  if (![24,30,60].includes(fps)) throw new Error("非対応のフレームレートです。");
  if (!delays.length || delays.some(d => !Number.isInteger(d) || d < 2 || d > 65535))
    throw new Error("GIFのフレーム表示時間が不正です。");
  let expression: string;
  if (delays.every(d => d === delays[0])) {
    expression = "N*" + delays[0];
  } else {
    // Bound expression size and parser work. Equal-delay GIFs use the compact
    // expression above, regardless of the number of source frames.
    if (delays.length > 4096) throw new Error("可変フレーム間隔のGIFは4096フレーム以下にしてください。");
    const starts = [0];
    for (const d of delays) starts.push(starts[starts.length - 1] + d);
    const count = delays.length;
    const index = "mod(N," + count + ")";
    function lookup(lo: number, hi: number): string {
      if (hi - lo === 1) return String(starts[lo]);
      const mid = Math.floor((lo + hi) / 2);
      return "if(lt(" + index + "," + mid + ")," + lookup(lo, mid) + "," + lookup(mid, hi) + ")";
    }
    expression = "floor(N/" + count + ")*" + starts[count] + "+" + lookup(0, count);
  }
  return "settb=1/100,setpts='" + expression + "'" + (convertFps ? ",fps=" + fps : "");
}
