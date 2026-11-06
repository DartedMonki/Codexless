import { randomUUID } from "node:crypto";

const result = (payload, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload, isError,
});

export function createLocalCommandJobs({ yieldMs = 5_000, maxJobs = 32, ttlMs = 3_600_000, now = Date.now, onTransition = null } = {}) {
  const jobs = new Map();
  function emit(jobRef, job) {
    try { onTransition?.({ jobRef, status: job.output ? "completed" : job.status, elapsedMs: (job.finishedAt ?? now()) - job.createdAt,
      exitCode: job.output?.structuredContent?.exitCode ?? null, isError: job.output?.isError ?? null }); } catch {}
  }
  function prune() {
    for (const [ref, job] of jobs) if (job.finishedAt !== null && now() - job.finishedAt > ttlMs) jobs.delete(ref);
  }
  function poll(jobRef) {
    prune();
    const job = jobs.get(jobRef);
    if (!job) return result({ status: "unknown", jobRef, message: "Job is unknown, expired, or the local service restarted. Do not automatically replay the original command." }, true);
    if (job.output) return result({ ...job.output.structuredContent, jobRef, status: "completed", elapsedMs: job.finishedAt - job.createdAt }, job.output.isError === true);
    return result({ status: job.status, jobRef, ...job.metadata, elapsedMs: now() - job.createdAt,
      nextActions: ["Poll codex.command_status with this exact jobRef. Do not rerun the command. Results are retained in memory for one hour after completion; a service restart loses them."] });
  }
  return {
    poll,
    async start(execute, metadata = {}) {
      prune();
      if (jobs.size >= maxJobs) return result({ status: "busy", message: "Local command job capacity reached; no command was dispatched." }, true);
      const jobRef = `command_${randomUUID()}`;
      const job = { status: "queued", createdAt: now(), finishedAt: null, metadata, output: null };
      jobs.set(jobRef, job);
      emit(jobRef, job);
      const completed = Promise.resolve().then(() => execute(() => { job.status = "running"; emit(jobRef, job); })).then(
        output => { job.output = output; job.finishedAt = now(); emit(jobRef, job); return output; },
        error => { job.output = result({ error: error instanceof Error ? error.message : String(error) }, true); job.finishedAt = now(); emit(jobRef, job); return job.output; },
      );
      let timer;
      try {
        const output = await Promise.race([completed, new Promise(resolve => { timer = setTimeout(() => resolve(null), yieldMs); })]);
        if (output) { jobs.delete(jobRef); return output; }
        return poll(jobRef);
      } finally { clearTimeout(timer); }
    },
  };
}

export function createCommandSlots({ maxConcurrent, maxQueued = 8, queueWaitMs = 30_000 }) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < maxConcurrent) { active++; return; }
      if (queue.length >= maxQueued) throw new Error("Command queue is full; this command was not dispatched.");
      await new Promise((resolve, reject) => {
        const entry = { resolve: () => { clearTimeout(entry.timer); resolve(); }, timer: null };
        entry.timer = setTimeout(() => {
          queue.splice(queue.indexOf(entry), 1);
          reject(new Error("Command queue wait exceeded 30 seconds; this command was not dispatched."));
        }, queueWaitMs);
        queue.push(entry);
      });
    },
    release() { const next = queue.shift(); if (next) next.resolve(); else active--; },
  };
}
