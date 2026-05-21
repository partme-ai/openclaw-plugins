/**
 * Type declarations for aedes persistence backends
 */

// Redis
declare module "aedes-persistence-redis" {
  import { Redis } from "ioredis";

  interface RedisPersistenceOptions {
    redis: Redis;
    prefix?: string;
    ttl?: {
      subscriptions?: number;
      packets?: number;
      messages?: number;
    };
  }

  function RedisPersistence(options: RedisPersistenceOptions): unknown;
  export = RedisPersistence;
}

// MQEmitter Redis
declare module "mqemitter-redis" {
  import { Redis } from "ioredis";

  interface MQEmitterRedisOptions {
    redis: Redis;
  }

  function MQEmitterRedis(options: MQEmitterRedisOptions): unknown;
  export = MQEmitterRedis;
}

// MongoDB
declare module "aedes-persistence-mongodb" {
  interface MongoDbPersistenceOptions {
    url?: string;
    collection?: string;
  }

  function MongoDbPersistence(options?: MongoDbPersistenceOptions): unknown;
  export = MongoDbPersistence;
}

// LevelDB
declare module "aedes-persistence-level" {
  interface LevelPersistenceOptions {
    path?: string;
  }

  function LevelPersistence(options?: LevelPersistenceOptions): unknown;
  export = LevelPersistence;
}

// NeDB
declare module "aedes-persistence-nedb" {
  interface NedbPersistenceOptions {
    folder?: string;
  }

  function NedbPersistence(options?: NedbPersistenceOptions): unknown;
  export = NedbPersistence;
}
