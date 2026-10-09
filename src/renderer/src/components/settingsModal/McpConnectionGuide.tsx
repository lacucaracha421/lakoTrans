import React from "react";
import { mcpGateway } from "../../api/mcpGateway";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { ChatgptGuide } from "./McpChatgptGuide";
import { OpenCodeGuide, GenericMcpGuide } from "./McpOpenCodeGuide";
import {
  ClaudeCodeGuide,
  ClaudeGuide,
  McpCliSteps,
  McpCommandCopy,
} from "./McpClaudeGuide";
import styles from "./McpSettingsPanel.module.css";

const MCP_CLIENTS = [
  "codex",
  "chatgpt",
  "claude",
  "claude-code",
  "opencode",
  "generic",
] as const;
type McpClient = (typeof MCP_CLIENTS)[number];
const CLIENT_LABELS: Record<McpClient, string> = {
  codex: "Codex",
  chatgpt: "ChatGPT",
  claude: "Claude",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  generic: "기타 MCP 앱",
};
const HELP_LABELS: Record<McpClient, string> = {
  codex: "Codex 연결 문서",
  chatgpt: "ChatGPT 열기",
  claude: "Claude 열기",
  "claude-code": "Claude Code 연결 문서",
  opencode: "OpenCode 연결 문서",
  generic: "MCP 연결 문서",
};

export function McpTailscaleGuide({
  busy,
  run,
}: {
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <div className={styles.body}>
      <ol className={styles.setupSteps} aria-label="Tailscale 연결 순서">
        <li>
          <strong>Tailscale 설치</strong>
          <p className={styles.note}>당근을 실행하는 PC에 설치하세요.</p>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => mcpGateway.openMcpHelp("tailscale"))}
          >
            Tailscale 다운로드
          </Button>
        </li>
        <li>
          <strong>로그인·PC 연결</strong>
          <p className={styles.note}>
            Windows: 시계 옆 숨겨진 아이콘(위쪽 화살표) → Tailscale 우클릭.
            macOS: 상단 메뉴 막대 → Tailscale.
          </p>
          <p className={styles.note}>
            Log in(로그인) → 브라우저 로그인 → 기기 연결 화면에서 Connect(연결).
            Tailscale 메뉴가 연결된 상태인지 확인하세요.
          </p>
        </li>
        <li>
          <strong>MCP 켜기</strong>
          <p className={styles.note}>
            위의 MCP 켜기를 누르세요. Tailscale에서 연결 허용 버튼이 나오면
            HTTPS·Funnel을 허용한 뒤, 당근에서 MCP 켜기를 다시 누르세요.
            Funnel은 이 PC의 연결 주소를 인터넷에 공개합니다.
          </p>
        </li>
        <li>
          <strong>AI 앱 연결</strong>
          <p className={styles.note}>
            연결 가능 표시 → 연결 진단 → 주소 복사. /mcp를 포함한 주소로 아래
            사용하는 AI 앱의 안내를 따라 등록하고, 당근에서 같은 코드를 확인해
            승인하세요.
          </p>
        </li>
      </ol>
      <p className={styles.note}>사용하는 동안 당근과 Tailscale을 켜 두세요.</p>
      <p className={styles.note}>
        로그인 오류: Tailscale에서 로그인·Connect를 확인하세요.
        MagicDNS·HTTPS·Funnel 권한 오류: Tailscale 네트워크 관리자에게
        요청하세요.
      </p>
      <p className={styles.note}>
        443 사용 중: 개발 버전 등 다른 당근의 MCP를 먼저 끄세요. 다른 앱이 사용
        중이면 해당 공유가 끝난 뒤 다시 시도하세요.
      </p>
    </div>
  );
}

export function McpConnectionGuide({
  url,
  busy,
  run,
}: {
  url?: string | null;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [client, setClient] = React.useState<McpClient>("codex");
  const id = React.useId();
  return (
    <div className={styles.body}>
      <Tabs
        ariaLabel="연결할 AI 앱"
        className={styles.clientTabs}
        tabClassName={styles.clientTab}
        value={client}
        onChange={setClient}
        items={MCP_CLIENTS.map((value) => ({
          value,
          label: CLIENT_LABELS[value],
          id: `${id}-${value}`,
          panelId: `${id}-${value}-panel`,
        }))}
      />
      <div
        role="tabpanel"
        id={`${id}-${client}-panel`}
        aria-labelledby={`${id}-${client}`}
        className={styles.body}
      >
        {client === "opencode" ? (
          <OpenCodeGuide url={url} busy={busy} run={run} />
        ) : client === "generic" ? (
          <GenericMcpGuide url={url} />
        ) : client === "claude-code" ? (
          <ClaudeCodeGuide url={url} busy={busy} run={run} />
        ) : client === "claude" ? (
          <ClaudeGuide />
        ) : client === "chatgpt" ? (
          <ChatgptGuide />
        ) : (
          <McpCliSteps
            registerTitle="Codex에 서버 등록"
            registration={<CodexRegistration url={url} busy={busy} run={run} />}
            approveTitle="같은 코드 확인 후 승인"
            approveNote="열린 브라우저와 위 승인 요청의 숫자 코드를 비교하고, 요청 권한을 확인하세요."
            requestNote="연결 후 Codex에서 새 작업을 여세요. 당근 앱은 켜 두세요."
          />
        )}
        <div className={styles.actions}>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void run(() => mcpGateway.openMcpHelp(client))}
          >
            {HELP_LABELS[client]}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CodexRegistration({
  url,
  busy,
  run,
}: {
  url?: string | null;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <>
      <p className={styles.note}>
        Codex CLI가 설치된 PC의 터미널에서 두 줄을 차례로 실행하세요. 같은 PC의
        Codex 앱·CLI가 설정을 공유합니다.
      </p>
      <McpCommandCopy
        commands={
          url
            ? `codex mcp add carrot --url ${JSON.stringify(url)}\ncodex mcp login carrot`
            : null
        }
        busy={busy}
        run={run}
      />
    </>
  );
}
