# Redis 全面学习报告

> 基于 redis.io 官方文档、GitHub 仓库及客户端 SDK 的系统性研究。

---

## 目录

1. [Redis 概述](#1-redis-概述)
2. [GitHub 仓库结构](#2-github-仓库结构)
3. [核心数据类型](#3-核心数据类型)
4. [Java 客户端 SDK](#4-java-客户端-sdk)
5. [Redis JSON 数据类型](#5-redis-json-数据类型)
6. [Redis 向量数据库](#6-redis-向量数据库)
7. [Node.js 客户端 SDK](#7-nodejs-客户端-sdk)
8. [选型参考](#8-选型参考)

---

## 1. Redis 概述

Redis（Remote Dictionary Server）是一个开源的内存数据存储系统，以**亚毫秒级延迟**、丰富的数据结构和高扩展性著称。

### 核心定位

| 场景 | 说明 |
|------|------|
| 实时缓存 | 多种淘汰策略、键过期、Hash 字段级 TTL |
| 分布式会话管理 | String / JSON / Hash 灵活建模 |
| 数据结构服务器 | 计数器、队列、排行榜、限流器 |
| NoSQL 存储 | 键值、文档（JSON）、时间序列 |
| 搜索引擎 | 全文搜索、向量搜索、地理空间查询（via Redis Search） |
| 消息代理 | Stream、发布订阅、事件去重 |
| GenAI 向量存储 | RAG、语义缓存、Agent Memory |
| 实时分析 | 推荐系统、欺诈检测、风险评估 |

### 版本与许可证

| 版本 | 许可证 |
|------|--------|
| ≤ 7.2.x | BSD-3-Clause |
| 7.4.x ~ 7.8.x | RSALv2 / SSPLv1（双选） |
| ≥ 8.0.x | RSALv2 / SSPLv1 / AGPLv3（三选） |

当前主线为 Redis 8.0+（Redis Open Source）。

---

## 2. GitHub 仓库结构

来源：https://github.com/redis/redis（主线分支 `unstable`）

```
redis/
├── src/          # 核心 C 源码（150+ 文件）
├── deps/         # 第三方依赖
│   ├── jemalloc/ # 内存分配器（Linux 默认）
│   ├── hiredis/  # C 语言客户端库
│   ├── lua/      # Lua 脚本引擎
│   ├── linenoise/# 命令行编辑库
│   └── xxhash/   # 快速哈希算法
├── modules/      # 内置模块
│   ├── redisbloom/       # 布隆过滤器
│   ├── redisearch/       # 全文/向量搜索
│   ├── redisjson/        # JSON 数据类型
│   ├── redistimeseries/  # 时间序列
│   └── vector-sets/      # 向量集合（Beta）
├── tests/
│   ├── unit/      # 单元测试（数据类型、ACL、集群、模块 API 等）
│   ├── cluster/   # 集群测试（20+ 场景）
│   ├── sentinel/  # 哨兵测试（16+ 场景）
│   ├── integration/# 集成测试（AOF、RDB、复制）
│   └── modules/   # 模块测试（40+ 模块 API 测试）
├── utils/         # 工具脚本（集群创建、性能图表等）
└── redis.conf     # 默认配置
```

### src/ 核心文件

| 文件 | 功能 |
|------|------|
| `server.c` | 事件循环、命令调度、客户端管理 |
| `networking.c` | 网络 I/O、RESP 协议 |
| `db.c` | 键空间管理、CRUD |
| `rdb.c` / `aof.c` | 持久化（快照 + 追加日志） |
| `replication.c` | 主从复制 |
| `cluster.c` / `sentinel.c` | 集群 + 高可用 |
| `t_string.c` ~ `t_stream.c` | 各数据类型实现 |
| `module.c` | 模块 API 框架 |
| `dict.c` / `sds.c` / `quicklist.c` / `rax.c` | 底层数据结构 |

### 构建要点

- **GNU Make**，支持 GCC 10+ / Clang
- `BUILD_WITH_MODULES=yes` — 全功能构建（含 JSON、Search、Bloom、TimeSeries 等）
- `BUILD_TLS=yes` — 启用 TLS（需 OpenSSL）
- JSON 模块需要 **Rust 1.80.1+**
- Linux 默认 jemalloc，macOS 默认 libc malloc
- 支持平台：Ubuntu 20.04/22.04/24.04、Debian 11/12、AlmaLinux 8/9、Rocky Linux 8/9、macOS 13/14

---

## 3. 核心数据类型

### 3.1 内置数据类型

| 类型 | 说明 | 典型用途 |
|------|------|---------|
| String | 字节序列（文本/二进制/序列化对象） | 缓存、计数器、位操作 |
| Hash | 字段-值映射 | 对象存储，支持字段级 TTL |
| List | 链表结构 | 栈、队列 |
| Set | 无序唯一集合 | 去重、集合运算 |
| Sorted Set | 带分数的有序集合 | 排行榜、限流器 |
| Stream | 仅追加日志 + 消费者组 | 事件溯源、消息队列 |
| Geospatial | 地理坐标索引 | 附近位置搜索 |
| Bitmap | 位图操作 | 权限管理 |
| HyperLogLog | 基数估计（≤12KB、<1% 误差） | UV 统计 |

### 3.2 模块扩展类型

| 模块 | 功能 |
|------|------|
| JSON | 嵌套 JSON 文档，JSONPath 查询 |
| Redis Search | 全文搜索、向量搜索、地理空间、聚合 |
| Bloom Filter | 集合成员概率判定（固定内存） |
| Cuckoo Filter | 集合成员概率判定（**支持删除**） |
| Count-Min Sketch | 频率估计（可控误差边界） |
| Top-K | 高频项发现 |
| t-digest | 百分位估计 |
| Time Series | 时间序列数据存储 |
| Vector Set (v8.0 Beta) | 向量嵌入集合（语义搜索/RAG） |

---

## 4. Java 客户端 SDK

### 4.1 Jedis（官方轻量客户端）

- **定位**：低级驱动，直接映射 Redis 命令为 Java 方法
- **I/O 模型**：同步阻塞，基于 Apache Commons Pool2
- **依赖极少**：仅 SLF4J + Commons Pool2
- **版本**：7.1.0，支持 JDK 8/11/17/21，Redis 7.2~8.4

```java
// 推荐连接方式（内置连接池）
RedisClient jedis = RedisClient.builder()
    .hostAndPort("localhost", 6379).build();

// 集群
RedisClusterClient cluster = RedisClusterClient.builder()
    .nodes(new HostAndPort("127.0.0.1", 7379)).build();
```

**Pipeline**（减少 RTT）：
```java
Pipeline p = jedis.pipelined();
Response<String> val = p.get("key");
p.sync();  // 一次性获取所有响应
String value = val.get();
```

**Transaction**（原子执行 + WATCH 乐观锁）：
```java
AbstractTransaction tx = jedis.multi();
tx.set("counter", "0");
tx.incrBy("counter", 1);
tx.exec();
```

### 4.2 Redisson（分布式中间件平台）

- **定位**：高级客户端，将 Redis 抽象为 Java 原生接口
- **I/O 模型**：异步非阻塞，基于 **Netty**
- **实例线程安全**，无需连接池
- **50+ 分布式对象**，兼容 `java.util.concurrent` 接口

```java
Config config = new Config();
config.useClusterServers().addNodeAddress("redis://127.0.0.1:7181");
RedissonClient redisson = Redisson.create(config);

// 分布式 Map
RMap<String, String> map = redisson.getMap("myMap");

// 分布式锁
RLock lock = redisson.getLock("myLock");
lock.lock();
try { /* 临界区 */ } finally { lock.unlock(); }
```

**Spring 全栈集成**：
- `redisson-spring-boot-starter`：自动注入 `RedissonClient`、`RedisTemplate`
- Spring Cache、Spring Session、Spring Transaction、Spring Data Redis
- Spring Cloud Stream、Spring AI Vector Store
- Hibernate/MyBatis 二级缓存

**缓存策略**：Near Cache（最高 45x 加速）、Read-through / Write-through / Write-behind

### 4.3 对比总结

| 维度 | Jedis | Redisson |
|------|-------|----------|
| 抽象层级 | 低级（Redis 命令映射） | 高级（Java 原生接口） |
| I/O 模型 | 同步阻塞 | 异步非阻塞（Netty） |
| 线程安全 | 否（需连接池） | 是 |
| 依赖 | SLF4J + Commons Pool2 | Netty + JCache + Reactor |
| 分布式集合 | 仅原始命令 | Map/Set/List/Queue 等完整实现 |
| 分布式锁 | 不支持（需自行实现） | Lock/RedLock/ReadWriteLock/Semaphore 等 |
| Spring 集成 | 基础 | 完整（Starter/Cache/Session/Transaction） |
| 序列化 | 仅 String/byte[] | Kryo/Jackson/Avro/Protobuf 等 |

**选型：Jedis = Redis 作为远程 KV 存储；Redisson = Redis 作为分布式中间件平台。**

---

## 5. Redis JSON 数据类型

### 5.1 相比 String 存储的优势

| 优势 | 说明 |
|------|------|
| 子值访问 | 无需传输整个对象，40KB 文档路径访问比全量读取快 **200 倍** |
| 原子部分更新 | 消除 read-modify-write 竞态条件 |
| 索引与查询 | 结合 RediSearch 按文档内部字段搜索 |

### 5.2 命令体系（26 个命令）

| 类别 | 关键命令 |
|------|----------|
| 核心 | `JSON.SET`、`JSON.GET`、`JSON.DEL`、`JSON.TYPE`、`JSON.MGET`、`JSON.MERGE` |
| 字符串 | `JSON.STRLEN`、`JSON.STRAPPEND` |
| 数字 | `JSON.NUMINCRBY`、`JSON.NUMMULTBY` |
| 数组 | `JSON.ARRAPPEND`、`JSON.ARRINSERT`、`JSON.ARRPOP`、`JSON.ARRTRIM` |
| 对象 | `JSON.OBJLEN`、`JSON.OBJKEYS` |

### 5.3 JSONPath 语法

```
$                              # 根路径
$.store.book[0].title         # 子元素访问
$..author                      # 递归搜索所有层级
$..book[?(@.price < 10)]      # 过滤表达式
$..book[-1:]                   # 数组切片
$..[?(@.specs.material =~ '(?i)al')]  # 正则匹配
```

### 5.4 索引创建（RediSearch）

```sql
FT.CREATE idx:users ON JSON PREFIX 1 "user:" SCHEMA
  $.name AS name TEXT
  $.address.city AS city TAG
  $.age AS age NUMERIC
  $.embedding AS vec VECTOR HNSW 6 DIM 128 TYPE FLOAT32 DISTANCE_METRIC COSINE
```

**字段类型**：`TEXT`（全文）、`NUMERIC`（范围）、`TAG`（精确匹配，比 TEXT 高效）、`GEO`（地理）、`VECTOR`（相似度）

### 5.5 性能数据

| 文档大小 | 全量 GET | 子路径 GET | 差距 |
|----------|----------|-----------|------|
| 380 B | ~48K ops/s | ~95K ops/s | 2x |
| 40 KB | ~442 ops/s | ~89K ops/s | **200x** |

子路径访问性能几乎不受文档大小影响（恒定 ~80-99K ops/s）。

### 5.6 内存开销

- 每个 JSON 值至少 8 字节（64 位架构）
- 内存占用约为源文件的 **1.2x-2.8x**
- 全局字符串复用机制减少实际内存消耗
- **注意**：容器删除不回收已分配内存，频繁增删可能导致内存膨胀

---

## 6. Redis 向量数据库

### 6.1 核心概念

通过嵌入模型将非结构化数据（文本、图像、音频）转为数值向量，利用向量间距离度量实现**语义搜索**——"位置相近的项在语义上也相近"。

### 6.2 索引参数

| 参数 | 说明 |
|------|------|
| 算法 | `FLAT`（暴力精确，100% 召回）或 `HNSW`（近似最近邻，**推荐**） |
| 向量类型 | `FLOAT32` |
| 维度 | 与嵌入模型输出一致（如 768） |
| 距离度量 | `COSINE`（余弦）、`L2`（欧几里得）、`IP`（内积） |

### 6.3 三种搜索

1. **KNN 搜索**：返回 K 个最近邻
2. **混合搜索**：元数据过滤（品牌/价格等）+ KNN 组合
3. **向量范围搜索**：返回距离阈值内的所有向量

### 6.4 典型应用

语义商品搜索、RAG（检索增强生成）、内容推荐、混合过滤查询

---

## 7. Node.js 客户端 SDK

### 7.1 基本使用

```javascript
import { createClient } from 'redis';

const client = createClient();
client.on('error', err => console.log('Redis Client Error', err));
await client.connect();

await client.set('key', 'value');
const value = await client.get('key');
await client.quit();
```

### 7.2 连接模式

```javascript
// 基本连接
createClient({ url: 'redis://alice:password@myhost:6380' });

// 集群
import { createCluster } from 'redis';
const cluster = createCluster({
    rootNodes: [
        { url: 'redis://127.0.0.1:16379' },
        { url: 'redis://127.0.0.1:16380' }
    ]
});

// TLS（生产环境）
createClient({
    socket: {
        host: 'my-redis.cloud.redislabs.com', port: 6379,
        tls: true,
        key: readFileSync('./redis_user_private.key'),
        cert: readFileSync('./redis_user.crt'),
        ca: [readFileSync('./redis_ca.pem')]
    }
});
```

### 7.3 四种批处理方式

| 方式 | 方法 | 原子性 | 网络往返 | 适用场景 |
|------|------|--------|----------|----------|
| 自动管道 | `Promise.all(...)` | 否 | 1 次 | 批量读写，重连后可继续 |
| 显式管道 | `multi().execAsPipeline()` | 否 | 1 次 | 批量命令，重连后丢弃 |
| 事务 | `multi().exec()` | **是** | 2 次 | 原子更新 |
| 乐观锁 | `WATCH` + `multi().exec()` | **是** | 2+ 次 | 带冲突检测的条件更新 |

### 7.4 向量搜索

```javascript
// 创建向量索引
await client.ft.create('vector_idx', {
    'content': { type: SchemaFieldTypes.TEXT },
    'genre': { type: SchemaFieldTypes.TAG },
    'embedding': {
        type: SchemaFieldTypes.VECTOR,
        ALGORITHM: VectorAlgorithms.HNSW,
        DISTANCE_METRIC: 'L2',
        DIM: 768,
        TYPE: 'FLOAT32'
    }
}, { ON: 'HASH', PREFIX: 'doc:' });

// KNN 搜索
await client.ft.search('vector_idx',
    '*=>[KNN 3 @embedding $B AS score]',
    { PARAMS: { B: queryBuffer }, DIALECT: '2' }
);
```

### 7.5 向量集合（v8.0+ Beta）

```javascript
// 添加带有向量和元数据的元素
await client.vAdd('famousPeople', embeddingArray, name);
await client.vSetAttr('famousPeople', name, JSON.stringify({ born: 1879, died: 1955 }));

// 相似度搜索（带过滤）
const results = await client.vSim('famousPeople', queryArray, {
    COUNT: 5,
    FILTER: '.died < 2000'
});
```

`vSim()` 按余弦距离排序返回，`FILTER` 在距离计算**之前**过滤以提升性能。

### 7.6 概率数据结构

| 类型 | 用途 | 关键特性 |
|------|------|----------|
| Bloom Filter (`bf`) | 集合成员检测 | 固定内存、不可删除 |
| Cuckoo Filter (`cf`) | 集合成员检测 | **支持删除** |
| HyperLogLog (`pf`) | 基数估计 | ≤12KB、<1% 误差 |
| Count-Min Sketch (`cms`) | 频率统计 | 可控误差边界 |
| t-digest | 分位数/CDF | 支持合并多个 digest |
| Top-K | 热门排名 | 跟踪数据流高频项 |

### 7.7 可观测性（OpenTelemetry）

node-redis 内置 OpenTelemetry 指标采集：

```javascript
import { OpenTelemetry } from 'redis';

OpenTelemetry.init({
    metrics: {
        enabled: true,
        enabledMetricGroups: ["command", "pubsub", "streaming", "resiliency"],
        includeCommands: ["GET", "HSET", "XREADGROUP"],
    }
});
```

可采集操作时长、连接创建/等待时间、流处理时长等，导出到 Grafana/Prometheus。

### 7.8 迁移要点（ioredis → node-redis）

| ioredis | node-redis |
|---------|------------|
| 实例化即自动连接 | 必须显式 `await client.connect()` |
| 回调 + Promise | 仅 Promise（回调需 `.legacy()` 模式） |
| `client.hset()` | `client.hSet()`（驼峰） |
| `client.on('message', ...)` | 需 `client.duplicate()` 专用订阅连接 |
| `scanStream()` | `scanIterator()`（异步迭代器） |
| `pipeline().exec()` | `multi().execAsPipeline()` |

---

## 8. 选型参考

### Java 客户端

| 场景 | 推荐 |
|------|------|
| 轻量、仅需基本命令 | **Jedis** |
| 分布式锁/集合/服务 | **Redisson** |
| Spring Boot 开箱即用 | **Redisson** |
| 异步/响应式编程 | **Redisson** |
| 极致性能、最低依赖 | **Jedis** |

### 数据存储模式

| 场景 | 推荐类型 |
|------|----------|
| 整体读写的缓存 | String |
| 需要部分字段读写 | Hash 或 JSON |
| 需要按内部字段查询/索引 | JSON + RediSearch |
| 语义搜索/RAG | Vector Set 或 Hash/JSON + VECTOR 索引 |
| 消息队列/事件流 | Stream |
| 排行榜/限流器 | Sorted Set |
| UV 统计 | HyperLogLog |
| 去重/存在性检查 | Bloom Filter 或 Cuckoo Filter |

---

> 研究来源：redis.io 官方文档、github.com/redis/redis、github.com/redis/jedis、redisson.pro