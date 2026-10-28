export function responseDeadline(streaming: boolean) {
  const controller = new AbortController();
  let kind: "idle" | "total" | null = null;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let chunks = 0;
  const abort = (value: "idle" | "total") => {
    kind ??= value;
    controller.abort(
      new DOMException("LLM応答の待機上限に達しました", "TimeoutError"),
    );
  };
  const total = setTimeout(() => abort("total"), streaming ? 600_000 : 180_000);
  total.unref();
  const arm = () => {
    if (!streaming) return;
    clearTimeout(idle);
    idle = setTimeout(() => abort("idle"), 180_000);
    idle.unref();
  };
  arm();
  return {
    signal: controller.signal,
    touch() {
      chunks++;
      arm();
    },
    get timeoutKind() {
      return kind;
    },
    get receivedChunks() {
      return chunks;
    },
    close() {
      clearTimeout(total);
      clearTimeout(idle);
    },
  };
}
