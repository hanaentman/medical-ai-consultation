# 의료 서비스 AI 상담 프로그램

`doct` 폴더의 병원 문서를 검색해 관련 자료를 OpenAI Responses API 컨텍스트에 넣고 답변하는 웹 상담 앱입니다.

## 실행 방법

1. `.env.example`을 참고해 같은 폴더에 `.env` 파일을 만듭니다.

```env
OPENAI_API_KEY=여기에_API_KEY_입력
OPENAI_MODEL=gpt-5.6-sol
MAX_OUTPUT_TOKENS=1400
PORT=3000
```

2. PowerShell에서 실행합니다.

```powershell
.\start-local.ps1
```

또는 Node가 정상 등록되어 있으면 아래 명령도 가능합니다.

```powershell
npm start
```

3. 브라우저에서 접속합니다.

```text
http://localhost:3000
```

## 구성

- `server.js`: 문서 로딩, 간단한 검색, OpenAI API 호출, 정적 파일 서버
- `public/`: 상담 화면
- `doct/`: 상담에 참고할 병원 문서

## 운영 메모

- API 키는 브라우저로 전달하지 않고 서버에서만 사용합니다.
- 답변 프롬프트는 충분히 자세히 안내하도록 열어두되, 진단 확정/처방/복약 지시/검사 판독은 피하고 응급 가능성이 있으면 119 또는 응급실을 안내하도록 넣어두었습니다.
- 문서를 수정하거나 추가한 뒤에는 서버를 재시작하면 새 내용이 반영됩니다.
- 개인정보 보호를 위해 OpenAI 요청은 `store: false`로 보냅니다.

## GitHub + Render 배포

1. GitHub에 새 저장소를 만들고 이 폴더를 업로드합니다.
2. Render에서 `New Web Service`를 만들고 GitHub 저장소를 연결합니다.
3. Render 설정은 `render.yaml`을 사용하거나 아래처럼 입력합니다.

```text
Runtime: Node
Build Command: 비워둠
Start Command: npm start
Health Check Path: /api/health
```

4. Render의 `Environment`에 아래 값을 넣습니다.

```text
OPENAI_API_KEY=새로 발급한 API 키
OPENAI_MODEL=gpt-5.6-sol
MAX_OUTPUT_TOKENS=1400
```

중요: 대화나 저장소에 노출된 API 키는 폐기하고 새 키를 발급해서 Render 환경변수에만 넣는 것을 권장합니다.

참고: OpenAI 공식 모델 문서에서 `gpt-5.6-sol`이 계정에 제공되지 않으면 API가 `model_not_found`를 반환할 수 있습니다. 그 경우 Render 환경변수의 `OPENAI_MODEL`을 계정에서 사용 가능한 모델 ID로 바꾸면 됩니다.
