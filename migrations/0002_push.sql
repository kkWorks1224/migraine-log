-- 気圧の注意をプッシュ通知するための購読。位置は約 10km 単位（小数 1 桁）に丸めて保存する
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  threshold REAL NOT NULL,
  tz INTEGER NOT NULL DEFAULT 540,
  last_event INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
