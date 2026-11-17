-- 残塔云端后端 · LeanDB(MySQL) 建表脚本
--
-- 在 TapTap 云引擎控制台给 LeanDB 申请 MySQL 实例后，把本文件整段贴进
-- 「数据导入 / SQL 控制台」执行一次即可。三张表都用 player_id 做主键，
-- 一个玩家只保留一条最新存档、一条最新镜像，表不会随游玩轮次膨胀。
--
-- 字符集统一 utf8mb4：角色名/种族名是中文，utf8 三字节存不下生僻字。

CREATE TABLE IF NOT EXISTS canta_player (
  id          VARCHAR(32)  NOT NULL,
  token_hash  CHAR(64)     NOT NULL,
  nick        VARCHAR(32)  NULL,
  created_at  BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_token_hash (token_hash)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- rev 是单调递增的存档版本号：客户端带旧 rev 上来一律 409，
-- 避免两台设备各自静默覆盖对方（冲突交给客户端提示玩家选一份）。
CREATE TABLE IF NOT EXISTS canta_save (
  player_id   VARCHAR(32)  NOT NULL,
  rev         INT          NOT NULL,
  payload     MEDIUMTEXT   NOT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (player_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 镜像池：一个玩家一条，score 建索引供「取分数相邻的 N 个对手」用。
-- snapshot 存的是角色快照 JSON（卡组/宝物/装备都在里面），
-- 和本地 meta.ghosts 里的结构完全一致，前端拿到后直接并进池子。
CREATE TABLE IF NOT EXISTS canta_ghost (
  player_id   VARCHAR(32)  NOT NULL,
  score       INT          NOT NULL DEFAULT 800,
  name        VARCHAR(48)  NULL,
  class_id    VARCHAR(16)  NULL,
  race_id     VARCHAR(16)  NULL,
  level       INT          NOT NULL DEFAULT 1,
  snapshot    MEDIUMTEXT   NOT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (player_id),
  KEY idx_score (score)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
