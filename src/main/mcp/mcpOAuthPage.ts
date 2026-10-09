import { createHash } from "node:crypto";

type Consent = {
  transaction: string;
  clientName: string;
  redirectUri?: string;
  scope: string;
  resource: string;
};

/** One static stylesheet for the browser approval pages. The CSP allows it by
 * hash, so pages still load no remote assets and no other inline style. */
const PAGE_STYLE = `
:root{color-scheme:dark;--bg:#101114;--card:#1c1f25;--sunken:#14161b;--line:#2e3137;--line-strong:#3d4147;--text:#ece7dc;--head:#f4efe6;--dim:#b8b1a6;--muted:#9a9ea6;--accent:#a64e36;--accent-hover:#b05239;--accent-bd:#cf7152;--accent-soft:rgba(166,78,54,.16);--accent-text:#fbf3ef;--danger:#e39383;--shadow:0 24px 60px rgba(0,0,0,.35)}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f3f0ea;--card:#fff;--sunken:#f6f3ee;--line:#e5dfd6;--line-strong:#d4ccc0;--text:#2a251f;--head:#1b1814;--dim:#5d564c;--muted:#7b746a;--accent-soft:rgba(166,78,54,.08);--danger:#a3372a;--shadow:0 18px 48px rgba(60,40,20,.12)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:32px 16px;background:var(--bg);color:var(--text);font:15px/1.6 "Malgun Gothic","Apple SD Gothic Neo","Segoe UI",system-ui,sans-serif}
main{width:min(100%,560px);padding:32px;border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:var(--shadow)}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:22px;color:var(--dim);font-size:13px;font-weight:600}
.brand svg{flex:none;width:28px;height:28px}
h1{margin:0 0 8px;color:var(--head);font-size:22px;line-height:1.35}
.lead{margin:0;color:var(--dim)}
.lead strong{color:var(--text)}
.code{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:24px 0;padding:18px 20px;border:1px solid var(--accent-bd);border-radius:10px;background:var(--accent-soft)}
.code span{color:var(--dim);font-size:13px;font-weight:600}
.code strong{color:var(--head);font:700 30px/1 Consolas,"SFMono-Regular","Cascadia Mono",monospace;letter-spacing:.16em}
.facts{display:grid;gap:14px;margin:24px 0 0}
.facts div{display:grid;grid-template-columns:156px minmax(0,1fr);gap:12px}
.facts dt{color:var(--muted);font-size:13px;line-height:1.7}
.facts dd{min-width:0;margin:0;overflow-wrap:anywhere}
.mono{font-family:Consolas,"SFMono-Regular","Cascadia Mono",monospace;font-size:13px}
.scopes{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.scopes li{padding:2px 10px;border:1px solid var(--line);border-radius:999px;background:var(--sunken);font-size:13px}
.status{display:flex;align-items:center;gap:10px;margin:24px 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--sunken);color:var(--dim);font-size:14px}
.status[data-state=error]{border-color:var(--danger);color:var(--danger)}
.status[data-state=error] .spinner{display:none}
.spinner{flex:none;width:16px;height:16px;border:2px solid var(--line-strong);border-top-color:var(--accent-bd);border-radius:50%;animation:spin .9s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spinner{animation-duration:2.4s}}
form{display:grid;gap:10px;margin:0}
.approve{margin-top:24px}
label{color:var(--dim);font-size:13px;font-weight:600}
input[type=password]{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--line-strong);border-radius:8px;background:var(--sunken);color:var(--text);font:inherit}
.actions{display:flex;gap:8px;margin-top:6px}
button{flex:1;min-height:40px;padding:8px 16px;border:1px solid var(--line-strong);border-radius:8px;background:var(--sunken);color:var(--text);font:inherit;font-size:14px;font-weight:600;cursor:pointer}
button:hover{border-color:var(--accent-bd)}
button.primary{border-color:var(--accent);background:var(--accent);color:var(--accent-text)}
button.primary:hover{background:var(--accent-hover)}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent-bd);outline-offset:2px}
.notes{display:grid;gap:8px;margin-top:24px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;line-height:1.65}
.notes p{margin:0}
.notes strong,.notes code{color:var(--dim)}
@media (max-width:480px){main{padding:24px 20px}.facts div{grid-template-columns:1fr;gap:2px}.code{flex-direction:column;align-items:flex-start}}
`;

/** CSP source that allows exactly `PAGE_STYLE` and no other inline style. */
export const MCP_PAGE_STYLE_SOURCE = `'sha256-${createHash("sha256").update(PAGE_STYLE).digest("base64")}'`;

const BRAND = `<div class="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#a64e36"/><path d="M9.2 24.4 19.4 12.6a3.2 3.2 0 0 1 4.6 4.4L11.3 25.9c-1.3.9-2.9-.4-2.1-1.5Z" fill="#fbe2d3"/><path d="M21.4 11.1c-.6-2.1-.1-4 1.4-5.3.7 1.8.6 3.6-.3 5.2m1.3 1.1c1.4-1.5 3.3-2.1 5.2-1.6-.9 1.7-2.6 2.6-4.5 2.6" fill="none" stroke="#fbe2d3" stroke-width="1.7" stroke-linecap="round"/></svg><span>당근망가번역기 · AI 앱 연결</span></div>`;

/** Shared head and brand row for the approval pages. */
export function mcpPageStart(title: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${escapeMcpHtml(title)}</title><style>${PAGE_STYLE}</style></head>
<body><main>${BRAND}`;
}

/** Permission labels as separate chips; every label is escaped. */
export function mcpScopeList(labels: readonly string[]): string {
  return `<ul class="scopes">${labels.map((label) => `<li>${escapeMcpHtml(label)}</li>`).join("")}</ul>`;
}

/** No remote assets, scripts, cookies in URLs, or user data appear in this page. */
export function mcpOAuthConsentPage(consent: Consent): string {
  return `${mcpPageStart("당근 MCP 연결 승인")}
<h1>AI 앱 연결 승인</h1>
<p class="lead">이 연결은 <strong>현재 실행한 시험용 앱의 보관함 전체를 읽을 수 있습니다.</strong> 이미지 전송을 켰다면 원본 축소 이미지도 요청할 수 있습니다. 번역 실행이나 수정 권한은 없습니다.</p>
<dl class="facts"><div><dt>클라이언트가 표시한 이름</dt><dd>${escapeMcpHtml(consent.clientName)}</dd></div>${consent.redirectUri ? `<div><dt>승인 후 돌아갈 주소</dt><dd class="mono">${escapeMcpHtml(consent.redirectUri)}</dd></div>` : ""}<div><dt>연결할 서버</dt><dd class="mono">${escapeMcpHtml(consent.resource)}</dd></div><div><dt>권한</dt><dd>${mcpScopeList(consent.scope.split(/\s+/).filter(Boolean))}</dd></div></dl>
<form method="post" action="/oauth/approve" class="approve">
<input type="hidden" name="transaction" value="${escapeMcpHtml(consent.transaction)}">
<label for="password">로컬 연결 암호</label>
<input id="password" type="password" name="pairing_secret" minlength="43" maxlength="128" required autocomplete="off" spellcheck="false">
<div class="actions"><button class="primary" type="submit" name="decision" value="approve">읽기 권한으로 연결 승인</button><button type="submit" name="decision" value="deny" formnovalidate>취소</button></div>
</form>
<div class="notes"><p>직접 실행한 터미널에 표시된 서버 주소와 위 주소가 같은지 확인하세요. 연결 암호는 로컬 <code>.tmp/mcp-web-password</code> 파일에서 복사합니다. <strong>AI 앱 대화나 다른 사이트에는 암호를 보내지 마세요.</strong></p>
<p>승인하면 이 실행 중인 앱에 최대 24시간 동안 접근할 수 있습니다. 앱 종료·재시작으로 권한이 폐기됩니다. 외부 프록시를 통해 전송되므로 공개 가능한 시험 자료만 사용하세요.</p></div>
</main></body></html>`;
}

export function escapeMcpHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
