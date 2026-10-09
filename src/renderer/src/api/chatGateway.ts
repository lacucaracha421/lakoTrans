import { createMangaDomainGateway } from "./mangaGateway";

export const chatGateway = createMangaDomainGateway("chat", [
  "listChats",
  "createChat",
  "readChat",
  "sendChat",
  "stopChat",
  "compactChat",
  "answerChat",
  "attachChatImage",
  "readChatImage",
  "onChatEvent",
]);
