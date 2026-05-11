const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DOC_DIR = path.join(ROOT, "doct");
const PUBLIC_DIR = path.join(ROOT, "public");
const DEFAULT_MODEL = "gpt-5.5";

loadEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const OPENAI_MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 1400);

const documents = loadDocuments(DOC_DIR);
const doctors = loadDoctors(DOC_DIR);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        model: OPENAI_MODEL,
        documentCount: documents.length,
        hasApiKey: Boolean(OPENAI_API_KEY)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      const body = await readJson(req);
      const message = String(body.message || "").trim();
      const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

      if (!message) {
        return sendJson(res, 400, { error: "질문을 입력해 주세요." });
      }

      if (!OPENAI_API_KEY) {
        return sendJson(res, 500, {
          error: ".env 파일에 OPENAI_API_KEY를 설정해 주세요."
        });
      }

      const conversationQuery = buildConversationQuery(message, history);
      const matches = searchDocuments(conversationQuery, documents, 10);
      const doctorMatches = searchDoctors(conversationQuery, doctors, 5);
      const answer = await createAnswer({ message, history, matches, doctorMatches });

      return sendJson(res, 200, {
        answer,
        sources: matches.map((match) => ({
          title: match.title,
          score: match.score,
          preview: match.text.slice(0, 220)
        }))
      });
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "지원하지 않는 요청입니다." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: "서버 처리 중 오류가 발생했습니다.",
      detail: error.message
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Medical AI consultation app: http://${HOST}:${PORT}`);
  console.log(`Loaded ${documents.length} document chunks from ${DOC_DIR}`);
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function loadDocuments(docDir) {
  if (!fs.existsSync(docDir)) return [];

  const files = fs
    .readdirSync(docDir)
    .filter((file) => file.toLowerCase().endsWith(".txt"))
    .sort((a, b) => a.localeCompare(b, "ko"));

  return files.flatMap((file) => {
    const fullPath = path.join(docDir, file);
    const raw = fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n").trim();
    const title = path.basename(file, ".txt");
    return chunkText(raw, 1400).map((text, index) => ({
      id: `${title}-${index + 1}`,
      title,
      text,
      terms: tokenize(`${title}\n${text}`)
    }));
  });
}

function loadDoctors(docDir) {
  const filePath = path.join(docDir, "홈페이지-의료진 정보.txt");
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const blocks = raw.split(/\n(?=이름:\s*)/).filter((block) => block.includes("이름:"));

  return blocks
    .map((block) => {
      const name = readField(block, "이름");
      const department = readField(block, "진료과");
      const specialty = readField(block, "전문분야");
      if (!name || !specialty) return null;
      return {
        title: `${name} ${department}`,
        name,
        department,
        specialty,
        text: `${name} 의료진\n진료과: ${department}\n전문분야: ${specialty}`,
        terms: tokenize(`${name} ${department} ${specialty}`)
      };
    })
    .filter(Boolean);
}

function readField(text, label) {
  const match = text.match(new RegExp(`^${label}:?\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function chunkText(text, maxLength) {
  if (text.length <= maxLength) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (paragraph.length <= maxLength) {
      current = paragraph;
    } else {
      for (let i = 0; i < paragraph.length; i += maxLength) {
        chunks.push(paragraph.slice(i, i + maxLength));
      }
      current = "";
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function tokenize(text) {
  return Array.from(
    new Set(
      String(text)
        .toLowerCase()
        .match(/[가-힣a-z0-9]{2,}/g) || []
    )
  );
}

function searchDocuments(query, docs, limit) {
  const queryTerms = tokenize(expandQuery(query));
  const querySet = new Set(queryTerms);

  return docs
    .map((doc) => {
      let score = 0;
      for (const term of doc.terms) {
        if (querySet.has(term)) score += term.length > 3 ? 3 : 1;
        if (query.includes(term)) score += 1;
      }

      if (doc.title.includes("FAQ")) score += 1;
      if (doc.title.includes("증상") && /아파|증상|통증|피|막힘|어지|코|귀|목|수면|코골/.test(query)) {
        score += 2;
      }

      return { ...doc, score };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function searchDoctors(query, doctorList, limit) {
  if (!isSymptomQuestion(query)) return [];

  const expanded = expandQuery(query);
  const queryTerms = tokenize(expanded);
  const querySet = new Set(queryTerms);

  return doctorList
    .map((doctor) => {
      let score = 0;
      for (const term of doctor.terms) {
        if (querySet.has(term)) score += term.length > 3 ? 4 : 2;
        if (expanded.includes(term)) score += 1;
      }

      if (/코|콧물|코막힘|비염|축농|후각|코피|코골|수면무호흡/.test(expanded) && /코|비염|부비동|비중격|코골이|수면무호흡/.test(doctor.text)) score += 5;
      if (/귀|이명|난청|어지|중이염|보청기|돌발성/.test(expanded) && /귀|이명|난청|어지럼|중이염|보청기|돌발성/.test(doctor.text)) score += 6;
      if (/목|편도|갑상선|침샘|후두|성대|목소리|인후두|멍울|혹/.test(expanded) && /목|두경부|편도|갑상선|침샘|후두|음성|인후두|구강/.test(doctor.text)) score += 6;
      if (/수면|코골이|무호흡|수면다원/.test(expanded) && /수면|코골이|무호흡/.test(doctor.text)) score += 7;

      return { ...doctor, score };
    })
    .filter((doctor) => doctor.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function isSymptomQuestion(query) {
  return /아파|아픔|통증|증상|붓|부음|피|출혈|막힘|답답|콧물|코피|기침|가래|먹먹|이명|난청|어지|목소리|쉼|이물감|멍울|혹|편도|비염|축농|코골|무호흡|수면|후각|냄새|침샘|갑상선|중이염|보청기|부작용/.test(query);
}

function buildConversationQuery(message, history) {
  const recent = Array.isArray(history)
    ? history
        .slice(-6)
        .map((item) => item?.content || "")
        .join(" ")
    : "";
  return `${recent} ${message}`.trim();
}

function expandQuery(query) {
  const synonyms = {
    예약: "예약 접수 진료 시간 변경 취소 당일",
    주차: "주차 위치 오시는길 셔틀 버스",
    코: "코 코막힘 콧물 비염 축농증 코피 후각",
    귀: "귀 난청 이명 중이염 어지러움 보청기",
    목: "목 편도 갑상선 침샘 혹 통증",
    수면: "수면 코골이 무호흡 검사 입원",
    서류: "서류 진단서 소견서 의무기록 CD 발급",
    비용: "비용 금액 비급여 검사 주사"
  };

  let expanded = query;
  for (const [key, value] of Object.entries(synonyms)) {
    if (query.includes(key)) expanded += ` ${value}`;
  }
  return expanded;
}

async function createAnswer({ message, history, matches, doctorMatches }) {
  const context = matches.length
    ? matches
        .map((match, index) => `[자료 ${index + 1}: ${match.title}]\n${match.text}`)
        .join("\n\n---\n\n")
    : "질문과 직접 관련된 병원 문서를 찾지 못했습니다.";

  const doctorContext = doctorMatches?.length
    ? doctorMatches
        .map((doctor, index) => `[의료진 ${index + 1}: ${doctor.name}]\n진료과: ${doctor.department}\n전문분야: ${doctor.specialty}`)
        .join("\n\n")
    : "증상과 직접 연결할 의료진 전문분야 문서를 찾지 못했습니다.";

  const conversation = history
    .filter((item) => item && item.role && item.content)
    .map((item) => `${item.role === "assistant" ? "상담원" : "환자"}: ${item.content}`)
    .join("\n");

  const payload = {
    model: OPENAI_MODEL,
    instructions: [
      "당신은 병원 의료 서비스 AI 상담원입니다.",
      "답변 품질을 최우선으로 하되, 병원 문서를 핵심 근거로 삼아 환자에게 실제로 도움이 되는 다음 행동을 안내하세요.",
      "최근 대화가 있으면 반드시 맥락을 이어서 이해하세요. 사용자가 '그럼', '이건', '아까 말한 증상'처럼 지시어를 쓰면 최근 대화의 질문과 답변을 참고해 해석하세요.",
      "문서에 직접 없는 내용도 일반적인 의료 상담 상식 수준에서 설명할 수 있지만, 병원 정책/가격/시간/의료진/예약/서류 정보는 문서에 근거가 없으면 확인이 필요하다고 말하세요.",
      "증상 상담에서는 먼저 증상에 대해 이해하기 쉽게 답변하고, 가능한 원인을 단정하지 말고, 확인이 필요한 점과 적절한 진료 센터를 안내하세요.",
      "증상 상담이면 반드시 제공된 의료진 전문분야를 참고해 관련 의료진을 1~3명 소개하세요. 이름, 진료과, 전문분야를 짧게 언급하고, 최종 배정은 예약/진료 상황에 따라 달라질 수 있다고 안내하세요.",
      "진단명 확정, 처방, 약 복용/중단 지시, 검사 결과 판독, 수술 필요 여부 확정은 하지 마세요.",
      "호흡곤란, 심한 출혈, 의식저하, 급격한 악화, 극심한 통증, 신경학적 이상 등 응급 가능성이 있으면 즉시 119 또는 응급실을 안내하세요.",
      "답변은 한국어로 자연스럽게 작성하고, 질문이 단순하면 짧게 답하되 복잡하면 항목을 나누어 충분히 설명하세요.",
      "마지막 줄에는 참고한 자료명을 '참고: 자료명, 자료명' 형식으로 적으세요."
    ].join("\n"),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `병원 문서:\n${context}`,
              `의료진 전문분야 문서:\n${doctorContext}`,
              conversation ? `최근 대화:\n${conversation}` : "",
              `환자 질문:\n${message}`
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        ]
      }
    ],
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message || "OpenAI API 요청에 실패했습니다.";
    throw new Error(message);
  }

  return extractText(data).trim() || "답변을 생성하지 못했습니다.";
}

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;

  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("요청이 너무 큽니다."));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("JSON 형식이 올바르지 않습니다."));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(pathname, res) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(requested);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decoded));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden", "text/plain; charset=utf-8");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(res, 404, "Not found", "text/plain; charset=utf-8");
  }

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, data) {
  sendText(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function sendText(res, status, text, contentType) {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}
