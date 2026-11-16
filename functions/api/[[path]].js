/**
 * 心算挑战 —— 跨设备排行榜接口
 *
 * 路由（文件为 functions/api/[[path]].js，可捕获 /api/* 全部请求）：
 *   GET  /api/rank   取云端排行榜（按昵称累计积分排序）
 *   POST /api/score  提交一轮成绩，返回最新榜单与本局名次
 *   GET  /api/health 自检（KV 是否绑定成功）
 *
 * 依赖：Pages 项目里绑定一个 KV 命名空间，变量名必须是 RANK（代码读 env.RANK）。
 * 存储：单 key `rounds` 存整个成绩数组（最多保留最近 600 轮），结构 [{name,score,correct,total,maxCombo,level,ts}]
 */

const KEY = 'rounds';
const MAX_ROUNDS = 600;
const MAX_NAME = 12;
/* 每答对一题固定得分：250 分基准 × 类型比例 80% / 100% / 130% / 170% */
const LEVEL_VALUE = { primary: 200, junior: 250, senior: 325, university: 425 };
const LEVELS = ['primary', 'junior', 'senior', 'university'];
const MAX_COUNT = 2000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}
function ok(data) {
  return json({ ok: true, data: data }, 200);
}
function fail(error, status) {
  return json({ ok: false, error: error }, status || 400);
}

function safeString(value, maxLen) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLen);
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

async function readRounds(env) {
  const raw = await env.RANK.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

async function writeRounds(env, list) {
  await env.RANK.put(KEY, JSON.stringify(list));
}

/* 按昵称聚合：最高单局（排序依据）、累计积分、局数、最高连击 */
function aggregate(rounds) {
  const map = new Map();
  rounds.forEach((r) => {
    const name = safeString(r && r.name, MAX_NAME) || '匿名选手';
    if (!map.has(name)) {
      map.set(name, { name: name, score: 0, rounds: 0, best: 0, bestCombo: 0 });
    }
    const item = map.get(name);
    const score = toInt(r && r.score, 0);
    item.score += score;
    item.rounds += 1;
    if (score > item.best) item.best = score;
    const combo = toInt(r && r.maxCombo, 0);
    if (combo > item.bestCombo) item.bestCombo = combo;
  });
  return Array.from(map.values()).sort((a, b) => {
    if (b.best !== a.best) return b.best - a.best;
    if (b.rounds !== a.rounds) return b.rounds - a.rounds;
    if (b.bestCombo !== a.bestCombo) return b.bestCombo - a.bestCombo;
    return a.name.localeCompare(b.name, 'zh');
  });
}

function rankOf(list, name) {
  const index = list.findIndex((item) => item.name === name);
  return index < 0 ? 0 : index + 1;
}

export async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': url.origin,
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    });
  }

  try {
    if (path === '/api/health') {
      if (!env.RANK) return fail('服务端未绑定 KV 命名空间：变量名必须是 RANK', 500);
      const rounds = await readRounds(env);
      return ok({ kv: 'ok', rounds: rounds.length });
    }

    if (!env.RANK) {
      return fail('服务端未绑定 KV 命名空间：变量名必须是 RANK', 500);
    }

    if (path === '/api/rank') {
      if (request.method !== 'GET') return fail('请用 GET 取排行榜', 405);
      const rounds = await readRounds(env);
      return ok({ list: aggregate(rounds).slice(0, 20), rounds: rounds.length });
    }

    if (path === '/api/score') {
      if (request.method !== 'POST') return fail('请用 POST 提交成绩', 405);

      let body = null;
      try {
        body = await request.json();
      } catch (err) {
        return fail('请求体不是合法 JSON', 400);
      }

      const name = safeString(body && body.name, MAX_NAME) || '匿名选手';
      const level = LEVELS.indexOf(body && body.level) >= 0 ? body.level : '';
      const correct = toInt(body && body.correct, -1);
      const total = toInt(body && body.total, -1);
      const maxCombo = toInt(body && body.maxCombo, -1);
      const score = toInt(body && body.score, -1);

      if (!level) return fail('未知难度类型', 400);
      if (correct < 0 || correct > MAX_COUNT) return fail('答对题数超出范围', 400);
      if (total < correct || total > MAX_COUNT) return fail('总题数不合法', 400);
      if (maxCombo < 0 || maxCombo > MAX_COUNT) return fail('连击数超出范围', 400);
      /* 每题分值固定，总分必须正好等于「答对数 × 该类型的每题分值」 */
      const expected = correct * LEVEL_VALUE[level];
      if (score !== expected) return fail('分数与答对数不符（每题 ' + LEVEL_VALUE[level] + ' 分）', 400);

      const rounds = await readRounds(env);
      rounds.push({
        name: name,
        score: score,
        correct: correct,
        total: total,
        maxCombo: maxCombo,
        level: level,
        ts: new Date().toISOString()
      });

      const trimmed = rounds.length > MAX_ROUNDS ? rounds.slice(rounds.length - MAX_ROUNDS) : rounds;
      await writeRounds(env, trimmed);

      const list = aggregate(trimmed).slice(0, 20);
      return ok({ rank: rankOf(list, name), list: list, saved: true });
    }

    return fail('接口不存在', 404);
  } catch (err) {
    return fail('服务端异常：' + String(err && err.message ? err.message : err), 500);
  }
}
