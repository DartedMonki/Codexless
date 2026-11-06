export function localCommandTimeoutFromEnv(env = process.env) {
  const raw = env.CODEXLESS_COMMAND_MAX_TIMEOUT_MS;
  if (raw === undefined || raw === "") return 30_000;
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 30_000 || value > 600_000) {
    throw new Error("CODEXLESS_COMMAND_MAX_TIMEOUT_MS must be an integer between 30000 and 600000");
  }
  return value;
}

export function localCommandJobsFromEnv(env = process.env) {
  const flag = env.CODEXLESS_COMMAND_JOBS;
  if (flag !== undefined && !["", "0", "1"].includes(flag)) throw new Error("CODEXLESS_COMMAND_JOBS must be 0 or 1");
  return flag === "1";
}

export function localCommandConcurrencyFromEnv(env = process.env) {
  const raw = env.CODEXLESS_COMMAND_MAX_CONCURRENT;
  if (raw === undefined || raw === "") return 1;
  if (!/^[1-4]$/.test(raw)) throw new Error("CODEXLESS_COMMAND_MAX_CONCURRENT must be an integer between 1 and 4");
  return Number(raw);
}

export function localMcpGuidanceFromEnv(env = process.env) {
  const value = env.CODEXLESS_LOCAL_MCP_GUIDANCE;
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("CODEXLESS_LOCAL_MCP_GUIDANCE must be a single line of at most 2048 characters");
  }
  return value.trim();
}
