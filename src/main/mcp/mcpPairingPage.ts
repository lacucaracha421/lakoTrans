import { randomBytes } from "node:crypto";
import { describeMcpScopes } from "../../shared/mcpScopeDescriptions";
import { escapeMcpHtml, mcpPageStart, mcpScopeList } from "./mcpOAuthPage";

/** All script is static. Only an escaped opaque transaction id enters the form. */
export function mcpPairingPage(consent: {
  transaction: string;
  clientName: string;
  redirectUri?: string;
  resource: string;
  scope: string;
  code: string;
}) {
  const nonce = randomBytes(24).toString("base64");
  const scopes = consent.scope
    .split(/\s+/)
    .filter(Boolean)
    .map((item) => describeMcpScopes(item));
  return {
    nonce,
    html: `${mcpPageStart("당근 MCP 연결 승인")}
<h1>당근 앱에서 연결을 승인하세요</h1>
<p class="lead">앱의 <strong>설정 → AI 연결 / MCP</strong>에서 아래 확인 코드와 요청 권한이 같은지 확인한 뒤 승인하세요. 암호를 복사할 필요가 없습니다.</p>
<div class="code"><span>확인 코드</span><strong>${escapeMcpHtml(consent.code)}</strong></div>
<dl class="facts"><div><dt>클라이언트가 표시한 이름</dt><dd>${escapeMcpHtml(consent.clientName)}</dd></div>
${consent.redirectUri ? `<div><dt>승인 후 돌아갈 주소</dt><dd class="mono">${escapeMcpHtml(consent.redirectUri)}</dd></div>` : ""}
<div><dt>서버</dt><dd class="mono">${escapeMcpHtml(consent.resource)}</dd></div>
<div><dt>요청 권한</dt><dd>${mcpScopeList(scopes)}</dd></div></dl>
<p id="status" class="status" role="status" data-state="waiting"><span class="spinner" aria-hidden="true"></span><span id="status-text">앱의 승인을 확인하고 있습니다…</span></p>
<form method="post" action="/oauth/complete" id="complete">
<input type="hidden" name="transaction" value="${escapeMcpHtml(consent.transaction)}">
<button type="submit">승인 결과 확인</button></form>
<noscript><p class="lead">앱에서 승인한 뒤 ‘승인 결과 확인’을 누르세요.</p></noscript>
<div class="notes"><p>위에 표시된 권한 범위에서 연결됩니다. 읽기는 현재 보관함 전체의 텍스트·문맥 조회와 파일 출력에 적용됩니다. 이미지가 포함된 출력은 이미지 승인이 필요하며 가리기 보호를 지킵니다. 편집·처리 권한으로 텍스트·서식·문맥과 블록·보관함 구조를 변경할 수 있습니다.</p>
<p>처리 권한은 명시적으로 요청한 OCR·번역·원문 제거·이미지 작업을 앱에 설정된 엔진으로 실행할 수 있게 합니다. 외부 제공자를 사용하는 작업은 필요한 텍스트나 이미지를 전송하며 요금이 발생할 수 있습니다. 연결 승인만으로 작업을 시작하지는 않습니다. <strong>클라이언트 이름만 믿고 승인하지 마세요.</strong></p>
<p>승인 기록은 앱을 재시작해도 유지되며 앱에서 철회할 수 있습니다. 접근 토큰은 별도로 만료·갱신됩니다.</p></div></main>
<script nonce="${nonce}">
const form = document.getElementById('complete');
const status = document.getElementById('status');
const statusText = document.getElementById('status-text');
function show(text, state) { statusText.textContent = text; status.dataset.state = state; }
let attempts = 0;
async function poll() {
  if (++attempts > 150) { show('연결이 만료되었습니다. 사용하던 AI 앱에서 다시 연결하세요.', 'error'); return; }
  try {
    const response = await fetch('/oauth/poll', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)), redirect: 'error' });
    if (!response.ok) { show('승인 확인이 중단되었습니다. 앱 상태를 확인하고 다시 연결하세요.', 'error'); return; }
    const result = await response.json();
    if (result.status === 'approved' || result.status === 'denied') { show('승인 결과를 전달하고 있습니다…', 'waiting'); form.requestSubmit(); return; }
    show('앱의 승인을 확인하고 있습니다…', 'waiting');
  } catch (_) { show('앱 연결을 다시 확인하고 있습니다…', 'waiting'); }
  setTimeout(poll, 2000);
}
poll();
</script></body></html>`,
  };
}
