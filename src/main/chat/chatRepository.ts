import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ChatImageSchema, ChatSessionSchema } from "../../shared/chatSchemas";
import type { ChatImage, ChatSession } from "../../shared/chatTypes";
import {
  writeDurableJsonFile,
  assertPathWithinRootWithoutSymlinks,
} from "../libraryStore/libraryTransactionStorage";

/** Global app data; no manga directory, source file or linked output is written. */
export class ChatRepository {
  private readonly root: string;
  private readonly writes = new Map<string, Promise<void>>();
  constructor(dataRoot: string) {
    this.root = join(dataRoot, "chat");
  }
  async list(): Promise<ChatSession[]> {
    await mkdir(this.root, { recursive: true });
    const names = await readdir(this.root);
    const sessions = await Promise.all(
      names
        .filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
        .map((name) => this.read(name.slice(0, -5))),
    );
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async read(id: string): Promise<ChatSession> {
    return ChatSessionSchema.parse(
      JSON.parse(
        await readFile(await this.path(`${checkedId(id)}.json`), "utf8"),
      ),
    );
  }
  save(session: ChatSession): Promise<void> {
    const snapshot = structuredClone(ChatSessionSchema.parse(session));
    const previous = this.writes.get(session.id) ?? Promise.resolve();
    const next = previous.then(async () =>
      writeDurableJsonFile(
        await this.path(`${checkedId(snapshot.id)}.json`),
        snapshot,
      ),
    );
    this.writes.set(session.id, next);
    void next
      .finally(() => {
        if (this.writes.get(session.id) === next)
          this.writes.delete(session.id);
      })
      .catch(() => {
        // error-policy-allow: the original write rejection is returned to the caller.
      });
    return next;
  }
  async addImage(
    sessionId: string,
    name: string,
    dataUrl: string,
  ): Promise<ChatImage> {
    await this.read(sessionId);
    if (
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) ||
      dataUrl.length > 28 * 1024 * 1024
    )
      throw new Error("PNG, JPEG, WebP 이미지를 20 MB 이하로 첨부해 주세요.");
    const image = { id: randomUUID(), name, dataUrl };
    await writeDurableJsonFile(
      await this.path(`${sessionId}/${image.id}.json`),
      image,
    );
    return image;
  }
  async image(sessionId: string, imageId: string): Promise<ChatImage> {
    return ChatImageSchema.parse(
      JSON.parse(
        await readFile(
          await this.path(`${checkedId(sessionId)}/${checkedId(imageId)}.json`),
          "utf8",
        ),
      ),
    );
  }
  private async path(name: string) {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, name);
    await assertPathWithinRootWithoutSymlinks(this.root, path, {
      allowMissingTarget: true,
    });
    return path;
  }
}
function checkedId(value: string) {
  return z.string().uuid().parse(value);
}
