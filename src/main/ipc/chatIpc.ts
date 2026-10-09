import { chatIpcContracts } from "../../shared/ipcChatContracts";
import type { IpcContext } from "./context";
import { trustedHandleContract } from "./trustedIpc";

export function registerChatIpc(context: IpcContext) {
  const service = () => {
    if (!context.chat) throw new Error("채팅 서비스가 준비되지 않았습니다.");
    return context.chat;
  };
  trustedHandleContract(context, chatIpcContracts.listChats, () =>
    service().list(),
  );
  trustedHandleContract(context, chatIpcContracts.createChat, () =>
    service().create(),
  );
  trustedHandleContract(context, chatIpcContracts.readChat, (_event, id) =>
    service().read(id),
  );
  trustedHandleContract(context, chatIpcContracts.sendChat, (_event, request) =>
    service().send(request),
  );
  trustedHandleContract(context, chatIpcContracts.stopChat, (_event, id) =>
    service().stop(id),
  );
  trustedHandleContract(context, chatIpcContracts.compactChat, (_event, id) =>
    service().compact(id),
  );
  trustedHandleContract(
    context,
    chatIpcContracts.answerChat,
    (_event, id, question, answers) => service().answer(id, question, answers),
  );
  trustedHandleContract(
    context,
    chatIpcContracts.attachChatImage,
    (_event, id, name, data) => service().attachImage(id, name, data),
  );
  trustedHandleContract(
    context,
    chatIpcContracts.readChatImage,
    (_event, id, image) => service().image(id, image),
  );
}
