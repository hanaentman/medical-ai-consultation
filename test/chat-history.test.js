const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { parseDateRange, readChatLogs } = require("../lib/chat-history");

async function logFile(t, text) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "medical-chat-dates-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "history.jsonl");
  await fs.writeFile(file, text, "utf8");
  return file;
}

function record(id, timestamp, question = "question", answer = "answer") {
  return { id, timestamp, question, answer };
}

const boundaryRecords = [
  record("previous-day", "2026-09-28T14:59:59.999Z"),
  record("start-midnight", "2026-09-28T15:00:00.000Z"),
  record("end-of-day", "2026-09-29T14:59:59.999Z"),
  record("next-day", "2026-09-29T15:00:00.000Z")
];
const jsonl = (records) => records.map((item) => JSON.stringify(item)).join("\n") + "\n";

test("date validation accepts a leap day and rejects invalid or reversed dates", () => {
  assert.doesNotThrow(() => parseDateRange("2028-02-29", "2028-02-29"));
  for (const invalid of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-9-1", "invalid"]) {
    assert.throws(() => parseDateRange(invalid, ""), RangeError);
    assert.throws(() => parseDateRange("", invalid), RangeError);
  }
  assert.throws(() => parseDateRange("2026-09-30", "2026-09-29"), RangeError);
});

test("same-day query includes both boundaries in Korea time", async (t) => {
  const file = await logFile(t, jsonl(boundaryRecords));
  const result = await readChatLogs(file, parseDateRange("2026-09-29", "2026-09-29"));
  assert.deepEqual(result.records.map((item) => item.id), ["end-of-day", "start-midnight"]);
  assert.equal(result.hasMore, false);
});

test("one-sided and empty date ranges remain usable", async (t) => {
  const file = await logFile(t, jsonl(boundaryRecords));
  const after = await readChatLogs(file, parseDateRange("2026-09-29", ""));
  const before = await readChatLogs(file, parseDateRange("", "2026-09-29"));
  const all = await readChatLogs(file, parseDateRange());
  assert.deepEqual(after.records.map((item) => item.id), ["next-day", "end-of-day", "start-midnight"]);
  assert.deepEqual(before.records.map((item) => item.id), ["end-of-day", "start-midnight", "previous-day"]);
  assert.equal(all.records.length, 4);
});

test("keyword and date conditions apply before limiting results", async (t) => {
  const file = await logFile(t, jsonl([
    record("old", "2026-09-27T12:00:00Z", "MATCH"),
    record("first", "2026-09-29T01:00:00Z", "MATCH"),
    record("second", "2026-09-29T02:00:00Z", "question", "match in answer"),
    record("different", "2026-09-29T03:00:00Z")
  ]));
  const options = { ...parseDateRange("2026-09-29", "2026-09-29"), query: "match", limit: 1 };
  const first = await readChatLogs(file, options);
  assert.deepEqual(first.records.map((item) => item.id), ["second"]);
  assert.equal(first.hasMore, true);
  const both = await readChatLogs(file, { ...options, limit: 2 });
  assert.deepEqual(both.records.map((item) => item.id), ["second", "first"]);
  assert.equal(both.hasMore, false);
  assert.deepEqual(await readChatLogs(file, { ...options, query: "absent" }), { records: [], hasMore: false });
});

test("old records remain searchable beyond the last 5 MB without modifying the file", async (t) => {
  const entries = [record("archive", "2026-05-11T03:00:00Z")];
  for (let i = 0; i < 180; i += 1) {
    entries.push(record(`recent-${i}`, "2026-09-29T03:00:00Z", "filler", "x".repeat(32000)));
  }
  const contents = jsonl(entries);
  const file = await logFile(t, contents);
  assert.ok((await fs.stat(file)).size > 5 * 1024 * 1024);
  const result = await readChatLogs(file, parseDateRange("2026-05-11", "2026-05-11"));
  assert.deepEqual(result.records.map((item) => item.id), ["archive"]);
  assert.equal(await fs.readFile(file, "utf8"), contents);
});

test("UTF-8 survives block boundaries and damaged lines do not hide valid records", async (t) => {
  const korean = "상담 기록 테스트 ".repeat(3000);
  const valid = record("korean", "2026-09-29T03:00:00Z", korean);
  const entries = [
    JSON.stringify(valid),
    "not JSON", "null", "[]", "x".repeat(256 * 1024),
    JSON.stringify(record("newer", "2026-09-29T04:00:00Z")),
    '{"unfinished":'
  ];
  const file = await logFile(t, entries.join("\r\n"));
  const result = await readChatLogs(file, parseDateRange("2026-09-29", "2026-09-29"));
  assert.deepEqual(result.records.map((item) => item.id), ["newer", "korean"]);
  assert.equal(result.records[1].question, korean);
});

test("empty or missing logs return an empty result", async (t) => {
  const file = await logFile(t, "");
  assert.deepEqual(await readChatLogs(file), { records: [], hasMore: false });
  assert.deepEqual(await readChatLogs(`${file}.missing`), { records: [], hasMore: false });
});
