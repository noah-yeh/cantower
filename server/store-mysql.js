/**
 * 生产存储驱动：LeanDB(MySQL)。
 *
 * 走 mysql2 连接池，方法签名和 store-file.js 完全一致，app.js 不感知驱动。
 * mysql2 用**动态 import**：本地调试默认走 file 驱动，不需要为了跑测试装 MySQL 客户端。
 * **故意不写进 package.json 的 dependencies** —— 一是「发布为应用」的静态托管会把
 * 任何数据库客户端依赖判定为「需要外部服务」而拒绝发布（前端游戏本身是纯静态的）；
 * 二是 file 驱动本来就零依赖。真部署到云引擎时在那台机器上单独 `npm install mysql2`,
 * 再用 MYSQL_URL 启动即可。
 *
 * 需要先执行 schema.sql 建表 —— 应用层不做 DDL。
 */

export async function createMysqlStore({ url, connectionLimit = 5 }) {
  let mysql;
  try {
    mysql = await import('mysql2/promise');
  } catch {
    throw new Error('缺少 mysql2 依赖：请在项目根目录执行 npm install mysql2 后再用 MYSQL_URL 启动');
  }

  const pool = mysql.default
    ? mysql.default.createPool({ uri: url, waitForConnections: true, connectionLimit, charset: 'utf8mb4' })
    : mysql.createPool({ uri: url, waitForConnections: true, connectionLimit, charset: 'utf8mb4' });

  const toGhost = (r) => ({
    playerId: r.player_id,
    score: Number(r.score) || 0,
    name: r.name || '',
    classId: r.class_id || '',
    raceId: r.race_id || '',
    level: Number(r.level) || 1,
    snapshot: r.snapshot,
    at: Number(r.updated_at) || 0,
  });

  return {
    kind: 'mysql',
    async init() {
      const conn = await pool.getConnection();
      try {
        await conn.query('SELECT 1');
      } finally {
        conn.release();
      }
    },
    async createPlayer(rec) {
      await pool.execute(
        'INSERT INTO canta_player (id, token_hash, nick, created_at) VALUES (?, ?, ?, ?)',
        [rec.id, rec.tokenHash, rec.nick || null, rec.at],
      );
    },
    async playerByTokenHash(hash) {
      const [rows] = await pool.execute(
        'SELECT id, nick FROM canta_player WHERE token_hash = ? LIMIT 1',
        [hash],
      );
      return rows.length ? { id: rows[0].id, nick: rows[0].nick } : null;
    },
    async playerById(id) {
      const [rows] = await pool.execute('SELECT id, nick FROM canta_player WHERE id = ? LIMIT 1', [id]);
      return rows.length ? { id: rows[0].id, nick: rows[0].nick } : null;
    },
    async rotateToken(id, hash) {
      const [res] = await pool.execute('UPDATE canta_player SET token_hash = ? WHERE id = ?', [hash, id]);
      return (res.affectedRows || 0) > 0;
    },
    async getSave(playerId) {
      const [rows] = await pool.execute(
        'SELECT rev, payload, updated_at FROM canta_save WHERE player_id = ? LIMIT 1',
        [playerId],
      );
      if (!rows.length) return null;
      return { rev: Number(rows[0].rev) || 0, payload: rows[0].payload, at: Number(rows[0].updated_at) || 0 };
    },
    async putSave(playerId, rev, payload, at) {
      await pool.execute(
        `INSERT INTO canta_save (player_id, rev, payload, updated_at) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE rev = VALUES(rev), payload = VALUES(payload), updated_at = VALUES(updated_at)`,
        [playerId, rev, payload, at],
      );
    },
    async upsertGhost(rec) {
      await pool.execute(
        `INSERT INTO canta_ghost (player_id, score, name, class_id, race_id, level, snapshot, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE score = VALUES(score), name = VALUES(name), class_id = VALUES(class_id),
           race_id = VALUES(race_id), level = VALUES(level), snapshot = VALUES(snapshot), updated_at = VALUES(updated_at)`,
        [rec.playerId, rec.score, rec.name || null, rec.classId || null, rec.raceId || null, rec.level || 1, rec.snapshot, rec.at],
      );
    },
    async listGhostsNear(score, n) {
      const [rows] = await pool.query(
        'SELECT * FROM canta_ghost ORDER BY ABS(score - ?) ASC, updated_at DESC LIMIT ?',
        [score, Number(n) || 3],
      );
      return rows.map(toGhost);
    },
    async count() {
      const [[p]] = await pool.query('SELECT COUNT(*) AS c FROM canta_player');
      const [[s]] = await pool.query('SELECT COUNT(*) AS c FROM canta_save');
      const [[g]] = await pool.query('SELECT COUNT(*) AS c FROM canta_ghost');
      return { players: Number(p.c) || 0, saves: Number(s.c) || 0, ghosts: Number(g.c) || 0 };
    },
  };
}
