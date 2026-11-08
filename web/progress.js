/* 自学进度：纯本地（localStorage）记录读过的讲义，零账号、可随时清掉。
 *
 * 记录结构：{ read: { [noteId]: { t: 时间戳, zh: 标题, en: 标题 } } }
 * 标题双语都存一份——首页的「继续学习」条不需要加载 notes.js（主页不引它），
 * 也能按当前语言显示标题。
 *
 * 三个页面共同的使用方：
 *   - notes-page.js：renderArticle 时 markRead(id, title)
 *   - app.js（主页）：只读，渲染「继续学习」条
 * 依赖本文件的页面都必须先引 progress.js；调用方自行判断 window.LA_PROGRESS
 * 是否存在（vm 测试沙箱里不加载它）。
 */
(function () {
  "use strict";
  const KEY = "la-progress-v1";

  let data = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d && typeof d === "object" && d.read && typeof d.read === "object") {
        return d;
      }
    } catch (e) { /* 损坏 / 隐私模式：当空白处理 */ }
    return { read: {} };
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 忽略 */ }
  }

  function isRead(id) {
    return !!(data.read && data.read[id]);
  }

  /** 标记已读；首次标记时广播 la-progress 事件（侧栏 ✓、首页进度条据此刷新）。 */
  function markRead(id, titleZh, titleEn) {
    if (!id || isRead(id)) return false;
    data.read[id] = { t: Date.now(), zh: titleZh || "", en: titleEn || "" };
    save();
    try {
      window.dispatchEvent(new CustomEvent("la-progress"));
    } catch (e) { /* 极老浏览器没有 CustomEvent，忽略即可 */ }
    return true;
  }

  /** 已读 id 列表。 */
  function readIds() {
    return Object.keys(data.read || {});
  }

  /** 最近一次读的篇目（含双语标题）；没读过返回 null。 */
  function lastRead() {
    let best = null;
    for (const id of Object.keys(data.read || {})) {
      const e = data.read[id];
      if (!best || (e.t || 0) > (best.e.t || 0)) best = { id: id, e: e };
    }
    return best ? { id: best.id, t: best.e.t, zh: best.e.zh, en: best.e.en } : null;
  }

  window.LA_PROGRESS = { isRead: isRead, markRead: markRead, readIds: readIds, lastRead: lastRead };
})();

/* ---------------------------------------------------------------------------
 * 学习路径：推荐的阅读顺序（不含 glossary / practice）。「下一篇」推荐和首页
 * 的进度条都按这条路径走。放在 progress.js 而不是 notes.js，是因为主页不加载
 * notes.js，但进度条要用它。顺序即教学顺序：乘法 → 行列式 → 求逆一族 →
 * 秩与零度 → 空间 → 变换 → 特征值 → 特征方程 → 手算 → 相似 → 对角化。
 * ------------------------------------------------------------------------- */
(function () {
  "use strict";
  const PATH = [
    "matmul",
    "row-reduction",
    "cofactor",
    "adjugate",
    "singular",
    "orthogonal",
    "rank",
    "nullity",
    "rank-nullity",
    "vectorspace",
    "basis",
    "spaces",
    "transform",
    "eigen",
    "charpoly",
    "eigen-howto",
    "similar",
    "diagonalize",
  ];

  /** 路径上 id 的下一篇；路径尽头或不在路径上时返回 null。 */
  function nextInPath(id) {
    const i = PATH.indexOf(id);
    if (i < 0 || i + 1 >= PATH.length) return null;
    return PATH[i + 1];
  }

  window.LA_PROGRESS.PATH = PATH;
  window.LA_PROGRESS.nextInPath = nextInPath;
})();
