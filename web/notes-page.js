"use strict";
/* 讲义独立页的页面逻辑：左侧「分类 → 文章」两级导航 + 右侧正文，用 location.hash 做路由。
 *
 * 依赖（都在 <head> 里先加载）：
 *   i18n.js   -> window.LA_I18N
 *   notes.js  -> window.LA_NOTES.{zh,en}.byLang().blocksHtml()
 *
 * 路由约定：
 *   notes.html            -> 左侧列分类，右侧显示「欢迎」卡片 + 知识点地图
 *   notes.html#map        -> 同上，但用可分享的链接直达知识点地图
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

  function findArticle(id) {
    for (const a of articles()) {
      if (a.id === id) return a;
    }
    return null;
  }

  /** 英文标题：进度记录里双语各存一份，首页按当前语言显示。 */
  function titleEn(id) {
    for (const a of window.LA_NOTES.en || []) {
      if (a.id === id) return a.title;
    }
    return "";
  }

  /** 侧栏已读标记：给读过的文章按钮加 ✓。 */
  function updateReadMarks() {
    if (!window.LA_PROGRESS) return;
    listBox.querySelectorAll("[data-note]").forEach((btn) => {
      const on = LA_PROGRESS.isRead(btn.dataset.note);
      let mark = btn.querySelector(".readmark");
      if (on && !mark) {
        mark = document.createElement("span");
        mark.className = "readmark";
        mark.textContent = "✓ ";
        btn.insertBefore(mark, btn.firstChild);
      } else if (!on && mark) {
        mark.parentNode.removeChild(mark);
      }
    });
  }

  // -------------------------------------------------------------------------
  // 知识点地图：首页按主题列出全部知识点，已写的能点开、没写的显式标「待补」。
  // 数据来自 notes.js 的 LA_NOTES.TOPICS（中英双语单一数据源）。
  // -------------------------------------------------------------------------
  let mapFilter = "all";                       // all | unread | planned

  function isRead(id) {
    return !!(window.LA_PROGRESS && LA_PROGRESS.isRead(id));
  }

  function topicGroups() {
    const T = window.LA_NOTES.TOPICS || {};
    return T[I18N.get()] || T.zh || [];
  }

  function topicChips() {
    return Array.from(view.querySelectorAll(".topic-chip"));
  }

  /** 统计行：已覆盖 / 总数 / 还没读 / 待补。数字全部由 DOM 现算，切语言后自动对。 */
  function updateTopicStats() {
    const chips = topicChips();
    const linked = chips.filter((c) => c.dataset.topicId);
    const unread = linked.filter((c) => c.dataset.state === "unread").length;
    const planned = chips.filter((c) => c.dataset.state === "planned").length;
    const stats = view.querySelector("[data-map-stats]");
    if (stats) {
      stats.textContent = tr("notes.mapStats", {
        n: linked.length, m: chips.length, u: unread, p: planned,
      });
    }
  }

  /** 筛选：只显示「还没读」或「待补」，全隐藏的分组也一并收起。 */
  function applyTopicFilter() {
    view.querySelectorAll(".topic-group").forEach((g) => {
      let visible = 0;
      g.querySelectorAll(".topic-chip").forEach((c) => {
        const show = mapFilter === "all" || c.dataset.state === mapFilter;
        c.hidden = !show;
        if (show) visible++;
      });
      g.hidden = visible === 0;
    });
    view.querySelectorAll(".map-filter").forEach((b) => {
      b.classList.toggle("on", b.dataset.filter === mapFilter);
    });
  }

  /** 已读状态：打开讲义时 la-progress 会广播，这里同步 ✓ 与统计数字。 */
  function updateTopicMarks() {
    view.querySelectorAll(".topic-chip[data-topic-id]").forEach((chip) => {
      const on = isRead(chip.dataset.topicId);
      chip.dataset.state = on ? "read" : "unread";
      chip.classList.toggle("is-read", on);
      chip.classList.toggle("is-unread", !on);
      let mark = chip.querySelector(".chip-state");
      if (on && !mark) {
        mark = document.createElement("span");
        mark.className = "chip-state";
        mark.textContent = "✓";
        chip.appendChild(mark);
      } else if (!on && mark) {
        mark.parentNode.removeChild(mark);
      }
    });
    updateTopicStats();
    applyTopicFilter();
  }

  function renderTopicMap(parent) {
    const map = document.createElement("section");
    map.className = "topic-map";

    const title = document.createElement("h3");
    title.textContent = tr("notes.mapTitle");
    const hint = document.createElement("p");
    hint.className = "map-hint";
    hint.textContent = tr("notes.mapHint");
    const stats = document.createElement("p");
    stats.className = "map-stats";
    stats.dataset.mapStats = "1";
    map.appendChild(title);
    map.appendChild(hint);
    map.appendChild(stats);

    const filters = document.createElement("div");
    filters.className = "map-filters";
    [["all", "notes.mapAll"], ["unread", "notes.mapUnread"], ["planned", "notes.mapPlanned"]]
      .forEach(([key, label]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "map-filter";
        b.dataset.filter = key;
        b.textContent = tr(label);
        b.addEventListener("click", () => { mapFilter = key; applyTopicFilter(); });
        filters.appendChild(b);
      });
    map.appendChild(filters);

    const groupsBox = document.createElement("div");
    groupsBox.className = "topic-groups";
    for (const g of topicGroups()) {
      const group = document.createElement("div");
      group.className = "topic-group";
      const gh = document.createElement("h4");
      gh.textContent = g.g;
      const chips = document.createElement("div");
      chips.className = "topic-chips";
      for (const item of g.items || []) {
        if (item.id) {
          const a = document.createElement("a");
          a.className = "topic-chip is-unread";
          a.href = "#" + item.id;
          a.dataset.topicId = item.id;
          a.dataset.state = "unread";
          a.textContent = item.t;
          chips.appendChild(a);
        } else {
          const s = document.createElement("span");
          s.className = "topic-chip planned";
          s.dataset.state = "planned";
          s.title = tr("notes.mapPlannedTip");
          s.textContent = item.t;
          const badge = document.createElement("span");
          badge.className = "chip-badge";
          badge.textContent = tr("notes.mapPlanned");
          s.appendChild(badge);
          chips.appendChild(s);
        }
      }
      group.appendChild(gh);
      group.appendChild(chips);
      groupsBox.appendChild(group);
    }
    map.appendChild(groupsBox);

    const suggest = document.createElement("a");
    suggest.className = "map-suggest";
    suggest.href = "https://github.com/Franky100-pig/LA-Helper/issues/new";
    suggest.target = "_blank";
    suggest.rel = "noopener noreferrer";
    suggest.textContent = tr("notes.mapSuggest");
    map.appendChild(suggest);

    parent.appendChild(map);
    updateTopicMarks();
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

    // 固定入口：分类列表 / 分类内 / 正文，三种视图都常驻，一键回到知识点地图
    const mapBtn = document.createElement("button");
    mapBtn.type = "button";
    mapBtn.className = "note-item cat-item map-nav" + (state.activeMap ? " on" : "");
    mapBtn.textContent = tr("notes.mapNav");
    mapBtn.addEventListener("click", () => { location.hash = "map"; });
    listBox.appendChild(mapBtn);

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
  // 右侧：没选文章时显示欢迎卡片 + 知识点地图
  // -------------------------------------------------------------------------
  function renderWelcome() {
    view.textContent = "";
    const box = document.createElement("div");
    box.className = "welcome compact";

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

    renderTopicMap(view);          // 知识点清单（已写 / 待补 / 已读）
    I18N.syncDocTitle("notes.label");
  }

  // -------------------------------------------------------------------------
  // 右侧：正文
  // -------------------------------------------------------------------------
  function renderArticle(a) {
    view.textContent = "";

    // 面包屑：每篇讲义都能一步回到知识点地图，看自己还少了什么
    const back = document.createElement("a");
    back.className = "map-back";
    back.href = "#map";
    back.textContent = tr("notes.mapBack");
    view.appendChild(back);

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

    // 讲义里的 Desmos 交互图：把每个 .desmos-host 渲染成可拖拽 / 缩放的 Desmos 计算器
    // （引擎与 key 见 web/desmos.js、web/desmos-config.js；本地预览免 key）。
    if (window.LA_DESMOS) window.LA_DESMOS.mountAll(view);

    // 自测题：每篇 2 道概念小题，答案折叠在 <details> 里，先想再展开。
    if (a.quiz && a.quiz.length) {
      const quiz = document.createElement("div");
      quiz.className = "note-quiz";
      const h = document.createElement("h4");
      h.textContent = tr("notes.quizTitle");
      quiz.appendChild(h);
      a.quiz.forEach((item, i) => {
        const d = document.createElement("details");
        const s = document.createElement("summary");
        s.textContent = (i + 1) + ". " + item.q;
        const p = document.createElement("p");
        p.textContent = item.a;
        d.appendChild(s);
        d.appendChild(p);
        quiz.appendChild(d);
      });
      view.appendChild(quiz);
    }

    // 自学进度：打开即记已读（纯本地），并显示进度与「下一篇」推荐。
    if (window.LA_PROGRESS) {
      LA_PROGRESS.markRead(a.id, a.title, titleEn(a.id));
      updateReadMarks();

      const prog = document.createElement("p");
      prog.className = "learn-progress";
      const total = window.LA_PROGRESS.PATH.length;
      const readN = window.LA_PROGRESS.PATH.filter((id) => LA_PROGRESS.isRead(id)).length;
      prog.textContent = tr("notes.readCount", { n: readN, m: total });
      view.appendChild(prog);

      const nextId = window.LA_PROGRESS.nextInPath(a.id);
      if (nextId) {
        const next = findArticle(nextId);
        if (next) {
          const nxt = document.createElement("button");
          nxt.type = "button";
          nxt.className = "btn-next";
          nxt.textContent = tr("notes.next") + next.title + " →";
          nxt.addEventListener("click", () => { location.hash = nextId; });
          view.appendChild(nxt);
        }
      }
    }

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

      // 「做配套练习」：跳 la-hw 对应题集（GitHub Pages 上的可交互 HTML）。
      // 没有对应题集的讲义没有 a.practice，自然不渲染。
      if (a.practice) {
        const pr = document.createElement("a");
        pr.className = "btn-practice";
        pr.href = a.practice;
        pr.target = "_blank";
        pr.rel = "noopener noreferrer";
        pr.textContent = tr("notes.practice");
        row.appendChild(pr);
      }

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

    // #map：知识点地图（与空 hash 同一视图，但链接可分享、前进/后退可用）
    if (raw === "map") {
      renderSide({ mode: "cats", activeMap: true });
      renderWelcome();
      return;
    }

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

    // 空 hash（或未知 id）：回到分类列表 + 欢迎页 + 知识点地图
    renderSide({ mode: "cats", activeMap: true });
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

    // 进度：初始打一遍 ✓，之后每次 markRead 广播的事件也刷新侧栏与地图
    if (window.LA_PROGRESS) {
      updateReadMarks();
      updateTopicMarks();
      window.addEventListener("la-progress", () => {
        updateReadMarks();
        updateTopicMarks();
      });
    }

    if (btn) btn.addEventListener("click", () => { I18N.toggle(); });

    I18N.onChange(() => {
      syncButton();
      syncTitle();
      route();          // 按当前 hash 用新语言重画（目录一起重建）
    });
  })();
})();
