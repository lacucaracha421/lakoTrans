/** @vitest-environment jsdom */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatPanel } from "../src/renderer/src/features/chat/ChatPanel";
import { ChatMarkdown } from "../src/renderer/src/features/chat/ChatMarkdown";
import { ChatTranscript } from "../src/renderer/src/features/chat/ChatTranscript";
import { codexConnection } from "../src/renderer/src/api/codexConnection";
import { claudeConnection } from "../src/renderer/src/api/claudeConnection";
import { chooseCustomSelectOption } from "./testUtils/customSelect";
import type { MangaApi } from "../src/shared/mangaApi";
import { createTestMangaGatewayStub } from "../src/renderer/src/api/mangaGateway";
import type {
  ChatApi,
  ChatEvent,
  ChatSession,
  CurrentViewContext,
} from "../src/shared/chatTypes";
import type { CodexAccountModel } from "../src/shared/codexAccountTypes";

afterEach(cleanup);
const DEFAULT_MODELS: CodexAccountModel[] = [
  {
    id: "gpt-6.1-sol",
    displayName: "GPT 6.1 SOL",
    supportedReasoningEfforts: ["high"],
    defaultReasoningEffort: "high",
    isDefault: true,
  },
];
function setup(
  models: CodexAccountModel[] = DEFAULT_MODELS,
  extra: Partial<MangaApi> = {},
) {
  const session: ChatSession = {
    version: 1,
    id: "00000000-0000-4000-a000-000000000001",
    title: "대화",
    runtime: "codex",
    nativeThreadId: null,
    model: null,
    effort: null,
    state: "idle",
    createdAt: 1,
    updatedAt: 1,
    items: [],
    checkpoint: [],
    question: null,
  };
  let emit: (event: ChatEvent) => void = () => undefined;
  const send = vi.fn<ChatApi["sendChat"]>(async () => ({
    ...session,
    state: "running",
    updatedAt: 2,
  }));
  const stop = vi.fn<ChatApi["stopChat"]>(async () => ({
    ...session,
    state: "paused",
    updatedAt: 3,
  }));
  window.mangaApi = createTestMangaGatewayStub({
    listChats: async () => [session],
    readChat: async () => session,
    sendChat: send,
    stopChat: stop,
    onChatEvent: (callback) => {
      emit = callback;
      return () => undefined;
    },
    getCodexAccount: async () => ({
      authenticated: true,
      accountKind: "chatgpt",
      email: null,
      planType: "plus",
      requiresOpenaiAuth: true,
      appServerVersion: "0.160.0",
      models,
    }),
    ...extra,
  });
  return { session, send, stop, emit: (event: ChatEvent) => emit(event) };
}

it("switches runtimes and logs into the chosen account, keeping new conversations in that runtime", async () => {
  const claudeAccount = {
    authenticated: false,
    email: null,
    plan: null,
    version: "test",
    models: [],
  };
  const loginClaude = vi.fn(async () => claudeAccount);
  const loginCodex = vi.fn(async () => ({
    authenticated: false,
    accountKind: null,
    email: null,
    planType: null,
    requiresOpenaiAuth: true,
    appServerVersion: "test",
    models: [],
  }));
  const create = vi.fn<ChatApi["createChat"]>(async (runtime) => ({
    ...f.session,
    id: `session-${runtime}`,
    runtime: runtime ?? "codex",
  }));
  const f = setup([], {
    createChat: create,
    getClaudeAccount: async () => claudeAccount,
    loginClaudeAccount: loginClaude,
    getCodexAccount: loginCodex,
    loginCodexAccount: loginCodex,
  });
  claudeConnection.publish(claudeAccount);
  codexConnection.publish(null);
  render(<ChatPanel enabled />);
  await screen.findByRole("button", { name: /ChatGPT.*로그인/ });
  fireEvent.click(screen.getByRole("button", { name: /ChatGPT.*로그인/ }));
  await waitFor(() => expect(loginCodex.mock.calls.length).toBeGreaterThan(1));
  chooseCustomSelectOption("대화 실행기", "Claude");
  await screen.findByRole("button", { name: /Claude.*로그인/ });
  fireEvent.click(screen.getByRole("button", { name: /Claude.*로그인/ }));
  await waitFor(() => expect(loginClaude).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
  await waitFor(() => expect(create).toHaveBeenLastCalledWith("claude"));
  chooseCustomSelectOption("대화 실행기", "Codex");
  await waitFor(() => expect(create).toHaveBeenLastCalledWith("codex"));
});
const context: CurrentViewContext = {
  workId: null,
  workTitle: "작품 A",
  chapterId: null,
  chapterTitle: "1화",
  pageId: null,
  pageNumber: 1,
  blockIds: [],
};

it("keeps a draft on panel/navigation changes and sends the new view only at send time", async () => {
  const f = setup();
  const view = render(<ChatPanel enabled context={context} />);
  const input = await screen.findByRole("textbox", { name: "메시지" });
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  fireEvent.change(input, { target: { value: "이 화 번역해줘" } });
  view.rerender(
    <ChatPanel enabled={false} context={{ ...context, workTitle: "작품 B" }} />,
  );
  view.rerender(
    <ChatPanel enabled context={{ ...context, workTitle: "작품 B" }} />,
  );
  expect((input as HTMLTextAreaElement).value).toBe("이 화 번역해줘");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(f.send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  expect(f.send.mock.calls[0][0]).toMatchObject({
    context: { workTitle: "작품 B" },
    model: "gpt-6.1-sol",
    effort: "high",
  });
  fireEvent.click(await screen.findByRole("button", { name: "중지" }));
  await waitFor(() => expect(f.stop).toHaveBeenCalledWith(f.session.id));
});
it("ignores stale session events and preserves text typed while a send is awaiting acknowledgement", async () => {
  const f = setup();
  let accept!: (value: ChatSession) => void;
  f.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  render(<ChatPanel enabled />);
  const input = await screen.findByRole("textbox", { name: "메시지" });
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  fireEvent.change(input, { target: { value: "첫 요청" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(f.send).toHaveBeenCalledOnce());
  fireEvent.change(input, { target: { value: "추가로 쓴 요청" } });
  await act(async () =>
    accept({ ...f.session, state: "running", updatedAt: 20 }),
  );
  act(() =>
    f.emit({
      sessionId: f.session.id,
      session: { ...f.session, state: "idle", updatedAt: 10 },
    }),
  );
  expect((input as HTMLTextAreaElement).value).toBe("추가로 쓴 요청");
  expect(screen.getByRole("button", { name: "추가 지시" })).toBeTruthy();
});
it("renders tables while excluding model-supplied remote images, raw controls, and scripts", () => {
  const view = render(
    <ChatMarkdown
      text={
        "| A | B |\n|---|---|\n| 1 | 2 |\n\n![track](https://example.com/track.png)\n\n<script>alert(1)</script>\n<input autofocus />"
      }
    />,
  );
  expect(screen.getByRole("table")).toBeTruthy();
  expect(view.container.querySelector("img,script,input,iframe")).toBeNull();
});
it("keeps an empty conversation free of hints and folds model choice into one chip", async () => {
  setup();
  render(
    <ChatPanel
      enabled
      context={{
        ...context,
        chapterId: "chapter-1",
        pageId: "page-1",
        blockIds: ["block-1"],
      }}
    />,
  );
  const input = await screen.findByRole("textbox", { name: "메시지" });
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  expect(input.getAttribute("placeholder")).toBe("요청 입력");
  expect(screen.getByText("1화 p.1 · 말풍선 1개")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("");
  expect(screen.getByRole("log").textContent).toBe("");
  expect(
    screen
      .getAllByRole("button")
      .some((button) => button.textContent?.includes("번역")),
  ).toBe(false);

  const chip = screen.getByRole("button", { name: /모델·추론 수준/ });
  expect(chip.textContent).toBe("GPT 6.1 SOL · 추론 높음");
  fireEvent.click(chip);
  expect(screen.getByRole("group", { name: "모델·추론 수준" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "추론 수준" })).toBeTruthy();
});
it("falls back to the model settings label without models and keeps select menus inside the popover", async () => {
  const createChat = vi.fn<ChatApi["createChat"]>(async () => ({
    ...f.session,
    id: "00000000-0000-4000-a000-000000000002",
  }));
  const f = setup([], { createChat });
  codexConnection.publish(null);
  await codexConnection.refresh();
  render(
    <ChatPanel
      enabled
      context={{ ...context, chapterId: "chapter-1", pageNumber: null }}
    />,
  );
  await screen.findByRole("textbox", { name: "메시지" });
  expect(screen.getByText("1화")).toBeTruthy();
  const chip = await screen.findByRole("button", { name: /모델·추론 수준/ });
  await waitFor(() => expect(chip.hasAttribute("disabled")).toBe(false));
  expect(chip.textContent).toBe("모델·추론 수준");
  fireEvent.click(chip);
  const popover = screen.getByRole("group", { name: "모델·추론 수준" });
  fireEvent.click(screen.getByRole("combobox", { name: "모델" }));
  const menu = document.querySelector("[data-ui-select-menu]");
  const label = menu
    ? document.createTreeWalker(menu, NodeFilter.SHOW_TEXT).nextNode()
    : null;
  if (label) fireEvent.pointerDown(label);
  if (menu) fireEvent.pointerDown(menu);
  expect(popover.isConnected).toBe(true);
  const outside = document.body.appendChild(document.createTextNode("밖"));
  fireEvent.pointerDown(outside);
  await waitFor(() => expect(popover.isConnected).toBe(false));
  outside.remove();
  fireEvent.click(chip);
  const reopened = screen.getByRole("group", { name: "모델·추론 수준" });
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(reopened.isConnected).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "새 대화" }));
  await waitFor(() => expect(createChat).toHaveBeenCalledOnce());
});
it("shows conversation messages with their context and page actions", () => {
  const onPage = vi.fn();
  const onUndo = vi.fn();
  render(
    <ChatTranscript
      session={{
        version: 1,
        id: "00000000-0000-4000-a000-000000000003",
        title: "대화",
        runtime: "codex",
        nativeThreadId: null,
        model: null,
        effort: null,
        state: "idle",
        createdAt: 1,
        updatedAt: 1,
        checkpoint: [],
        question: null,
        items: [
          {
            id: "u1",
            role: "user",
            text: "이 화 번역해줘",
            state: "completed",
            createdAt: 1,
            context: { ...context, chapterTitle: "1화" },
          },
          {
            id: "a1",
            role: "assistant",
            text: "**완료**",
            state: "completed",
            createdAt: 2,
          },
          {
            id: "t1",
            role: "tool",
            text: "{}",
            state: "completed",
            createdAt: 3,
            toolName: "carrot_apply_translation_batch",
            chapterId: "chapter-1",
            pageId: "page-1",
          },
        ],
      }}
      onPage={onPage}
      onUndo={onUndo}
    />,
  );
  expect(screen.getByText("작품 A · 1화")).toBeTruthy();
  expect(screen.getByText("완료")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /페이지 편집/ }));
  fireEvent.click(screen.getByRole("button", { name: "페이지 열기" }));
  expect(onPage).toHaveBeenCalledWith("chapter-1", "page-1");
  fireEvent.click(screen.getByRole("button", { name: "되돌리기 확인" }));
  expect(onUndo).toHaveBeenCalledOnce();
});
it("attaches pasted images but leaves plain-text paste to the input", async () => {
  const attachChatImage = vi.fn<ChatApi["attachChatImage"]>(
    async (_id, name, dataUrl) => ({ id: "image-1", name, dataUrl }),
  );
  setup(DEFAULT_MODELS, { attachChatImage });
  render(<ChatPanel enabled context={context} />);
  const input = await screen.findByRole("textbox", { name: "메시지" });
  await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
  fireEvent.paste(input, { clipboardData: { files: [] } });
  expect(attachChatImage).not.toHaveBeenCalled();
  const image = new File([new Uint8Array([137, 80, 78, 71])], "shot.png", {
    type: "image/png",
  });
  fireEvent.paste(input, { clipboardData: { files: [image] } });
  await waitFor(() => expect(attachChatImage).toHaveBeenCalledOnce());
  expect(await screen.findByRole("img", { name: "shot.png" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이미지 제거" }));
  expect(screen.queryByRole("img", { name: "shot.png" })).toBeNull();
});
it("starts chat at high reasoning when the model supports it", async () => {
  setup([
    {
      id: "gpt-6.1-sol",
      displayName: "GPT 6.1 SOL",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "low",
      isDefault: true,
    },
    {
      id: "gpt-mini",
      displayName: "GPT Mini",
      supportedReasoningEfforts: ["low", "medium"],
      defaultReasoningEffort: "medium",
      isDefault: false,
    },
  ]);
  codexConnection.publish(null);
  await codexConnection.refresh();
  render(<ChatPanel enabled context={context} />);
  const chip = await screen.findByRole("button", { name: /모델·추론 수준/ });
  await waitFor(() => expect(chip.textContent).toBe("GPT 6.1 SOL · 추론 높음"));
  fireEvent.click(chip);
  fireEvent.click(screen.getByRole("combobox", { name: "모델" }));
  fireEvent.click(await screen.findByRole("option", { name: "GPT Mini" }));
  await waitFor(() => expect(chip.textContent).toBe("GPT Mini · 추론 중간"));
});
