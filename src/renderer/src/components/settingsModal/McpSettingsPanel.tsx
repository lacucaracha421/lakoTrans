import React from "react";
import { describeMcpScopes } from "../../../../shared/mcpScopeDescriptions";
import type {
  McpDesktopStatus,
  McpDiagnostics,
} from "../../../../shared/mcpDesktopTypes";
import { mcpGateway } from "../../api/mcpGateway";
import { Button } from "../ui/Button";
import { CheckboxField } from "../ui/CheckboxField";
import { CollapsibleSection, Section } from "../ui/Section";
import { useMcpSettings } from "./useMcpSettings";
import { McpConnectionGuide, McpTailscaleGuide } from "./McpConnectionGuide";
import styles from "./McpSettingsPanel.module.css";

type Props = {
  status: McpDesktopStatus | null;
  error: string | null;
  busy: boolean;
  diagnostics: McpDiagnostics | null;
  run: (action: () => Promise<unknown>) => Promise<void>;
  diagnose: () => Promise<void>;
};
export function McpSettingsPanel(): React.JSX.Element {
  return <McpSettingsView {...useMcpSettings()} />;
}
export function McpSettingsView(props: Props): React.JSX.Element {
  const { status } = props;
  return (
    <div className={styles.stack}>
      <McpServerSection {...props} />
      <McpHelp {...props} />
      {status && <McpConnections {...props} status={status} />}
      {status && <McpPermissions {...props} status={status} />}
    </div>
  );
}
function McpServerSection({ status, error, busy, run }: Props) {
  return (
    <Section
      title="AI 연결"
      description="MCP를 지원하는 AI 앱에서 보관함을 조회하고 번역·편집합니다."
      density="compact"
      bodyClassName={styles.body}
      actions={<McpServerActions status={status} busy={busy} run={run} />}
    >
      <p className={styles.status} data-state={status?.state} role="status">
        <span className={styles.dot} aria-hidden="true" />
        {status ? stateLabel(status.state) : "상태 확인 중…"}
      </p>
      {status?.message && (
        <p className={styles.note} role="status">
          {status.message}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {status?.url && (
        <div className={styles.addressRow}>
          <code className={styles.address}>{status.url}</code>
          <Button
            variant={
              status.state === "online" && status.pending.length === 0
                ? "primary"
                : "secondary"
            }
            disabled={busy}
            onClick={() => void run(() => mcpGateway.copyMcpUrl())}
          >
            주소 복사
          </Button>
        </div>
      )}
      <McpStartupOptions status={status} busy={busy} run={run} />
    </Section>
  );
}
function McpConnections({
  status,
  busy,
  run,
}: Props & { status: McpDesktopStatus }) {
  const connections = status.connections.filter(
    (connection) => !connection.revoked,
  );
  return (
    <Section
      title="연결된 앱"
      density="compact"
      divided
      bodyClassName={styles.body}
    >
      {status.pending.map((request) => (
        <McpPairingRequestView
          key={request.id}
          request={request}
          busy={busy}
          run={run}
        />
      ))}
      {connections.length === 0 && status.pending.length === 0 && (
        <p className={styles.note}>
          {status.state === "online"
            ? "아직 연결된 앱이 없습니다. 위 연결 방법에서 사용할 AI 앱을 선택하세요."
            : "연결된 앱이 없습니다. MCP를 켜고 사용할 AI 앱을 연결하세요."}
        </p>
      )}
      {connections.map((connection) => (
        <div key={connection.id} className={styles.connection}>
          <div className={styles.identity}>
            <strong>{connection.clientName}</strong>
            <p
              className={styles.note}
              title={describeMcpScopes(connection.scope)}
            >
              {describeMcpScopes(connection.scope, "compact")}
            </p>
            <time
              className={styles.timestamp}
              dateTime={new Date(connection.createdAt).toISOString()}
            >
              {new Date(connection.createdAt).toLocaleString("ko-KR")} 승인
            </time>
          </div>
          <Button
            size="sm"
            disabled={busy}
            aria-label={`${connection.clientName} 연결 해제`}
            onClick={() =>
              void run(() => mcpGateway.revokeMcpConnection(connection.id))
            }
          >
            연결 해제
          </Button>
        </div>
      ))}
    </Section>
  );
}
function McpPermissions({
  status,
  busy,
  run,
}: Props & { status: McpDesktopStatus }) {
  return (
    <Section
      title="허용할 기능"
      density="compact"
      divided
      bodyClassName={styles.body}
      description="즉시 적용됩니다. 권한 변경 시 진행 중인 작업이 취소되며 재승인이 필요합니다."
    >
      <p className={styles.note}>
        보관함 전체의 텍스트·문맥 조회와 텍스트 파일 출력은 기본으로 허용됩니다.
      </p>
      <div
        className={styles.permissions}
        role="group"
        aria-label="MCP 권한 설정"
      >
        <CheckboxField
          className={styles.permission}
          label="이미지·출력 파일 전송"
          checked={status.preferences.allowImages}
          disabled={busy}
          onCheckedChange={(allowImages) =>
            void run(() =>
              mcpGateway.configureMcp({ ...status.preferences, allowImages }),
            )
          }
        />
        <CheckboxField
          className={styles.permission}
          label="텍스트·서식·문맥 편집"
          checked={status.preferences.allowEditing}
          disabled={busy}
          onCheckedChange={(allowEditing) =>
            void run(() =>
              mcpGateway.configureMcp({ ...status.preferences, allowEditing }),
            )
          }
        />
        <CheckboxField
          className={styles.permission}
          label="블록·보관함 관리 및 OCR·번역 실행"
          checked={status.preferences.allowProcessing === true}
          disabled={busy}
          onCheckedChange={(allowProcessing) =>
            void run(() =>
              mcpGateway.configureMcp({
                ...status.preferences,
                allowProcessing,
              }),
            )
          }
        />
      </div>
      {status.preferences.allowProcessing && (
        <p className={styles.note}>
          외부 AI로 처리하면 텍스트·이미지가 전송되며 요금이 발생할 수 있습니다.
        </p>
      )}
    </Section>
  );
}
function McpHelp({ status, error, busy, run, diagnose, diagnostics }: Props) {
  const [expanded, setExpanded] = React.useState<boolean | null>(null);
  return (
    <CollapsibleSection
      title="연결 방법 및 도움말"
      density="compact"
      divided
      expanded={
        expanded ?? (!!error || (status !== null && status.state !== "online"))
      }
      onExpandedChange={setExpanded}
      bodyClassName={styles.body}
    >
      <McpTailscaleGuide busy={busy} run={run} />
      <div className={styles.actions}>
        <Button
          disabled={status?.state !== "online" || busy}
          onClick={() => void diagnose()}
        >
          연결 진단
        </Button>
      </div>
      <p className={styles.note}>
        앱을 종료하면 연결이 꺼집니다. 주소와 승인은 유지되며, 연결을 해제하면
        해당 앱의 접근 권한이 즉시 철회됩니다.
      </p>
      <p className={styles.note}>
        이미지 전송에는 이미지가 포함된 출력 파일도 해당하며, 기존 가리기 보호를
        유지합니다. 처리 권한은 앱에 설정된 엔진으로 OCR·번역·원문 제거·이미지
        작업을 실행합니다. 연결 승인만으로 작업이 시작되지는 않습니다.
      </p>
      {diagnostics && (
        <div className={styles.body} role="status">
          <strong>
            {diagnostics.ok ? "연결 진단 통과" : "연결 확인 필요"}
          </strong>
          <p className={styles.note}>
            공개 연결 설정을 확인한 결과입니다. 실제 AI 앱 로그인이나 도구
            실행은 검사하지 않습니다.
          </p>
          {diagnostics.checks.map((check) => (
            <p
              className={check.passed ? styles.note : styles.error}
              key={check.name}
            >
              {check.passed ? "통과" : "실패"} · {check.name}: {check.message}
            </p>
          ))}
        </div>
      )}
      <McpConnectionGuide
        url={status?.state === "online" ? status.url : null}
        busy={busy}
        run={run}
      />
    </CollapsibleSection>
  );
}
function stateLabel(state: McpDesktopStatus["state"]) {
  return {
    off: "꺼짐",
    starting: "연결 준비 중…",
    online: "연결 가능",
    stopping: "종료 중…",
    error: "연결 확인 필요",
  }[state];
}

function McpServerActions({
  status,
  busy,
  run,
}: Pick<Props, "status" | "busy" | "run">) {
  const enabled =
    status !== null &&
    ["online", "starting", "stopping"].includes(status.state);
  return (
    <Button
      variant={enabled ? "secondary" : "primary"}
      disabled={!status || (busy && !enabled)}
      onClick={() => void run(() => mcpGateway.setMcpEnabled(!enabled))}
    >
      {enabled ? "MCP 끄기" : "MCP 켜기"}
    </Button>
  );
}

function McpStartupOptions({
  status,
  busy,
  run,
}: Pick<Props, "status" | "busy" | "run">) {
  return (
    <>
      <div className={styles.actions}>
        <CheckboxField
          label="앱 시작 시 자동 연결"
          className={styles.permission}
          checked={status?.preferences.autoStart ?? false}
          disabled={!status || busy}
          onCheckedChange={(autoStart) => {
            if (status)
              void run(() =>
                mcpGateway.configureMcp({ ...status.preferences, autoStart }),
              );
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void run(() => mcpGateway.openMcpHelp("chatgpt"))}
        >
          ChatGPT 열기
        </Button>
      </div>
      {status?.setupUrl && (
        <Button
          disabled={busy}
          onClick={() => void run(() => mcpGateway.openMcpHelp("setup"))}
        >
          Tailscale에서 연결 허용
        </Button>
      )}
    </>
  );
}

function McpPairingRequestView({
  request,
  busy,
  run,
}: Pick<Props, "busy" | "run"> & {
  request: McpDesktopStatus["pending"][number];
}) {
  return (
    <div className={styles.request}>
      <div className={styles.row}>
        <div className={styles.identity}>
          <strong>연결 승인 요청</strong>
          <span className={styles.note}>
            요청 앱이 표시한 이름: {request.clientName}
          </span>
        </div>
        <strong
          className={styles.code}
          aria-label={`확인 코드: ${request.code}`}
        >
          {request.code}
        </strong>
      </div>
      <p className={styles.note}>브라우저의 코드와 일치할 때만 승인하세요.</p>
      {request.redirectUri && (
        <p className={styles.note}>
          승인 후 돌아갈 주소:{" "}
          <span className={styles.address}>{request.redirectUri}</span>
        </p>
      )}
      <p className={styles.note}>
        요청 권한: {describeMcpScopes(request.scope)}
      </p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            void run(() => mcpGateway.resolveMcpPairing(request.id, true))
          }
        >
          같은 코드 확인 · 승인
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(() => mcpGateway.resolveMcpPairing(request.id, false))
          }
        >
          거절
        </Button>
      </div>
    </div>
  );
}
