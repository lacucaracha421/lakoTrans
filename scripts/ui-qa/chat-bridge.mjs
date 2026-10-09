/** Browser-only fixture for the production chat panel; no model or library writes. */
export const chatBridgeSource = `
  const chatId = "7a364663-b07b-4c50-a8a4-37967b3f263d";
  const chatImageId = "3e428a16-da20-4cce-bb90-094a847a7db0";
  const chatListeners = new Set();
  const chatImages = new Map([[chatImageId, { id: chatImageId, name: "최종 페이지 미리보기", dataUrl: pageImageDataUrl }]]);
  const chatSessions = new Map();
  const initialChat = { version: 1, id: chatId, title: "두 작품의 번역과 폰트 비교", runtime: "codex", nativeThreadId: "qa-native", model: null, effort: null, state: "idle", createdAt: 1, updatedAt: 1, checkpoint: [], question: null,
    items: [
      { id: "user1", role: "user", state: "completed", createdAt: 1, text: "이 화를 번역하고 다른 작품의 글꼴과 비교해줘." },
      { id: "tool1", role: "tool", toolName: "carrot_render_page_preview", state: "completed", createdAt: 2, text: JSON.stringify({ revision: "page-v1:qa", layout: { overflow: false } }), imageIds: [chatImageId] },
      { id: "reply", role: "assistant", state: "completed", createdAt: 3, text: "6페이지의 번역과 배치를 저장했습니다.\\n\\n| 역할 | 이번 작품 | 비교 작품 |\\n| --- | --- | --- |\\n| 대사 | 둥근 고딕 | 명조 |\\n| 독백 | 가벼운 고딕 | 손글씨 |\\n\\n**남은 확인**\\n\\n- 3페이지 효과음은 사용자가 보정할 수 있도록 보존했습니다.\\n- 미해결 글자 오류가 있어 정밀 검수 완료로 표시하지 않았습니다." }
    ] };
  chatSessions.set(chatId, initialChat);
  const publishChat = (session) => { session.updatedAt = Date.now(); for (const listener of chatListeners) listener({ sessionId: session.id, session: structuredClone(session) }); return structuredClone(session); };
  const chatApi = {
    listChats: async () => [...chatSessions.values()].map(({ id, title, state, updatedAt, model, effort }) => ({ id, title, state, updatedAt, model, effort })),
    createChat: async () => { const value = { ...initialChat, id: crypto.randomUUID(), title: "새 대화", items: [], updatedAt: Date.now() }; chatSessions.set(value.id, value); return structuredClone(value); },
    readChat: async (id) => structuredClone(chatSessions.get(id)),
    sendChat: async (request) => { const value = chatSessions.get(request.sessionId); value.items.push({ id: request.messageId, role: "user", text: request.text, imageIds: request.imageIds, context: request.context, createdAt: Date.now(), state: "completed" }); value.state = "running"; return publishChat(value); },
    stopChat: async (id) => { const value = chatSessions.get(id); value.state = "paused"; return publishChat(value); },
    compactChat: async (id) => { const value = chatSessions.get(id); value.state = "compacting"; return publishChat(value); },
    answerChat: async (id) => publishChat(chatSessions.get(id)),
    attachChatImage: async (_id, name, dataUrl) => { const image = { id: crypto.randomUUID(), name, dataUrl }; chatImages.set(image.id, image); return image; },
    readChatImage: async (_id, id) => chatImages.get(id),
    onChatEvent: (callback) => { chatListeners.add(callback); return () => chatListeners.delete(callback); }
  };
`;
