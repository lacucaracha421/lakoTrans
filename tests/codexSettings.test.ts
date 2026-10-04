import { expect, it } from "vitest";
import { isCodexImageModel } from "../src/shared/codexSettings";

it.each([
  ["gpt-5", false],
  ["gpt-5.5", false],
  ["gpt-5.6", true],
  ["gpt-5.6-codex", true],
  ["gpt-6", true],
  ["gpt-4.9", false],
  ["not-a-model", false],
  [null, false],
])("classifies image support for %s as %s", (model, supported) => {
  expect(isCodexImageModel(model)).toBe(supported);
});
