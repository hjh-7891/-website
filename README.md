# 心算挑战 · 云端排行榜

单页数学练习游戏（无限出题 · 生命制）+ 跨设备排行榜。前端是一张 HTML，后端是 Pages Functions，榜单存 KV。

## 玩法规则

- 不限题数，一直出题到「连续答错 10 次」结束：答错扣 1 颗心，答对回满 10 颗心，生命归零即结束。
- 四档类型决定每题限时与每题分值（250 分基准 × 类型比例）：

| 类型 | `level` | 每题限时 | 比例 | 每题得分 |
| --- | --- | --- | --- | --- |
| 小学 | `primary` | 10 秒 | 80% | 200 分 |
| 初中 | `junior` | 25 秒 | 100% | 250 分 |
| 高中 | `senior` | 35 秒 | 130% | 325 分 |
| 大学 | `university` | 60 秒 | 170% | 425 分 |

答对加对应分值，答错 / 超时不扣分但掉一颗心。排行榜按**最高单局分**排名（同一昵称取最好那一局，并列时看局数多的一方）。

## 目录

```
public/math.html          游戏页（访问 /math.html）
public/index.html         跳转页（/ → /math.html）
functions/api/[[path]].js  排行榜接口（/api/* 全捕获）
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/rank` | 取排行榜，返回按最高单局分排序的前 20 名 |
| POST | `/api/score` | 提交一轮成绩，返回本局名次与最新榜单 |
| GET | `/api/health` | 自检，确认 KV 绑定正常 |

提交体：`{ name, score, correct, total, maxCombo, level }`
- `name` 1–12 字，控制字符会被清掉，空名落地为「匿名选手」
- `level` 只能是 `primary` / `junior` / `senior` / `university`，其它值 400
- `score` 必须正好等于 `correct × 该类型每题分值`（200 / 250 / 325 / 425），否则 400
- `correct`、`total`、`maxCombo` 上限 2000；`total ≥ correct`（题数不限，只做合理性校验）

响应：成功 `{ok:true,data}`，失败 `{ok:false,error}`；400 参数问题，405 方法不对，500 服务端或 KV 未绑定。

## 存储

KV 单 key `rounds` 存一个数组，最多保留最近 600 轮：

```json
[{ "name": "小林", "score": 3750, "correct": 15, "total": 18, "maxCombo": 9, "level": "junior", "ts": "2026-11-16T09:12:00.000Z" }]
```

排行榜按 `name` 聚合，排序依据是 `best`（最高单局分），并列时依次比局数、最高连击；`score` 只作为累计分附带返回，不参与排名。原始轮次不返回给前端。

## 部署

1. Cloudflare 控制台 → Workers & Pages → Create → Pages → 连 GitHub 仓库（放本目录的 `public/` 与 `functions/`）。
2. 框架预设「没有」，构建命令留空，构建输出目录填 `public`。
3. Settings → Functions → KV namespace bindings：变量名 `RANK`，选（或新建）一个 KV 命名空间。**名字必须是 RANK**，代码读的是 `env.RANK`。
4. 打开 `https://<项目>.pages.dev/math.html` 玩一局，看到右上角变成「云端榜单」即成功。
5. 自检：`https://<项目>.pages.dev/api/health` 应返回 `{"ok":true,"data":{"kv":"ok","rounds":0}}`。

## 已知限制

- KV 写入非原子：两人同一秒提交可能互相覆盖一条，概率极低，可接受。
- 免费额度：KV 写 1000 次/天（一局一次写），读 100000 次/天。写额度用满后当天的提交会失败，前端会自动退回本机存储并提示。
- 免登录，昵称可被冒用；要防冒名得接账号体系，这套没做。
- 旧版（10 题 / 20 秒 / 连击加成）的成绩仍在 KV 里，按新口径只参与「最高单局」比较，不必清空。
- 无法在网页端真正阻止截图；浏览器层面只能做到「切到别的应用时页面模糊」。
