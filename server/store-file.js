/**
 * 本地调试用的文件存储驱动。
 *
 * 为什么需要它：云引擎上必须用 LeanDB（容器文件系统不持久，每次部署都是新容器），
 * 但本地没有 MySQL 也得能把整条链路跑通、跑测试。于是把存储抽成一层接口，
 * 生产走 mysql，本地走 file，上层的 app.js 一行都不用改。
 *
 * 接口（两个驱动必须一致）：
 *   createPlayer({ id, tokenHash, nick, at })
 *   playerByTokenHash(hash)              → { id, nick } | null
 *   getSave(playerId)                    → { rev, payload, at } | null
 *   putSave(playerId, rev, payload, at)  → void
 *   upsertGhost(rec)                     → void     rec: { playerId, score, name, classId, raceId, level, snapshot, at }
 *   listGhostsNear(score, n)             → Array<rec>
 *   count()                              → { players, saves, ghosts }（运营排查用）
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY = () => ({ players: {}, saves: {}, ghosts: {} });

export function createFileStore(filePath = '', { memory = false } = {}) {
  const mem = memory || !filePath;
  let db = EMPTY();

  function load() {
    if (mem) return;
    try {
      if (!existsSync(filePath)) return;
      const raw = JSON.parse(readFileSync(filePath, 'utf8'));
      db = {
        players: raw.players || {},
        saves: raw.saves || {},
        ghosts: raw.ghosts || {},
      };
    } catch {
      /* 文件坏了当空库起步 —— 调试环境不该因为一个坏 JSON 起不来 */
      db = EMPTY();
    }
  }

  /**
   * 原子落盘：先写 .tmp 再 rename。
   * 直接覆盖写的话，进程在写一半时被杀会留下半个 JSON，下次启动整库读不出来。
   */
  function flush() {
    if (mem) return;
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(db));
    renameSync(tmp, filePath);
  }

  load();

  return {
    kind: 'file',
    async init() { load(); },
    async createPlayer(rec) {
      db.players[rec.id] = { id: rec.id, tokenHash: rec.tokenHash, nick: rec.nick || null, createdAt: rec.at };
      flush();
    },
    async playerByTokenHash(hash) {
      const hit = Object.values(db.players).find((p) => p.tokenHash === hash);
      return hit ? { id: hit.id, nick: hit.nick } : null;
    },
    async playerById(id) {
      const hit = db.players[id];
      return hit ? { id: hit.id, nick: hit.nick } : null;
    },
    async rotateToken(id, hash) {
      const hit = db.players[id];
      if (!hit) return false;
      hit.tokenHash = hash;
      flush();
      return true;
    },
    async getSave(playerId) {
      const s = db.saves[playerId];
      return s ? { rev: s.rev, payload: s.payload, at: s.at } : null;
    },
    async putSave(playerId, rev, payload, at) {
      db.saves[playerId] = { rev, payload, at };
      flush();
    },
    async upsertGhost(rec) {
      db.ghosts[rec.playerId] = { ...rec };
      flush();
    },
    /** 分数相邻优先；同分用 updated_at 兜底排序，保证分页稳定不跳 */
    async listGhostsNear(score, n) {
      return Object.values(db.ghosts)
        .sort((a, b) => Math.abs(a.score - score) - Math.abs(b.score - score) || b.at - a.at)
        .slice(0, n)
        .map((g) => ({ ...g }));
    },
    async count() {
      return {
        players: Object.keys(db.players).length,
        saves: Object.keys(db.saves).length,
        ghosts: Object.keys(db.ghosts).length,
      };
    },
  };
}
