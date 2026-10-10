import { McpTranslationCompletionSchema } from "../../../../shared/mcpTranslationGuide";

/** The native completion record a translation guide call carries, if any. */
export function parseQualityReceipt(text: string) {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || !("completion" in value))
      return null;
    const parsed = McpTranslationCompletionSchema.safeParse(value.completion);
    return parsed.success ? parsed.data : null;
  } catch (_error) {
    // error-policy-allow: unstructured tool output has no quality receipt.
    return null;
  }
}
