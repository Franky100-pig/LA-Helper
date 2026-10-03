"use strict";
/* 讲义独立页的页面逻辑：左侧目录 + 右侧正文，用 location.hash 做路由。
 *
 * 依赖（都在 <head> 里先加载）：
 *   i18n.js   -> window.LA_I18N
 *   notes.js  -> window.LA_NOTES.{zh,en}.byLang().blocksHtml()
 *
 * 路由约定：notes.html#cofactor 直接打开某一篇；没写 hash 就显示第一篇。
 * 换篇 = 改 hash（pushState 语义），所以浏览器的前进/后退、复制链接分享都正常。
 */
(function () {
  const I18N = window.LA_I18N;
  const tr = I18N.t;
  const el = (id) => document.getElementById(id);

  const listBox = el("noteList");
  const view = el("noteView");
  if (!listBox || !view) return;

  const articles = () => window.LA_NOTES.byLang(I18N.get());

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
  // 目录
  // -------------------------------------------------------------------------
  function renderList(activeId) {
    listBox.textContent = "";
    for (const a of articles()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "note-item" + (a.id === activeId ? " on" : "");
      btn.dataset.note = a.id;
      btn.textContent = a.title;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = a.tag;
      btn.appendChild(tag);
      btn.addEventListener("click", () => { location.hash = a.id; });  // 走 hash，保留前进/后退
      listBox.appendChild(btn);
    }
  }

  // -------------------------------------------------------------------------
  // 正文
  // -------------------------------------------------------------------------
  function renderArticle(id) {
    const list = articles();
    const a = list.find((x) => x.id === id) || list[0];   // 未知 id 就回落第一篇
    if (!a) return;

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

    // 标签页标题跟着当前这篇走，收藏/分享时更好认
    document.title = a.title + " · LA Helper";
    renderList(a.id);
    if (id !== a.id) location.hash = a.id;                // 归一化非法 hash
  }

  function route() {
    const id = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    if (!id) { renderArticle(articles()[0] && articles()[0].id); return; }
    renderArticle(id);
  }

  window.addEventListener("hashchange", route);

  // -------------------------------------------------------------------------
  // 中 / 英一键切换：与其它页共用 localStorage["la-lang"]，切完重画目录与正文
  // -------------------------------------------------------------------------
  (function initLang() {
    const btn = el("langToggle");
    const syncButton = () => { if (btn) btn.textContent = I18N.toggleLabel(); };

    // 讲义页的 <title> 挂不上 data-i18n（<title> 不在 apply() 的扫描范围内），
    // 平时由 renderArticle() 按当前文章重设。但 articles() 为空时 renderArticle
    // 会直接 return，标题就停在 HTML 里写死的那句中文上 —— 切到英文也不变。
    // 这里先按字典兜一层，route() 随后会用文章标题盖掉它。
    const syncTitle = () => I18N.syncDocTitle("notes.label");

    I18N.apply(document);
    syncTitle();
    renderList(null);
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
