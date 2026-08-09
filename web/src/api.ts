async function handleError(resp: Response): Promise<never> {
  const text = await resp.text();
  if (/session expired|身份验证已过期|请重新登录|Not logged in/i.test(text)) {
    window.dispatchEvent(new CustomEvent("xbloom:needauth"));
  }
  throw new Error(text);
}

export async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url);
  if (!resp.ok) return handleError(resp);
  return resp.json() as Promise<T>;
}

export async function post<T>(url: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const resp = await fetch(url, {
    method: "POST",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) return handleError(resp);
  return resp.json() as Promise<T>;
}

export async function del<T>(url: string): Promise<T> {
  const resp = await fetch(url, { method: "DELETE" });
  if (!resp.ok) return handleError(resp);
  return resp.json() as Promise<T>;
}

export interface Job<T = unknown> {
  id: string;
  status: "running" | "done" | "error";
  result?: T | string;
  error?: string;
}

export async function pollJob<T = unknown>(
  jobId: string,
  onDone: (result: T) => void,
  onError: (err: string) => void,
  onRunning?: () => void,
): Promise<void> {
  const timer = setInterval(async () => {
    try {
      const job = await get<Job<T>>(`/api/jobs/${jobId}`);
      if (job.status === "running") {
        onRunning?.();
        return;
      }
      clearInterval(timer);
      if (job.status === "done") onDone(job.result as T);
      else onError(job.error ?? "任务失败");
    } catch (e) {
      clearInterval(timer);
      onError(e instanceof Error ? e.message : String(e));
    }
  }, 2000);
}
