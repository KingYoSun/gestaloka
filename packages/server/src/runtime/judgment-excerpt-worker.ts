import { createHash } from "node:crypto";
import { semanticConfig } from "../world/judgment-semantic.js";
import type { LlmClient } from "../llm/client.js";
import { buildJudgmentExcerpts } from "../llm/judgment-excerpts.js";
import { derivedId, type WorldStore } from "../world/store.js";
import { RuntimeControl, RuntimeStopped } from "./control.js";

export class JudgmentExcerptWorker {
  constructor(
    readonly store: WorldStore,
    readonly model: LlmClient,
  ) {}

  async tick(worldId?: string) {
    const configured = this.model.decision;
    if (!configured && !semanticConfig()) return;
    try {
      await RuntimeControl.check(this.model.ledger.pool);
    } catch (error) {
      if (error instanceof RuntimeStopped && error.code === "MAINTENANCE")
        return;
      throw error;
    }
    // An unavailable local encoder must not prevent ordinary excerpt preparation.
    await this.store
      .indexJudgmentExperience(worldId)
      .catch((error: unknown) => console.error(error));
    await this.store
      .indexScopedJudgmentEdges(worldId)
      .catch((error: unknown) => console.error(error));
    if (!configured) return;
    const [job] = await this.store.judgmentExcerptJobs(1, worldId);
    if (!job) return;
    const requestId = derivedId(
      `judgment-excerpt:${job.worldId}:${job.sourceHash}:${configured.model}`,
    );
    const excerpts = await this.model.run(
      requestId,
      () =>
        buildJudgmentExcerpts([job.text], async (state, questions, batch) => {
          const hash = createHash("sha256")
            .update(JSON.stringify([state, questions]))
            .digest("hex");
          for (let attempt = 0; attempt < 3; attempt++) {
            const id = derivedId(`${requestId}:${batch}:${hash}:${attempt}`);
            const reply = await this.model
              .decide(id, "world-judgment-excerpt", state, questions)
              .catch(() => undefined);
            if (reply && Object.keys(questions).every((key) => key in reply))
              return reply;
            // An unsettled response may already be billed. Reclaiming the job
            // must use the same call ID until the ledger can resolve it.
            if ((await this.model.ledger.state(id)) !== "complete") return;
          }
        }),
      job.worldId,
    );
    const excerpt = excerpts.get(job.text);
    if (excerpt !== undefined)
      await this.store.finishJudgmentExcerpt(job, excerpt);
  }
}
