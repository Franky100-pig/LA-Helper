"use strict";
/* 讲义独立页的页面逻辑：左侧「分类 → 文章」两级导航 + 右侧正文，用 location.hash 做路由。
 *
 * 依赖（都在 <head> 里先加载）：
 *   i18n.js   -> window.LA_I18N
 *   notes.js  -> window.LA_NOTES.{zh,en}.byLang().blocksHtml()
 *
 * 路由约定：
 *   notes.html            -> 左侧列分类，右侧显示「欢迎」卡片
 *   notes.html#c=<catId>  -> 左侧列该分类下的文章，右侧仍显示「欢迎」卡片
 *   notes.html#<noteId>   -> 直接打开某一篇；左侧自动展开它所属的分类
 * 换视图 = 改 hash（pushState 语义），所以浏览器的前进/后退、复制链接分享都正常。
 */
(function () {
  const I18N = window.LA_I18N;
  const tr = I18N.t;
  const el = (id) => document.getElementById(id);

  const listBox = el("noteList");
  const view = el("noteView");
  const sideTitle = el("sideTitle");
  const backBtn = el("backToCats");
  if (!listBox || !view) return;

  const articles = () => window.LA_NOTES.byLang(I18N.get());

  // 分类的展示顺序。不在这张表里的分类（以后新增的）会自动排到后面，
  // 所以加新分类不需要改这里，只是排序不受控。
  const CAT_ORDER = ["glossary", "det", "space", "matops", "invert", "rank", "transform", "eigen", "practice"];

  /** 按 a.cat 把讲义分组；分类名直接取该类第一篇文章的 tag（单一数据源）。 */
  function categories() {
    const map = new Map();
    for (const a of articles()) {
      if (!a.cat) continue;
      if (!map.has(a.cat)) map.set(a.cat, { id: a.cat, label: a.tag, items: [] });
      map.get(a.cat).items.push(a);
    }
    const known = CAT_ORDER.filter((id) => map.has(id)).map((id) => map.get(id));
    const extra = [...map.values()].filter((c) => CAT_ORDER.indexOf(c.id) === -1);
    return known.concat(extra);
  }

  function countLabel(n) {
    return n === 1 ? tr("notes.oneArticle") : n + " " + tr("notes.nArticles");
  }

  // -------------------------------------------------------------------------
  // 主题：与主页 / AI 页同一套（跟随系统，手动选择存 localStorage["la-theme"]）
  // -------------------------------------------------------------------------
  (function initTheme() {
    const KEY = "la-theme";
    const btn = el("themeToggle");
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

    function stored() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }
    function current() {
      return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    }
    function apply(t) {
      document.documentElement.setAttribute("data-theme", t);
      if (btn) btn.textContent = t === "dark" ? tr("theme.toLight") : tr("theme.toDark");
    }
    function toggle() {
      const next = current() === "dark" ? "light" : "dark";
      apply(next);
      try { localStorage.setItem(KEY, next); } catch (_) { /* 存不了就只本次生效 */ }
    }

    apply(current());
    I18N.onChange(() => apply(current()));
    if (btn) btn.addEventListener("click", toggle);
    if (mq) {
      const onChange = (e) => {
        const s = stored();
        if (s !== "light" && s !== "dark") apply(e.matches ? "light" : "dark");
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  })();

  // -------------------------------------------------------------------------
  // 左侧目录：两种形态 —— 分类列表 / 某个分类下的文章列表
  // -------------------------------------------------------------------------
  function renderSide(state) {
    listBox.textContent = "";

    if (state.mode === "cats") {
      if (sideTitle) sideTitle.textContent = tr("notes.catsTitle");
      if (backBtn) backBtn.hidden = true;
      for (const c of categories()) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "note-item cat-item";
        btn.dataset.cat = c.id;
        btn.textContent = c.label;
        const n = document.createElement("span");
        n.className = "tag";
        n.textContent = countLabel(c.items.length);
        btn.appendChild(n);
        btn.addEventListener("click", () => { location.hash = "c=" + c.id; });
        listBox.appendChild(btn);
      }
      return;
    }

    // 分类内：左上角「返回分类」+ 该分类下的文章
    if (backBtn) { backBtn.hidden = false; backBtn.textContent = tr("notes.backToCats"); }
    if (sideTitle) sideTitle.textContent = state.catLabel;
    for (const a of state.items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-item" + (a.id === state.activeId ? " on" : "");
      btn.dataset.note = a.id;
      btn.textContent = a.title;
      btn.addEventListener("click", () => { location.hash = a.id; });  // 走 hash，保留前进/后退
      listBox.appendChild(btn);
    }
  }

  // -------------------------------------------------------------------------
  // 右侧：没选文章时显示欢迎卡片
  // -------------------------------------------------------------------------
  function renderWelcome() {
    view.textContent = "";
    const box = document.createElement("div");
    box.className = "welcome";

    const art = document.createElement("div");
    art.className = "welcome-art";
    art.textContent = "✎";

    const title = document.createElement("p");
    title.className = "welcome-title";
    title.textContent = tr("notes.welcome");

    const hint = document.createElement("p");
    hint.className = "welcome-hint";
    hint.textContent = tr("notes.welcomeHint");

    box.appendChild(art);
    box.appendChild(title);
    box.appendChild(hint);
    view.appendChild(box);

    I18N.syncDocTitle("notes.label");
  }

  // -------------------------------------------------------------------------
  // 右侧：正文
  // -------------------------------------------------------------------------
  function renderArticle(a) {
    view.textContent = "";
    const h2 = document.createElement("h2");
    h2.textContent = a.title;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = a.tag;
    h2.appendChild(badge);

    const lead = document.createElement("p");
    lead.className = "lead";
    lead.innerHTML = a.lead;                              // 讲义文案是自己写的静态内容

    const body = document.createElement("div");
    body.className = "notes-body";
    body.innerHTML = window.LA_NOTES.blocksHtml(a.blocks);

    view.appendChild(h2);
    view.appendChild(lead);
    view.appendChild(body);

    // 底部：「试一试」跳计算器并预填本篇示例 + 本篇专属的「提 Issue」答疑入口。
    // 这两样是「讲义 ↔ 计算」闭环和「前端自学 + GitHub 社区答疑」落点。
    if (a.try) {
      const row = document.createElement("div");
      row.className = "try-row";

      const tryBtn = document.createElement("button");
      tryBtn.type = "button";
      tryBtn.className = "btn-try";
      tryBtn.textContent = tr("notes.tryIt");
      tryBtn.addEventListener("click", () => {
        const t = a.try;
        let hash = "op=" + encodeURIComponent(t.op);
        if (t.A) hash += "&A=" + encodeURIComponent(JSON.stringify(t.A));
        if (t.B) hash += "&B=" + encodeURIComponent(JSON.stringify(t.B));
        if (t.det) hash += "&det=" + encodeURIComponent(t.det);
        hash += "&lang=" + (I18N.get() || "zh");   // 打开计算器时界面语言与本篇一致
        window.location.href = "index.html#" + hash;
      });
      row.appendChild(tryBtn);

      const issue = document.createElement("a");
      issue.className = "btn-issue";
      issue.target = "_blank";
      issue.rel = "noopener noreferrer";
      // 标题 / 正文走 i18n，不在 .js 里写死中文（保持双语切换 & 过硬编码守卫）
      issue.href = "https://github.com/Franky100-pig/LA-Helper/issues/new?title=" +
        encodeURIComponent("[" + a.id + "] " + tr("notes.issueTitle")) +
        "&body=" + encodeURIComponent(tr("notes.issueBody"));
      issue.textContent = tr("notes.askIssue");
      row.appendChild(issue);

      view.appendChild(row);
    }

    // 标签页标题跟着当前这篇走，收藏/分享时更好认
    document.title = a.title + " · LA Helper";
  }

  // -------------------------------------------------------------------------
  // 路由
  // -------------------------------------------------------------------------
  function route() {
    const raw = decodeURIComponent((location.hash || "").replace(/^#/, ""));

    // #c=<catId>：展开某个分类，右侧留欢迎页
    if (raw.indexOf("c=") === 0) {
      const c = categories().find((x) => x.id === raw.slice(2));
      if (c) {
        renderSide({ mode: "cat", catLabel: c.label, items: c.items, activeId: null });
        renderWelcome();
        return;
      }
    }

    // #<noteId>：直接打开某一篇，左侧展开它所属的分类
    if (raw) {
      const a = articles().find((x) => x.id === raw);
      if (a) {
        const c = categories().find((x) => x.id === a.cat);
        renderSide({
          mode: "cat",
          catLabel: c ? c.label : a.tag,
          items: c ? c.items : [a],
          activeId: a.id,
        });
        renderArticle(a);
        return;
      }
    }

    // 空 hash（或未知 id）：回到分类列表 + 欢迎页
    renderSide({ mode: "cats" });
    renderWelcome();
  }

  window.addEventListener("hashchange", route);
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // 清掉 hash 但保留一条历史记录，浏览器「后退」仍能回到刚才的分类
      history.pushState(null, "", location.pathname + location.search);
      route();
    });
  }
  window.addEventListener("popstate", route);

  // -------------------------------------------------------------------------
  // 中 / 英一键切换：与其它页共用 localStorage["la-lang"]，切完重画目录与正文
  // -------------------------------------------------------------------------
  (function initLang() {
    const btn = el("langToggle");
    const syncButton = () => { if (btn) btn.textContent = I18N.toggleLabel(); };

    // 讲义页的 <title> 挂不上 data-i18n（<title> 不在 apply() 的扫描范围内），
    // 平时由 renderArticle() 按当前文章重设；没有文章时由 renderWelcome() 兜底。
    const syncTitle = () => I18N.syncDocTitle("notes.label");

    I18N.apply(document);
    syncTitle();
    renderSide({ mode: "cats" });
    route();
    syncButton();

    if (btn) btn.addEventListener("click", () => { I18N.toggle(); });

    I18N.onChange(() => {
      syncButton();
      syncTitle();
      route();          // 按当前 hash 用新语言重画（目录一起重建）
    });
  })();
})();
