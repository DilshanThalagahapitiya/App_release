import { api, Created } from "@/lib/http";
import { workerCreateSchema } from "@/lib/schemas";
import { listWorkers, processingStats, registerWorker, listJobs } from "@/services/worker";
export const GET = api(async (c) => ({ workers: await listWorkers(c.env, c.user()), stats: await processingStats(c.env), jobs: await listJobs(c.env, c.user(), { limit: 30 }) }));
export const POST = api(async (c) => new Created(await registerWorker(c.env, c.user(), (await c.body(workerCreateSchema)).name, c.req)));
