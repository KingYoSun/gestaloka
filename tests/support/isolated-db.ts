import { randomUUID } from "node:crypto";
import { connectDatabases } from "@gestaloka/server";

export function isolatedDatabases(): {
  databases: ReturnType<typeof connectDatabases>;
  setup: () => Promise<unknown>;
  close: () => Promise<void>;
} {
  const schema = `runtime_test_${randomUUID().replaceAll("-", "")}`;
  const root = connectDatabases();
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema}`);
  const databases = connectDatabases({
    ...process.env,
    DATABASE_URL: url.toString(),
  });
  return {
    databases,
    setup: () => root.postgres.query(`CREATE SCHEMA ${schema}`),
    close: async () => {
      await databases.close();
      await root.postgres.query(`DROP SCHEMA ${schema} CASCADE`);
      await root.close();
    },
  };
}
