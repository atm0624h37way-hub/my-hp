// /api/chat の濫用対策（レート制限＋入力サイズ検証）
// api/chat.js（Vercel）と server.js（ローカル）で共通利用する。
//
// ⚠️ 制限の記録はプロセスのメモリ上に持つ。Vercelのサーバーレスは
// インスタンスが複数立ち上がることがあるため、これは「完全な上限」ではなく
// 「1インスタンスあたりの上限」になる。個人サイト規模の想定外課金を防ぐには
// 十分だが、厳密な制限が必要になったら Vercel KV 等の外部ストアに移すこと。

// 時間枠ごとの上限（IPごと）
const WINDOWS = [
  { ms: 60 * 1000, max: 10, label: '1分' },
  { ms: 60 * 60 * 1000, max: 60, label: '1時間' },
];

// 入力サイズの上限
const LIMITS = {
  maxMessages: 40,        // 会話履歴の最大件数
  maxCharsPerMessage: 2000, // 1メッセージあたりの最大文字数
  maxTotalChars: 20000,   // 履歴全体の最大文字数
};

// 記録するIPの上限（メモリが際限なく増えるのを防ぐ）
const MAX_TRACKED_IPS = 5000;

// ip -> リクエスト時刻の配列（昇順）
const hits = new Map();

// 一番長い時間枠。これより古い記録は捨ててよい
const LONGEST_WINDOW = Math.max(...WINDOWS.map((w) => w.ms));

/** リクエスト元のIPを取り出す。プロキシ経由（Vercel）は x-forwarded-for を見る */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    // "client, proxy1, proxy2" の先頭がクライアント
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || 'unknown';
}

/**
 * レート制限を判定し、通れば1回分を記録する。
 * @returns {{ allowed: boolean, retryAfterSec?: number, label?: string }}
 */
export function checkRateLimit(ip, now = Date.now()) {
  // 期限切れの記録を落とす
  const recent = (hits.get(ip) || []).filter((t) => now - t < LONGEST_WINDOW);

  for (const win of WINDOWS) {
    const countInWindow = recent.filter((t) => now - t < win.ms).length;
    if (countInWindow >= win.max) {
      // 一番古い記録が枠から外れるまでの秒数
      const oldestInWindow = recent.find((t) => now - t < win.ms);
      const retryAfterSec = Math.max(1, Math.ceil((win.ms - (now - oldestInWindow)) / 1000));
      hits.set(ip, recent); // 掃除後の配列は残す
      return { allowed: false, retryAfterSec, label: win.label };
    }
  }

  recent.push(now);
  hits.set(ip, recent);

  // 記録するIPが増えすぎたら、古いものから捨てる（Mapは挿入順）
  if (hits.size > MAX_TRACKED_IPS) {
    const overflow = hits.size - MAX_TRACKED_IPS;
    let removed = 0;
    for (const key of hits.keys()) {
      hits.delete(key);
      if (++removed >= overflow) break;
    }
  }

  return { allowed: true };
}

/**
 * messages の形と量を検証する。
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: 'messagesが必要です' };
  }
  if (messages.length > LIMITS.maxMessages) {
    return { ok: false, error: '会話が長すぎます。ページを再読み込みしてやり直してください' };
  }

  let totalChars = 0;
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || (m.role !== 'user' && m.role !== 'assistant')) {
      return { ok: false, error: 'messagesの形式が正しくありません' };
    }
    if (m.content.length > LIMITS.maxCharsPerMessage) {
      return { ok: false, error: 'メッセージが長すぎます。短く分けて送ってください' };
    }
    totalChars += m.content.length;
  }
  if (totalChars > LIMITS.maxTotalChars) {
    return { ok: false, error: '会話が長すぎます。ページを再読み込みしてやり直してください' };
  }

  return { ok: true };
}
