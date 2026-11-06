// Shared by both server factories and both HTTP protocol paths. Large Excel
// operations can be split into smaller calls when they exceed these budgets.
export const MCP_INPUT_LIMITS = Object.freeze({
  maxRequestBodySize: 2 * 1024 * 1024,
  maxToolInputElements: 50_000,
  maxBatchMessages: 100,
  maxRequestElements: 100_000,
  maxJsonDepth: 64,
});

// Check before protocol classification and schema validation. Count iteratively
// so deeply nested JSON cannot overflow the JavaScript call stack.
export function validateMcpRequestBody(body) {
  if (Array.isArray(body) && body.length > MCP_INPUT_LIMITS.maxBatchMessages) {
    return "MCP batch exceeds the 100-message transport limit";
  }
  const pending = [{ value: body, depth: 0 }];
  let elements = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (value === null || typeof value !== "object") continue;
    if (depth > MCP_INPUT_LIMITS.maxJsonDepth) {
      return "MCP request exceeds the JSON nesting limit";
    }
    const keys = Object.keys(value);
    elements += keys.length;
    if (elements > MCP_INPUT_LIMITS.maxRequestElements) {
      return "MCP request exceeds the collection-element limit";
    }
    for (const key of keys) {
      const child = value[key];
      if (child !== null && typeof child === "object") {
        pending.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return null;
}
