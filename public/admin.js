const loginView = document.querySelector("#login-view");
const dashboardView = document.querySelector("#dashboard-view");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const startDateInput = document.querySelector("#start-date");
const endDateInput = document.querySelector("#end-date");
const resetDatesButton = document.querySelector("#reset-dates-button");
const limitSelect = document.querySelector("#limit-select");
const refreshButton = document.querySelector("#refresh-button");
const exportButton = document.querySelector("#export-button");
const logoutButton = document.querySelector("#logout-button");
const recordsBody = document.querySelector("#records-body");
const emptyState = document.querySelector("#empty-state");
const dashboardMessage = document.querySelector("#dashboard-message");
const recordCount = document.querySelector("#record-count");
const averageDuration = document.querySelector("#average-duration");
const latestRecord = document.querySelector("#latest-record");

let authorization = "";
let currentRecords = [];

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  const submitButton = loginForm.querySelector("button[type='submit']");
  submitButton.disabled = true;

  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  authorization = createBasicAuthorization(username, password);

  try {
    await loadRecords();
    loginView.hidden = true;
    dashboardView.hidden = false;
    searchInput.focus();
  } catch (error) {
    authorization = "";
    loginError.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadRecordsSafely();
});

refreshButton.addEventListener("click", loadRecordsSafely);
limitSelect.addEventListener("change", loadRecordsSafely);
exportButton.addEventListener("click", exportCsv);
startDateInput.addEventListener("input", () => endDateInput.setCustomValidity(""));
endDateInput.addEventListener("input", () => endDateInput.setCustomValidity(""));
resetDatesButton.addEventListener("click", async () => {
  startDateInput.value = "";
  endDateInput.value = "";
  endDateInput.setCustomValidity("");
  await loadRecordsSafely();
});

logoutButton.addEventListener("click", () => {
  authorization = "";
  currentRecords = [];
  searchForm.reset();
  endDateInput.setCustomValidity("");
  recordsBody.replaceChildren();
  dashboardView.hidden = true;
  loginView.hidden = false;
  document.querySelector("#password").value = "";
  document.querySelector("#password").focus();
});

async function loadRecordsSafely() {
  const reversed = startDateInput.value && endDateInput.value && startDateInput.value > endDateInput.value;
  endDateInput.setCustomValidity(reversed ? "종료일은 시작일보다 빠를 수 없습니다." : "");
  if (!searchForm.reportValidity()) return;
  try {
    await loadRecords();
  } catch (error) {
    dashboardMessage.textContent = error.message;
  }
}

async function loadRecords() {
  setLoading(true);

  try {
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;
    const params = new URLSearchParams({
      limit: limitSelect.value,
      query: searchInput.value.trim(),
      startDate,
      endDate
    });
    const response = await fetch(`/api/admin/chats?${params}`, {
      headers: { Authorization: authorization },
      cache: "no-store"
    });
    const data = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(data.error || "상담 기록을 불러오지 못했습니다.");
    }

    currentRecords = Array.isArray(data.records) ? data.records : [];
    renderRecords(currentRecords);
    const period = startDate || endDate
      ? `${startDate || "처음"} ~ ${endDate || "현재"} (한국시간)`
      : "전체 기간";
    dashboardMessage.textContent = data.hasMore
      ? `${period} · 최신 ${currentRecords.length}건 표시 · 추가 기록 있음`
      : `${period} · ${currentRecords.length}건`;
  } finally {
    setLoading(false);
  }
}

function renderRecords(records) {
  recordsBody.replaceChildren();
  emptyState.hidden = records.length > 0;
  emptyState.textContent = "조회 조건에 맞는 상담 기록이 없습니다.";

  for (const record of records) {
    const row = document.createElement("tr");
    row.append(
      createCell(formatDate(record.timestamp), "date-cell"),
      createCell(shortSessionId(record.sessionId), "session-cell"),
      createExpandableCell(record.question, "질문 보기"),
      createExpandableCell(record.answer, "답변 보기"),
      createSourcesCell(record.sources),
      createCell(formatDuration(record.durationMs), "duration-cell")
    );
    recordsBody.appendChild(row);
  }

  recordCount.textContent = records.length.toLocaleString("ko-KR");
  const durations = records
    .map((record) => Number(record.durationMs))
    .filter((duration) => Number.isFinite(duration));
  const average = durations.length
    ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
    : null;
  averageDuration.textContent = average === null ? "-" : formatDuration(average);
  latestRecord.textContent = records.length ? formatDate(records[0].timestamp) : "-";
}

function createCell(text, className) {
  const cell = document.createElement("td");
  cell.className = className || "";
  cell.textContent = text || "-";
  return cell;
}

function createExpandableCell(text, label) {
  const cell = document.createElement("td");
  cell.className = "content-cell";
  const value = String(text || "");
  const preview = document.createElement("p");
  preview.textContent = value;
  cell.appendChild(preview);

  if (value.length > 0) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const fullText = document.createElement("div");
    summary.textContent = label;
    fullText.className = "full-text";
    fullText.textContent = value;
    details.append(summary, fullText);
    cell.appendChild(details);
  }

  return cell;
}

function createSourcesCell(sources) {
  const cell = document.createElement("td");
  cell.className = "sources-cell";
  const values = Array.isArray(sources) ? sources : [];
  if (!values.length) {
    cell.textContent = "-";
    return cell;
  }

  for (const source of values) {
    const item = document.createElement("span");
    item.textContent = source;
    cell.appendChild(item);
  }
  return cell;
}

function setLoading(isLoading) {
  searchForm.querySelectorAll("button, input, select").forEach((element) => {
    element.disabled = isLoading;
  });
  if (isLoading) dashboardMessage.textContent = "상담 기록을 불러오는 중입니다.";
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: "서버 응답을 확인하지 못했습니다." };
  }
}

function createBasicAuthorization(username, password) {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function shortSessionId(value) {
  const sessionId = String(value || "unknown");
  if (sessionId === "unknown") return "미확인";
  return sessionId.slice(0, 8);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function formatDuration(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return "-";
  return `${(milliseconds / 1000).toFixed(1)}초`;
}

function exportCsv() {
  if (!currentRecords.length) {
    dashboardMessage.textContent = "저장할 상담 기록이 없습니다.";
    return;
  }

  const headers = ["일시", "상담번호", "질문", "답변", "참고자료", "모델", "응답시간(ms)"];
  const rows = currentRecords.map((record) => [
    record.timestamp,
    record.sessionId,
    record.question,
    record.answer,
    (record.sources || []).join(" | "),
    record.model,
    record.durationMs
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `medical-ai-chat-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
