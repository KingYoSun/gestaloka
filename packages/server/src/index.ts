import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import neo4j from "neo4j-driver";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { z } from "zod";

const Environment = z.object({
  DATABASE_URL: z.url(),
  NEO4J_URI: z.string().default("bolt://127.0.0.1:27687"),
  NEO4J_USER: z.string().default("neo4j"),
  NEO4J_PASSWORD: z.string().min(1),
});

export function connectDatabases(environment: NodeJS.ProcessEnv = process.env) {
  const config = Environment.parse(environment);
  const postgres = new pg.Pool({ connectionString: config.DATABASE_URL });
  const graph = neo4j.driver(
    config.NEO4J_URI,
    neo4j.auth.basic(config.NEO4J_USER, config.NEO4J_PASSWORD),
  );
  return {
    postgres,
    graph,
    queue: new PgBoss(config.DATABASE_URL),
    checkpointer: new PostgresSaver(postgres),
    async verify() {
      await Promise.all([
        postgres.query("SELECT 1"),
        graph.verifyConnectivity(),
      ]);
    },
    async close() {
      await Promise.all([postgres.end(), graph.close()]);
    },
  };
}
