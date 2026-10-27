// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { InspectionResults } from "../../apps/web/src/inspection.js";
import { inspectionFixture } from "../fixtures/inspection.js";
import { measure } from "../../packages/server/src/inspection/measure.js";
import { entries } from "../../packages/server/src/inspection/store.js";
afterEach(cleanup);
test("欠測と別系列を表示し、元の提示と意味評価へ辿れる", () => {
  const fixture = inspectionFixture(),
    m = measure(fixture),
    onUse = vi.fn();
  render(
    <InspectionResults
      onUse={onUse}
      value={{
        kind: "inspection-history",
        summary: [
          {
            seriesId: "a",
            manifestIds: [fixture.id],
            windows: 1,
            measuredWindows: 0,
            missingWindows: 1,
            mean: null,
            median: null,
            p10: null,
            distribution: [],
            uniqueScenes: 1,
            uniqueInputs: 9,
            uniqueCalls: 1,
            calculatedNanoUsd: null,
            longestLowRun: 1,
            metricVersion: m.metricVersion,
            n: 1,
            weights: m.weights,
            semanticSeries: [],
          },
        ],
        items: [
          {
            id: fixture.id,
            at: fixture.capturedAt,
            selection: fixture.selection,
            measurement: { ...m, total: { ...m.total, value: null } },
            evaluations: [
              {
                id: fixture.scenes[0]!.id,
                status: "partial",
                result: {
                  model: "fixture-model",
                  skill: { rubricVersion: "meaning-v1" },
                },
              },
            ],
          },
        ],
        batches: [{ eligible: 2, selected: 1, evaluated: 0, unevaluated: 2 }],
      }}
    />,
  );
  expect(screen.getByText(/^平均 欠測/)).toBeTruthy();
  expect(screen.getByRole("img", { name: /移動量の時系列/ })).toBeTruthy();
  fireEvent.click(screen.getByText("提示と根拠"));
  expect(onUse).toHaveBeenCalledWith({
    operation: "inspection.read",
    worldId: fixture.selection.worldId,
    manifestId: fixture.id,
  });
  fireEvent.click(screen.getByText("評価の根拠と費用"));
  expect(onUse).toHaveBeenLastCalledWith({
    operation: "inspection.evaluation",
    worldId: fixture.selection.worldId,
    id: fixture.scenes[0]!.id,
  });
});
test("提示本文と内部根拠を区別し、部分取得を表示する", () => {
  const m = inspectionFixture(),
    measurement = measure(m);
  const header = Object.fromEntries(
    Object.entries(m).filter(([key]) => key !== "prior" && key !== "scenes"),
  );
  render(
    <InspectionResults
      value={{
        manifest: {
          ...header,
          sceneOrder: m.scenes.map((s) => ({
            id: s.id,
            revision: s.revision,
            state: s.state,
          })),
        },
        measurement,
        items: entries(m),
        next: 50,
        fetched: { offset: 0, count: 50, total: 80, complete: false },
        retention: "fixture",
      }}
    />,
  );
  expect(screen.getByText(/続きあり/)).toBeTruthy();
  expect(screen.getAllByText("本人への提示")).toHaveLength(9);
  expect(screen.getAllByText("管理者向けの検品根拠").length).toBeGreaterThan(0);
  expect(screen.getByText("扉は開いた。")).toBeTruthy();
});
