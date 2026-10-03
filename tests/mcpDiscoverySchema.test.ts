import { expect, it } from "vitest";
import { z } from "zod/v4";
import {
  mcpOutputSchemas,
  mcpToolOutputSchema,
} from "../src/main/mcp/mcpOutputSchemas";

// Characterize the public error envelope independently of discovery encoding.
const error = z
  .object({
    error: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    nextAction: z.string(),
    issues: z
      .array(
        z
          .object({
            field: z.string(),
            code: z.string(),
            expected: z.string().optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
  })
  .strict();

function expandLocalRefs(
  value: unknown,
  root: Record<string, unknown>,
  seen = new Map<string, string>(),
  path = "#",
): unknown {
  if (Array.isArray(value))
    return value.map((item, index) =>
      expandLocalRefs(item, root, seen, `${path}/${index}`),
    );
  if (!value || typeof value !== "object") return value;
  const {
    $defs: _definitions,
    $ref,
    ...fields
  } = value as Record<string, unknown>;
  const expanded = Object.fromEntries(
    Object.entries(fields).map(([key, item]) => [
      key,
      expandLocalRefs(item, root, seen, `${path}/${key}`),
    ]),
  );
  if ($ref === undefined) return normalizeNumericBounds(expanded);
  expect($ref).toMatch(/^#\/\$defs\/[^/]+$/);
  const reference = $ref as string;
  const name = reference.slice("#/$defs/".length);
  const definitions = root.$defs as Record<string, unknown> | undefined;
  expect(definitions).toHaveProperty(name);
  // The existing arbitrary JSON value contracts are recursive. Retain their
  // cycles at the expanded location, independent of generated definition IDs.
  if (seen.has(reference)) return { $ref: seen.get(reference), ...expanded };
  return normalizeNumericBounds({
    ...(expandLocalRefs(
      definitions?.[name],
      root,
      new Map([...seen, [reference, path]]),
      path,
    ) as Record<string, unknown>),
    ...expanded,
  });
}

// Zod 4 may retain the inclusive bound of a reused schema alongside a stricter
// exclusive bound. Compare those equivalent constraints without discarding any
// bound that actually restricts the accepted values.
function normalizeNumericBounds(schema: Record<string, unknown>) {
  for (const [inclusive, exclusive, direction] of [
    ["minimum", "exclusiveMinimum", 1],
    ["maximum", "exclusiveMaximum", -1],
  ] as const) {
    const a = schema[inclusive];
    const b = schema[exclusive];
    if (
      typeof a === "number" &&
      typeof b === "number" &&
      direction * b >= direction * a
    )
      delete schema[inclusive];
  }
  return schema;
}

it("only removes inclusive numeric bounds dominated by exclusive bounds", () => {
  expect(normalizeNumericBounds({ minimum: 0, exclusiveMinimum: 0 })).toEqual({
    exclusiveMinimum: 0,
  });
  expect(normalizeNumericBounds({ minimum: 1, exclusiveMinimum: 0 })).toEqual({
    minimum: 1,
    exclusiveMinimum: 0,
  });
  expect(normalizeNumericBounds({ maximum: 5, exclusiveMaximum: 4 })).toEqual({
    exclusiveMaximum: 4,
  });
  expect(normalizeNumericBounds({ maximum: 3, exclusiveMaximum: 4 })).toEqual({
    maximum: 3,
    exclusiveMaximum: 4,
  });
});

it("compacts every output without changing its self-contained JSON Schema contract", () => {
  let inlineBytes = 0;
  let compactBytes = 0;
  for (const [name, schema] of Object.entries(mcpOutputSchemas)) {
    const compact = mcpToolOutputSchema(name);
    expect(compact, name).toBeDefined();
    if (!compact) throw new Error(`Missing schema: ${name}`);
    const inline = {
      ...z.toJSONSchema(z.union([schema, error])),
      type: "object",
    };
    expect(expandLocalRefs(compact, compact), name).toEqual(
      expandLocalRefs(inline, inline),
    );
    inlineBytes += Buffer.byteLength(JSON.stringify(inline));
    compactBytes += Buffer.byteLength(JSON.stringify(compact));
  }
  expect(compactBytes).toBeLessThan(inlineBytes);
});
