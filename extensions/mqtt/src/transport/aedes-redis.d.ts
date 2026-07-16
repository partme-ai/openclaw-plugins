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
    database?: string;
    collectionPrefix?: string;
  }

  function MongoDbPersistence(options?: MongoDbPersistenceOptions): unknown;
  export = MongoDbPersistence;
}

// LevelDB
declare module "aedes-persistence-level" {
  function LevelPersistence(database: unknown): unknown;
  export = LevelPersistence;
}
