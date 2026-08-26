import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  keepAlive: 10000
});

redis.on("error", (error) => {
  console.error("Redis/Valkey error:", error.message);
});

export async function checkRedis() {
  return redis.ping();
}
