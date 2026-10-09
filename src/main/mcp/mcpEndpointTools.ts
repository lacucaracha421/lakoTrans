import type { McpTool } from "./mcpReadTools";

/** An endpoint changes capability URLs, never native tool contracts or ownership. */
export function mcpEndpointTools(
  tools: readonly McpTool[],
  nativeOrigin: string,
  endpointOrigin: string,
): McpTool[] {
  return tools.map((tool) => ({
    ...tool,
    invoke: async (args, context) => {
      const input = mapValue(args, endpointOrigin, nativeOrigin) as Record<
        string,
        unknown
      >;
      const result = await tool.invoke(input, context);
      return result.map((item) => {
        if (item.type === "image") return item;
        if (item.type === "resource_link")
          return {
            ...item,
            uri: mapUrl(item.uri, nativeOrigin, endpointOrigin),
          };
        let value: unknown;
        try {
          value = JSON.parse(item.text);
        } catch (_error) {
          // error-policy-allow: prose MCP content is not a structured artifact reference.
          return item;
        }
        return {
          ...item,
          text: JSON.stringify(mapValue(value, nativeOrigin, endpointOrigin)),
        };
      });
    },
  }));
}

function mapUrl(value: string, from: string, to: string): string {
  return value.startsWith(`${from}/`)
    ? `${to}${value.slice(from.length)}`
    : value;
}
function mapValue(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") return mapUrl(value, from, to);
  if (Array.isArray(value))
    return value.map((item) => mapValue(item, from, to));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, mapValue(item, from, to)]),
  );
}
