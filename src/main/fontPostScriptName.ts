import { readSfntTableBuffer } from "./customFontInspection";

// Photoshop requires OpenType name ID 6, not an app ID or CSS family name.
export function readFontPostScriptName(buffer: Buffer): string | null {
  const table = readSfntTableBuffer(buffer, "name");
  if (!table || table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const strings = table.readUInt16BE(4);
  if (strings < 6 + count * 12 || strings > table.length) return null;
  const candidates: Array<{ name: string; priority: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const record = 6 + i * 12;
    if (table.readUInt16BE(record + 6) !== 6) continue;
    const candidate = readNameRecord(table, record, strings);
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort((a, b) => a.priority - b.priority)[0]?.name ?? null;
}

function readNameRecord(table: Buffer, record: number, strings: number) {
  const platform = table.readUInt16BE(record);
  const encoding = table.readUInt16BE(record + 2);
  const language = table.readUInt16BE(record + 4);
  const length = table.readUInt16BE(record + 8);
  const start = strings + table.readUInt16BE(record + 10);
  if (start + length > table.length) return null;
  const name = decodeName(
    table.subarray(start, start + length),
    platform,
    encoding,
  );
  if (!name || !/^[!-~]{1,63}$/.test(name) || /[[\](){}<>/%]/.test(name))
    return null;
  const priority =
    platform === 3 && language === 0x409 ? 0 : platform === 0 ? 1 : 2;
  return { name, priority };
}

function decodeName(
  bytes: Buffer,
  platform: number,
  encoding: number,
): string | null {
  const unicode =
    platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
  if (unicode)
    return bytes.length % 2 === 0
      ? Buffer.from(bytes).swap16().toString("utf16le")
      : null;
  return platform === 1 && encoding === 0 ? bytes.toString("latin1") : null;
}
