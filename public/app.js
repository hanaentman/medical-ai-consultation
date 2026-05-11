const messagesEl = document.querySelector("#messages");
const formEl = document.querySelector("#chat-form");
const inputEl = document.querySelector("#message-input");
const statusEl = document.querySelector("#status");
const quickButtons = document.querySelectorAll("[data-question]");

const history = [];

boot();

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message) return;
  await sendMessage(message);
});

quickButtons.forEach((button) => {
  button.addEventListener("click", () => {
    inputEl.value = button.dataset.question;
    inputEl.focus();
  });
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

async function boot() {
  addMessage(
    "assistant",
    "안녕하세요. 병원 문서를 기준으로 안내드릴게요. 증상, 예약, 비용, 서류 발급처럼 궁금한 내용을 편하게 입력해 주세요."
  );

  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    const keyState = data.hasApiKey ? "API 키 연결됨" : "API 키 필요";
    statusEl.textContent = `문서 ${data.documentCount}개 로드됨 · ${data.model} · ${keyState}`;
  } catch {
    statusEl.textContent = "서버 상태를 확인하지 못했습니다.";
  }
}

async function sendMessage(message) {
  addMessage("user", message);
  inputEl.value = "";
  setBusy(true);

  const pending = addMessage("assistant", "답변을 준비하고 있습니다.");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "상담 요청에 실패했습니다.");
    }

    pending.remove();
    addMessage("assistant", data.answer, data.sources || []);
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: data.answer });
    while (history.length > 10) history.shift();
  } catch (error) {
    pending.remove();
    addMessage("error", error.message);
  } finally {
    setBusy(false);
  }
}

function addMessage(role, text, sources = []) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.textContent = text;

  if (sources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "sources";
    for (const source of sources.slice(0, 5)) {
      const item = document.createElement("span");
      item.className = "source";
      item.textContent = source.title;
      sourceList.appendChild(item);
    }
    message.appendChild(sourceList);
  }

  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

function setBusy(isBusy) {
  formEl.querySelector("button").disabled = isBusy;
  inputEl.disabled = isBusy;
}
