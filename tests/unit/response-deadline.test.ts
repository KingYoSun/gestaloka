import { afterEach, expect, test, vi } from "vitest";
import { responseDeadline } from "../../packages/server/src/llm/response-deadline.js";
afterEach(() => vi.useRealTimers());
test("受信中のストリームを固定3分で打ち切らず、受信停止は3分で止める", async () => {
  vi.useFakeTimers();
  const deadline = responseDeadline(true);
  for (let i = 0; i < 2; i++) {
    await vi.advanceTimersByTimeAsync(120_000);
    deadline.touch();
  }
  expect(deadline.signal.aborted).toBe(false);
  expect(deadline.receivedChunks).toBe(2);
  await vi.advanceTimersByTimeAsync(180_000);
  expect(deadline.signal.aborted).toBe(true);
  expect(deadline.timeoutKind).toBe("idle");
  deadline.close();
});
test("受信が続いても10分の全体上限で止め、非ストリームは3分を保つ", async () => {
  vi.useFakeTimers();
  const stream = responseDeadline(true),
    plain = responseDeadline(false);
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(120_000);
    stream.touch();
    plain.touch();
  }
  expect(stream.signal.aborted).toBe(true);
  expect(stream.timeoutKind).toBe("total");
  expect(plain.signal.aborted).toBe(true);
  stream.close();
  plain.close();
});
test("完了時に監視を解除すると後から中断しない", async () => {
  vi.useFakeTimers();
  const deadline = responseDeadline(true);
  deadline.close();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(deadline.signal.aborted).toBe(false);
});
