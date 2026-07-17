/**
 * SqliteVecStore 测试 — 完整覆盖 + FTS5 全文搜索
 *
 * 单元测试模拟 Node.js 内置 node:sqlite；另有真实 SQLite 冒烟测试覆盖持久化。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SqliteVecStore } from './sqlite-vec.js';

// ---------------------------------------------------------------------------
// 模拟 SQLite 运行时加载边界；真实 node:sqlite 由 integration test 覆盖
// ---------------------------------------------------------------------------
const mockStmtRun = vi.fn();
const mockStmtAll = vi.fn();
const mockStmtGet = vi.fn();
const mockPrepare = vi.fn();

const mockExec = vi.fn();
const mockClose = vi.fn();

let mockDbInstance: any;

function createMockDatabase(path: string) {
  return {
    exec: mockExec,
    prepare: mockPrepare,
    close: mockClose,
    location: path,
  };
}

vi.mock('./sqlite-runtime.js', () => {
  return {
    DatabaseSync: vi.fn(function (this: any, path: string) {
      mockDbInstance = createMockDatabase(path);
      return mockDbInstance;
    }),
  };
});

describe('SqliteVecStore', () => {
  let store: SqliteVecStore;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrepare.mockImplementation((sql: string) => {
      // 根据 SQL 返回不同的 mock
      if (sql.includes('INSERT OR REPLACE')) {
        return { run: mockStmtRun };
      }
      if (sql.includes('SELECT COUNT') || sql.includes('stats')) {
        return { get: mockStmtGet };
      }
      if (sql.includes('SELECT id, source_id, chunk_index, vector, text, metadata_json')) {
        return { all: mockStmtAll };
      }
      if (sql.includes('DELETE FROM')) {
        return { run: mockStmtRun };
      }
      if (sql.includes('FTS')) {
        return { all: mockStmtAll, run: mockStmtRun };
      }
      return { run: mockStmtRun, all: mockStmtAll, get: mockStmtGet };
    });

    store = new SqliteVecStore({
      dbPath: '/tmp/test-kb.sqlite',
      namespace: 'test-ns',
      dimensions: 128,
    });

    // mockStmtGet 默认返回 0
    mockStmtGet.mockReturnValue({ count: 0 });
    // mockStmtAll 默认返回空
    mockStmtAll.mockReturnValue([]);
  });

  afterEach(async () => {
    if (store && typeof store.close === 'function') {
      store.close();
    }
  });

  // --------------------------------------------------
  // initialize
  // --------------------------------------------------
  describe('initialize()', () => {
    it('creates database and tables', async () => {
      await store.initialize();

      expect(mockExec).toHaveBeenCalledWith('PRAGMA journal_mode = WAL');
      // 建表 SQL 应包含 CREATE TABLE
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE TABLE IF NOT EXISTS vec_test_ns')
      );
    });

    it('creates FTS5 virtual table', async () => {
      await store.initialize();

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('CREATE VIRTUAL TABLE IF NOT EXISTS fts_test_ns')
      );
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('USING fts5')
      );
    });

    it('creates source_id index', async () => {
      await store.initialize();

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringMatching(/CREATE INDEX IF NOT EXISTS idx_vec_test_ns_[a-f0-9]{12}_source_id/)
      );
    });

    it('sets a bounded busy timeout', async () => {
      await store.initialize();
      expect(mockExec).toHaveBeenCalledWith('PRAGMA busy_timeout = 5000');
    });
  });

  // --------------------------------------------------
  // upsert
  // --------------------------------------------------
  describe('upsert()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('inserts chunks into table and FTS5', async () => {
      await store.upsert([
        {
          id: 'chunk-1',
          vector: Array(128).fill(0).map(() => Math.random()),
          metadata: { sourceId: 'src-1', chunkIndex: 0, text: 'Hello world' },
        },
      ]);

      // 主表 INSERT
      expect(mockStmtRun).toHaveBeenCalledWith(
        'chunk-1', 'src-1', 0,
        expect.any(Buffer),
        'Hello world',
        expect.stringContaining('sourceId'),
      );

      // FTS5 同步 INSERT
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO fts_test_ns')
      );
    });
  });

  // --------------------------------------------------
  // search (vector similarity)
  // --------------------------------------------------
  describe('search()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns scored chunks sorted by similarity', async () => {
      const vectorSize = 128;
      const mockRows = [
        {
          id: 'chunk-a',
          source_id: 'src-1',
          chunk_index: 0,
          vector: Buffer.from(new Float32Array(Array(vectorSize).fill(0.5)).buffer),
          text: 'Similar text A',
          metadata_json: '{"sourceId":"src-1","chunkIndex":0,"text":"Similar text A"}',
        },
        {
          id: 'chunk-b',
          source_id: 'src-1',
          chunk_index: 1,
          vector: Buffer.from(new Float32Array(Array(vectorSize).fill(-0.5)).buffer),
          text: 'Opposite text B',
          metadata_json: '{"sourceId":"src-1","chunkIndex":1,"text":"Opposite text B"}',
        },
      ];
      mockStmtAll.mockReturnValue(mockRows);

      const queryVec = Array(vectorSize).fill(1.0);
      const results = await store.search(queryVec, { topK: 2, minScore: -1 });

      expect(results.length).toBe(2);
      // 第一个应该比第二个更相似（0.5 vs -0.5），余弦相似度：cos(0,0) vs cos(pi)
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('filters by sourceId', async () => {
      mockStmtAll.mockReturnValue([]);

      await store.search(
        Array(128).fill(0),
        { sourceId: 'src-1' },
      );

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE source_id = ?')
      );
    });

    it('applies topK and minScore filters', async () => {
      const vectorSize = 128;
      const mockRows = [
        {
          id: 'chunk-1',
          source_id: 'src-1',
          chunk_index: 0,
          vector: Buffer.from(new Float32Array(Array(vectorSize).fill(0.5)).buffer),
          text: 'Some text',
          metadata_json: '{}',
        },
        {
          id: 'chunk-2',
          source_id: 'src-1',
          chunk_index: 1,
          vector: Buffer.from(new Float32Array(Array(vectorSize).fill(0.1)).buffer),
          text: 'Some text 2',
          metadata_json: '{}',
        },
      ];
      mockStmtAll.mockReturnValue(mockRows);

      const results = await store.search(
        Array(vectorSize).fill(1.0),
        { topK: 1, minScore: 0.9 },
      );

      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  // --------------------------------------------------
  // keywordSearch (FTS5)
  // --------------------------------------------------
  describe('keywordSearch()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('performs FTS5 search on the virtual table', async () => {
      mockStmtAll
        // 第一次调用：FTS5 搜索
        .mockReturnValueOnce([
          { id: 'chunk-1', text: 'Hello world', rank: -1.5 },
          { id: 'chunk-2', text: 'Hello again', rank: -0.8 },
        ])
        // 第二次调用：通过 id 查询完整数据
        .mockReturnValueOnce([
          {
            id: 'chunk-1',
            source_id: 'src-1',
            chunk_index: 0,
            vector: Buffer.from(new Float32Array(Array(128).fill(0.5)).buffer),
            text: 'Hello world',
            metadata_json: '{"sourceId":"src-1","chunkIndex":0,"text":"Hello world"}',
          },
          {
            id: 'chunk-2',
            source_id: 'src-1',
            chunk_index: 1,
            vector: Buffer.from(new Float32Array(Array(128).fill(0.3)).buffer),
            text: 'Hello again',
            metadata_json: '{"sourceId":"src-1","chunkIndex":1,"text":"Hello again"}',
          },
        ]);

      const results = await store.keywordSearch('hello', 2);

      expect(results.length).toBe(2);
      expect(results[0].chunk.id).toBe('chunk-1');
      expect(results[0].score).toBeGreaterThan(0); // BM25 分数应 > 0
      expect(results[0].score).toBeLessThanOrEqual(1); // BM25 分数应 ≤ 1
    });

    it('filters by sourceId in FTS5 search', async () => {
      mockStmtAll.mockReturnValueOnce([]);

      await store.keywordSearch('test query', 5, 'src-1');

      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringMatching(/WHERE fts_test_ns_[a-f0-9]{12} MATCH \?/)
      );
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('AND source_id = ?')
      );
    });

    it('returns empty for empty query', async () => {
      const results = await store.keywordSearch(' ', 5);
      expect(results).toEqual([]);
    });
  });

  // --------------------------------------------------
  // deleteBySource
  // --------------------------------------------------
  describe('deleteBySource()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('deletes FTS5 entries and main table entries', async () => {
      mockStmtAll
        .mockReturnValueOnce([{ id: 'chunk-1' }, { id: 'chunk-2' }]);

      await store.deleteBySource('src-1');

      // 应有事务包裹
      expect(mockExec).toHaveBeenCalledWith('BEGIN IMMEDIATE');

      // 应从 FTS 删除
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM fts_test_ns')
      );

      // 应从主表删除
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM vec_test_ns')
      );
    });
  });

  // --------------------------------------------------
  // clear
  // --------------------------------------------------
  describe('clear()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('clears both FTS and vector tables in a transaction', async () => {
      await store.clear();

      expect(mockExec).toHaveBeenCalledWith('BEGIN IMMEDIATE');
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM fts_test_ns'));
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM vec_test_ns'));
      expect(mockExec).toHaveBeenCalledWith('COMMIT');
    });
  });

  // --------------------------------------------------
  // stats
  // --------------------------------------------------
  describe('stats()', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('returns correct stats', async () => {
      mockStmtGet
        .mockReturnValueOnce({ count: 42 })
        .mockReturnValueOnce({ count: 5 });

      const stats = await store.stats();

      expect(stats.totalChunks).toBe(42);
      expect(stats.totalDocuments).toBe(5);
      expect(stats.provider).toBe('sqlite-vec');
      expect(stats.dimensions).toBe(128);
    });
  });

  // --------------------------------------------------
  // close
  // --------------------------------------------------
  describe('close()', () => {
    it('closes the database connection', async () => {
      await store.initialize();
      store.close();

      expect(mockClose).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------
  // buildFtsQuery (private) — 通过 keywordSearch 间接测试
  // --------------------------------------------------
  describe('buildFtsQuery (private)', () => {
    beforeEach(async () => {
      await store.initialize();
    });

    it('handles pure English queries', async () => {
      mockStmtAll.mockReturnValueOnce([]);
      await store.keywordSearch('hello world', 5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('MATCH')
      );
    });

    it('handles pure Chinese queries', async () => {
      mockStmtAll.mockReturnValueOnce([]);
      await store.keywordSearch('你好世界', 5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('MATCH')
      );
    });

    it('handles mixed Chinese and English queries', async () => {
      mockStmtAll.mockReturnValueOnce([]);
      await store.keywordSearch('hello 世界', 5);
      expect(mockPrepare).toHaveBeenCalledWith(
        expect.stringContaining('MATCH')
      );
    });
  });
});
