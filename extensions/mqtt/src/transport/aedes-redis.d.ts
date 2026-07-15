/**
 * Type declarations for aedes persistence backends
 */

// Redis
declare module "aedes-persistence-redis" {
  import { Redis } from "ioredis";

  interface RedisPersistenceOptions {
    conn: Redis;
    packetTTL?: (packet: unknown) => number;
  }

  function RedisPersistence(options: RedisPersistenceOptions): unknown;
  export = RedisPersistence;
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
