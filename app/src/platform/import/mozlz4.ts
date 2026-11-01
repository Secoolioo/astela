const magic = 'mozLz40\0';

/**
 * Decodes a file in Firefox's `mozLz4` format, such as `sessionstore.jsonlz4`: a magic
 * number, the size of the content as a 32-bit little-endian number, and one LZ4 block.
 * @param data - The file's bytes.
 * @returns The content as UTF-8 text.
 * @throws When the data is not `mozLz4` or the block is damaged.
 */
export function decodeMozLz4(data: Uint8Array): string {
  if (data.length < 12 || new TextDecoder().decode(data.subarray(0, 8)) !== magic) {
    throw new Error('Not a mozLz4 file');
  }
  const size =
    (data[8] ?? 0) | ((data[9] ?? 0) << 8) | ((data[10] ?? 0) << 16) | ((data[11] ?? 0) << 24);
  if (size < 0 || size > 256 * 1024 * 1024) {
    throw new Error('Damaged mozLz4 file');
  }
  const output = new Uint8Array(size);
  let input = 12;
  let written = 0;
  const byte = (): number => {
    const value = data[input];
    if (value === undefined) throw new Error('Damaged mozLz4 file');
    input += 1;
    return value;
  };
  const length = (start: number): number => {
    let total = start;
    if (start === 15) {
      let next = 255;
      while (next === 255) {
        next = byte();
        total += next;
      }
    }
    return total;
  };
  while (input < data.length) {
    const token = byte();
    const literals = length(token >> 4);
    if (input + literals > data.length || written + literals > size) {
      throw new Error('Damaged mozLz4 file');
    }
    output.set(data.subarray(input, input + literals), written);
    input += literals;
    written += literals;
    // The last sequence of a block has literals only.
    if (input >= data.length) break;
    const offset = byte() | (byte() << 8);
    const match = length(token & 15) + 4;
    if (offset === 0 || offset > written || written + match > size) {
      throw new Error('Damaged mozLz4 file');
    }
    // A match may overlap the bytes it writes, so it is copied one byte at a time.
    for (let i = 0; i < match; i += 1) {
      output[written] = output[written - offset] ?? 0;
      written += 1;
    }
  }
  return new TextDecoder().decode(output.subarray(0, written));
}
