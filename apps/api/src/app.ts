import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { fastifySSE } from "@fastify/sse";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import { Health, HealthEvent } from "@gestaloka/contracts";
import type { WorldAccess } from "@gestaloka/server/access";
import { worldRoutes } from "./world-routes.js";
import type { OryIdentity } from "@gestaloka/server/identity";
import { authRoutes } from "./auth-routes.js";
import type { Operations } from "@gestaloka/server/operations";
import { operationsRoutes } from "./operations-routes.js";
import { mcpRoutes } from "./mcp-routes.js";

export async function createApp(
  access?: WorldAccess,
  identity?: OryIdentity,
  hydraAdminUrl?: string,
  operations?: Operations,
  trustProxy = false,
) {
  const app = Fastify({ trustProxy }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(swagger, {
    openapi: { info: { title: "GESTALOKA", version: "3.0.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(fastifySSE);
  const health = () => Health.parse({ service: "gestaloka", status: "ok" });
  app.get("/api/health", { schema: { response: { 200: Health } } }, health);
  app.get(
    "/api/health/events",
    { sse: "only", schema: { hide: true } },
    async (_request, reply) => {
      const event = HealthEvent.parse({ type: "health", data: health() });
      await reply.sse.send({ event: event.type, data: event });
    },
  );
  await worldRoutes(app, access, identity, operations);
  await mcpRoutes(app, operations, access);
  await app.register(async (scope) =>
    operationsRoutes(scope, identity, operations, access?.players),
  );
  if (identity)
    await app.register(async (scope) =>
      authRoutes(scope, identity, hydraAdminUrl, operations),
    );
  await app.ready();
  return app;
}
