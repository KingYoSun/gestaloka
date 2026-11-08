// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { AiParticipationInvitation } from "../../apps/web/src/ai-participation.js";
import { userApp } from "../../apps/web/src/surface.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("発行済みの招待と任意の世界を、一つのAI向け案内にまとめる", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  render(<AiParticipationInvitation invitation="private-invitation" />);
  fireEvent.change(screen.getByLabelText("参加する世界のページ"), {
    target: {
      value: "https://example.test/worlds/00000000-0000-4000-8000-000000000001",
    },
  });
  fireEvent.submit(
    screen
      .getByRole("button", { name: "AIに渡す参加案内をコピー" })
      .closest("form")!,
  );
  await waitFor(() => expect(copy).toHaveBeenCalledOnce());
  const url = new URL(String(copy.mock.calls[0]![0]).split("\n").at(-1)!);
  expect(url.origin).toBe(new URL(userApp).origin);
  expect(url.pathname).toBe("/api/player-cli/join");
  expect(url.searchParams.get("world")).toBe(
    "00000000-0000-4000-8000-000000000001",
  );
  expect(url.searchParams.has("invitation")).toBe(false);
  expect(new URLSearchParams(url.hash.slice(1)).get("invitation")).toBe(
    "private-invitation",
  );
});
