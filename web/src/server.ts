import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerRoutes } from "./routes.js";
import { REPO_ROOT } from "./hermes.js";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await app.register(cors, { origin: true });
await registerRoutes(app);

const distDir = join(REPO_ROOT, "web", "dist");
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.callNotFound();
    }
    return reply.sendFile("index.html");
  });
}

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
  console.log(`\nXBLOOM loop 服务已启动:`);
  console.log(`  本机:    http://127.0.0.1:${port}`);
  console.log(`  局域网:  http://<这台 Mac 的 IP>:${port}`);
  console.log(`  前端开发: npm run dev (vite, 端口 5173)\n`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
