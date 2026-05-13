const messagesEl = document.querySelector("#messages");
const formEl = document.querySelector("#chat-form");
const inputEl = document.querySelector("#message-input");
const statusEl = document.querySelector("#status");
const quickButtons = document.querySelectorAll("[data-question]");
const newChatButton = document.querySelector("#new-chat-button");
const imageModal = document.querySelector("#image-modal");
const imageModalImg = document.querySelector("#image-modal-img");
const imageModalCaption = document.querySelector("#image-modal-caption");
const imageModalClose = document.querySelector(".image-modal-close");

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

newChatButton?.addEventListener("click", () => {
  resetConversation();
});

imageModalClose?.addEventListener("click", closeImageModal);
imageModal?.addEventListener("click", (event) => {
  if (event.target === imageModal) closeImageModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageModal && !imageModal.hidden) {
    closeImageModal();
  }
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

async function boot() {
  addMessage(
    "bot",
    "안녕하세요. 병원 문서를 기준으로 안내드릴게요. 증상, 예약, 비용, 서류 발급처럼 궁금한 내용을 편하게 입력해 주세요."
  );

  try {
    const response = await fetch("/api/health");
    const data = await readResponseJson(response);
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

  const pending = addPendingMessage();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history })
    });
    const data = await readResponseJson(response);

    if (!response.ok) {
      throw new Error(data.detail || data.error || "상담 요청에 실패했습니다.");
    }

    pending.remove();
    addMessage("bot", data.answer, data.sources || [], data.images || []);
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

function resetConversation() {
  history.length = 0;
  messagesEl.replaceChildren();
  inputEl.value = "";
  boot();
  inputEl.focus();
}

async function readResponseJson(response) {
  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return text ? JSON.parse(text) : {};
  }

  const preview = text.replace(/\s+/g, " ").slice(0, 120);
  throw new Error(
    response.ok
      ? "서버가 JSON이 아닌 응답을 보냈습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요."
      : `서버 오류가 발생했습니다. (${response.status}) ${preview}`
  );
}

function addMessage(role, text, sources = [], images = []) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  appendTextWithPhoneLinks(message, text);

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

  if (images.length) {
    const imageList = document.createElement("div");
    imageList.className = "image-list";
    for (const image of images) {
      const figure = document.createElement("figure");
      figure.className = "image-card";

      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.title;
      img.loading = "lazy";
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.addEventListener("click", () => openImageModal(image.url, image.title));
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openImageModal(image.url, image.title);
        }
      });

      const caption = document.createElement("figcaption");
      caption.textContent = image.title;

      figure.append(img, caption);
      imageList.appendChild(figure);
    }
    message.appendChild(imageList);
  }

  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

function appendTextWithPhoneLinks(container, text) {
  const phonePattern = /02-6925-1111/g;
  const value = String(text || "");
  let lastIndex = 0;
  let match;

  while ((match = phonePattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }

    const link = document.createElement("a");
    link.className = "phone-link";
    link.href = "tel:0269251111";
    link.textContent = match[0];
    container.appendChild(link);

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) {
    container.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
}

function openImageModal(url, title) {
  if (!imageModal || !imageModalImg || !imageModalCaption) return;
  imageModalImg.src = url;
  imageModalImg.alt = title || "첨부 이미지";
  imageModalCaption.textContent = title || "";
  imageModal.hidden = false;
  document.body.classList.add("modal-open");
  imageModalClose?.focus();
}

function closeImageModal() {
  if (!imageModal || !imageModalImg) return;
  imageModal.hidden = true;
  imageModalImg.src = "";
  document.body.classList.remove("modal-open");
}

function addPendingMessage() {
  const message = document.createElement("article");
  message.className = "message bot pending";
  const text = document.createElement("span");
  text.textContent = "답변을 준비하고 있습니다.\n상담원: 답변을 하는데 최대 30초 걸릴 수 있습니다.";
  const dots = document.createElement("span");
  dots.className = "pending-dots";
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "pending-dot";
    dots.appendChild(dot);
  }
  message.append(text, dots);
  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

function setBusy(isBusy) {
  formEl.querySelector("button").disabled = isBusy;
  inputEl.disabled = isBusy;
  if (newChatButton) newChatButton.disabled = isBusy;
  quickButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}
