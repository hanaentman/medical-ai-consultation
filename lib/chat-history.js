const fs = require("fs/promises");
const { setImmediate: yieldToServer } = require("timers/promises");

const DAY_MS = 24 * 60 * 60 * 1000;
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const READ_BYTES = 64 * 1024;
const MAX_LINE_BYTES = 128 * 1024;

function parseDateRange(startDate = "", endDate = "") {
  function midnight(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new RangeError("조회 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.");
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new RangeError("올바른 조회 날짜를 입력해 주세요.");
    }
    return date.getTime() - KOREA_OFFSET_MS;
  }

  const start = startDate ? midnight(startDate) : -Infinity;
  const end = endDate ? midnight(endDate) + DAY_MS : Infinity;
  if (start >= end) {
    throw new RangeError("종료일은 시작일보다 빠를 수 없습니다.");
  }
  return { start, end };
}

// Read newest lines first without loading the entire growing log into memory.
async function* readLinesReverse(file) {
  let position = (await file.stat()).size;
  let pending = Buffer.alloc(0);
  let skippingOversizedLine = false;

  while (position > 0) {
    const length = Math.min(position, READ_BYTES);
    position -= length;
    const chunk = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await file.read(chunk, filled, length - filled, position + filled);
      if (!bytesRead) break;
      filled += bytesRead;
    }

    const data = Buffer.concat([chunk.subarray(0, filled), pending]);
    let lineEnd = data.length;
    let newline;
    while (lineEnd > 0 && (newline = data.lastIndexOf(10, lineEnd - 1)) !== -1) {
      if (!skippingOversizedLine && lineEnd - newline - 1 <= MAX_LINE_BYTES) {
        yield data.subarray(newline + 1, lineEnd).toString("utf8");
      }
      skippingOversizedLine = false;
      lineEnd = newline;
    }

    pending = data.subarray(0, lineEnd);
    if (pending.length > MAX_LINE_BYTES) {
      pending = Buffer.alloc(0);
      skippingOversizedLine = true;
    }
    await yieldToServer();
  }
  if (!skippingOversizedLine && pending.length) yield pending.toString("utf8");
}

async function readChatLogs(filePath, { limit = 200, query = "", start = -Infinity, end = Infinity } = {}) {
  let file;
  try {
    file = await fs.open(filePath, "r");
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], hasMore: false };
    throw error;
  }

  const needle = query.toLocaleLowerCase("ko");
  const records = [];
  try {
    for await (const line of readLinesReverse(file)) {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      if (start !== -Infinity || end !== Infinity) {
        const timestamp = Date.parse(record.timestamp);
        if (!Number.isFinite(timestamp) || timestamp < start || timestamp >= end) continue;
      }
      if (needle && !`${record.question || ""}\n${record.answer || ""}`.toLocaleLowerCase("ko").includes(needle)) {
        continue;
      }
      if (records.length === limit) return { records, hasMore: true };
      records.push(record);
    }
    return { records, hasMore: false };
  } finally {
    await file.close();
  }
}

module.exports = { parseDateRange, readChatLogs };
