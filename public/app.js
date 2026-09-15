// Zomaal Shop admin panel — plain vanilla JS, no build step. Talks to the
// existing JSON API under /admin/** (src/super-admin/**). Tokens are kept
// in localStorage for this first pass — fine for local use, but a
// production hardening pass should move to httpOnly cookies instead.

const ACCESS_TOKEN_KEY = "zomaal_admin_access_token";
const REFRESH_TOKEN_KEY = "zomaal_admin_refresh_token";

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function setTokens(tokens) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function parseErrorMessage(res) {
  try {
    const body = await res.json();
    let message =
      typeof body?.message === "string"
        ? body.message
        : Array.isArray(body?.message)
          ? body.message.join(", ")
          : `Request failed with status ${res.status}`;
    // CSV import returns a per-row error list alongside the message.
    if (Array.isArray(body?.errors) && body.errors.length) {
      message += "\n" + body.errors.join("\n");
    }
    return message;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

// Wraps fetch with the stored access token and a single silent-refresh
// retry on 401. FormData bodies keep the browser's multipart boundary
// header; non-JSON responses (CSV export) come back as text.
async function authedFetch(path, init, isRetry) {
  const accessToken = getAccessToken();
  const isForm = init && init.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init && init.headers),
    },
  });

  if (res.status === 401 && !isRetry) {
    const refreshed = await tryRefresh();
    if (refreshed) return authedFetch(path, init, true);
    clearTokens();
    window.location.replace("/login");
    throw new Error("Session expired");
  }

  if (!res.ok) throw new Error(await parseErrorMessage(res));
  const type = res.headers.get("content-type") || "";
  return type.includes("application/json") ? res.json() : res.text();
}

async function tryRefresh() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  const res = await fetch("/admin/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;

  const data = await res.json();
  setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
  return true;
}

// --- Login page ---

function initLoginPage() {
  if (getAccessToken()) {
    window.location.replace("/dashboard");
    return;
  }

  const form = document.getElementById("login-form");
  const errorEl = document.getElementById("login-error");
  const submitBtn = document.getElementById("login-submit");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = "Signing in…";

    const username = form.elements.username.value;
    const password = form.elements.password.value;

    try {
      const res = await fetch("/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      const data = await res.json();
      setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
      window.location.href = "/dashboard";
    } catch (err) {
      errorEl.textContent = err.message || "Could not sign in.";
      errorEl.classList.remove("hidden");
      submitBtn.disabled = false;
      submitBtn.textContent = "Sign in";
    }
  });
}

// --- Shared admin shell (sidebar/topbar) on every protected page ---

function initAdminShell() {
  if (!getAccessToken()) {
    window.location.replace("/login");
    return;
  }

  setupSidebarDrawer();
  labelStackTables();

  authedFetch("/admin/me")
    .then((admin) => {
      const usernameEl = document.getElementById("admin-username");
      const initialsEl = document.getElementById("admin-avatar-initials");
      if (usernameEl) usernameEl.textContent = admin.username;
      if (initialsEl) initialsEl.textContent = admin.username.slice(0, 2).toUpperCase();
    })
    .catch(() => window.location.replace("/login"));

  const logoutBtn = document.getElementById("admin-logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await authedFetch("/admin/auth/logout", { method: "POST" });
      } finally {
        clearTokens();
        window.location.href = "/login";
      }
    });
  }
}

// Below the lg breakpoint the sidebar slides in over the page. Closes on the
// X, the backdrop, Escape, or navigating; locks page scroll while open; and
// resets itself if the window is resized up to desktop width.
function setupSidebarDrawer() {
  const sidebar = document.getElementById("admin-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");
  const openBtn = document.getElementById("sidebar-open-btn");
  const closeBtn = document.getElementById("sidebar-close-btn");
  if (!sidebar || !backdrop || !openBtn) return;

  const desktop = window.matchMedia("(min-width: 1024px)");

  function setOpen(open) {
    sidebar.classList.toggle("-translate-x-full", !open);
    backdrop.classList.toggle("hidden", !open);
    document.body.classList.toggle("overflow-hidden", open);
    openBtn.setAttribute("aria-expanded", String(open));
    if (open) (closeBtn || sidebar).focus();
  }

  openBtn.addEventListener("click", () => setOpen(true));
  closeBtn && closeBtn.addEventListener("click", () => {
    setOpen(false);
    openBtn.focus();
  });
  backdrop.addEventListener("click", () => setOpen(false));
  sidebar.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => !desktop.matches && setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openBtn.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      openBtn.focus();
    }
  });
  desktop.addEventListener("change", (e) => e.matches && setOpen(false));
}

// Copies each column header onto its cells as data-label, which the phone
// "stacked card" table CSS (views/partials/head.hbs) prints beside values.
// Rows are rendered async, so it re-labels whenever a tbody changes.
function labelStackTables() {
  document.querySelectorAll("table.stack").forEach((table) => {
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const apply = () => {
      table.querySelectorAll("tbody tr").forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          if (td.colSpan > 1) {
            td.classList.add("stack-full");
            return;
          }
          td.dataset.label = headers[i] || "";
          td.classList.toggle("stack-primary", i === 0);
          td.classList.toggle("stack-actions", /^actions$/i.test(headers[i] || ""));
        });
      });
    };
    apply();
    table.querySelectorAll("tbody").forEach((tbody) => new MutationObserver(apply).observe(tbody, { childList: true }));
  });
}

// --- Settings page: change password ---

function initSettingsPage() {
  const form = document.getElementById("change-password-form");
  const statusEl = document.getElementById("password-status");
  const usernameField = document.getElementById("settings-username");
  if (usernameField) {
    authedFetch("/admin/me")
      .then((admin) => (usernameField.value = admin.username))
      .catch(() => undefined);
  }
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.classList.add("hidden");

    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const confirmPassword = form.elements.confirmPassword.value;

    if (newPassword !== confirmPassword) {
      showStatus(statusEl, "New passwords do not match.", true);
      return;
    }

    try {
      const res = await authedFetch("/admin/me/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      showStatus(statusEl, res.message, false);
      form.reset();
    } catch (err) {
      showStatus(statusEl, err.message || "Something went wrong.", true);
    }
  });
}

function showStatus(el, text, isError) {
  el.textContent = text;
  el.classList.remove("hidden");
  el.classList.toggle("text-red-600", isError);
  el.classList.toggle("text-emerald-600", !isError);
}

function showFormError(el, err) {
  el.textContent = (err && err.message) || "Something went wrong.";
  el.classList.remove("hidden");
}

// Small fixed accent palette, cycled by index — the DB doesn't store a
// per-category/product color, so this just keeps cards visually varied.
const ICON_PALETTE = [
  { bg: "#fef3c7", color: "#b45309" },
  { bg: "#ede9fe", color: "#6d28d9" },
  { bg: "#e0f2fe", color: "#0369a1" },
  { bg: "#f5f5f4", color: "#57534e" },
];

function iconStyle(index) {
  return ICON_PALETTE[index % ICON_PALETTE.length];
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Segmented filter buttons: exactly one looks selected. (Toggling each
// class separately — not chained with || — so every class really flips.)
function setSegmentActive(buttons, activeBtn) {
  buttons.forEach((b) => {
    const on = b === activeBtn;
    b.classList.toggle("bg-white", on);
    b.classList.toggle("shadow-sm", on);
    b.classList.toggle("text-zinc-900", on);
    b.classList.toggle("text-zinc-500", !on);
  });
}

function formatDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(iso) {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const units = [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

function money(amount, currency) {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

const BADGE_TONES = {
  green: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
  gray: "bg-zinc-100 text-zinc-600",
};

function badge(text, tone) {
  return el("span", `inline-block text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${BADGE_TONES[tone] || BADGE_TONES.gray}`, text);
}

function showBanner(elNode, text) {
  elNode.textContent = text;
  elNode.classList.remove("hidden");
}

function emptyRow(tbody, colspan, text) {
  tbody.innerHTML = "";
  const row = el("tr");
  const cell = el("td", "px-4 py-6 text-center text-zinc-400 text-sm", text);
  cell.colSpan = colspan;
  row.appendChild(cell);
  tbody.appendChild(row);
}

const HEALTH_BADGE = {
  HEALTHY: ["Healthy", "green"],
  STALE: ["Stale", "amber"],
  ERROR: ["Sync error", "red"],
  DISCONNECTED: ["Disconnected", "gray"],
};

const PLATFORM_LABEL = { SHOPIFY: "Shopify", YOUCAN: "YouCan", LIGHTFUNNELS: "Lightfunnels", MANUAL: "Manual" };

// --- Dashboard page ---

function initDashboardPage() {
  const errorEl = document.getElementById("dashboard-error");

  authedFetch("/admin/dashboard/summary")
    .then((d) => {
      const set = (id, value) => (document.getElementById(id).textContent = value);

      set("kpi-merchants", d.merchants.total);
      set("kpi-merchants-sub", `${d.merchants.active} active · ${d.merchants.suspended} suspended · ${d.merchants.new30d} new in 30 days`);
      set("kpi-orders", d.orders.last30d);
      set("kpi-orders-sub", trendText(d.orders.last30d, d.orders.prev30d, "vs previous 30 days"));
      const attention = d.integrations.ERROR + d.integrations.STALE + d.integrations.DISCONNECTED;
      set("kpi-integrations", attention);
      set("kpi-integrations-sub", `of ${d.integrations.total} · ${d.integrations.ERROR} error · ${d.integrations.STALE} stale · ${d.integrations.DISCONNECTED} disconnected`);
      set("kpi-blacklist", d.blacklistedCustomers);
      set("kpi-shop-pending", d.shop.pendingOrders);
      set("kpi-shop-orders", d.shop.orders30d);
      set("kpi-shop-revenue", money(d.shop.revenue30d, d.shop.currency));

      set("kpi-products", d.catalog.totalProducts);
      set("kpi-products-active", d.catalog.activeProducts);
      set("kpi-categories", d.catalog.totalCategories);
      set("kpi-lowstock", d.catalog.lowStockCount);

      const signupsTotal = d.merchantSignups.reduce((sum, p) => sum + p.count, 0);
      set("signups-total", `${signupsTotal} total`);
      const chart = document.getElementById("signups-chart");
      renderBarChart(chart, d.merchantSignups);
      // The chart is drawn at its container's pixel width, so redraw when
      // the layout width changes (phone rotation, sidebar breakpoint, resize).
      let lastWidth = chart.clientWidth;
      let resizeTimer = null;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (chart.clientWidth !== lastWidth) {
            lastWidth = chart.clientWidth;
            renderBarChart(chart, d.merchantSignups);
          }
        }, 150);
      });

      const lowStock = document.getElementById("low-stock-list");
      lowStock.innerHTML = "";
      if (d.catalog.lowStockItems.length === 0) {
        lowStock.appendChild(el("div", "px-2 py-2 text-sm text-zinc-400", "Nothing is low on stock."));
      }
      d.catalog.lowStockItems.forEach((item) => {
        const row = el("div", "flex items-center justify-between px-2 py-2 rounded-lg");
        row.appendChild(el("div", "text-[13px] font-medium", item.name));
        row.appendChild(badge(`${item.stock} left`, item.stock < 5 ? "red" : "amber"));
        lowStock.appendChild(row);
      });

      renderActivityList(document.getElementById("recent-activity"), d.recentActivity);
    })
    .catch((err) => showBanner(errorEl, err.message || "Could not load the dashboard."));
}

function trendText(current, previous, suffix) {
  if (previous === 0) return current === 0 ? `No change ${suffix}` : `Up from 0 ${suffix}`;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct)}% ${suffix}`;
}

// Single-series daily bar chart (plain SVG, no library). One neutral hue —
// a single series needs no legend; the card title names it. Every bar has
// a full-height hit target and a hover tooltip with the exact value.
function renderBarChart(container, points) {
  container.innerHTML = "";
  const width = container.clientWidth || 600;
  const height = container.clientHeight || 160;
  const pad = { top: 8, right: 4, bottom: 20, left: 28 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.count));
  const niceMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const slot = plotW / points.length;
  const gap = 2;
  const barW = Math.max(2, slot - gap);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "New merchants per day over the last 30 days");

  const mk = (tag, attrs) => {
    const node = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
    return node;
  };

  // Recessive grid: baseline + top value line only.
  [0, niceMax].forEach((v) => {
    const y = pad.top + plotH - (v / niceMax) * plotH;
    svg.appendChild(mk("line", { x1: pad.left, x2: width - pad.right, y1: y, y2: y, stroke: "#e4e4e7", "stroke-width": 1 }));
    const label = mk("text", { x: pad.left - 6, y: y + 3, "text-anchor": "end", "font-size": 10, fill: "#71717a" });
    label.textContent = v;
    svg.appendChild(label);
  });

  const tooltip = el("div", "pointer-events-none absolute hidden rounded-md bg-zinc-900 px-2 py-1 text-[11px] text-white whitespace-nowrap");
  container.appendChild(tooltip);

  points.forEach((p, i) => {
    const x = pad.left + i * slot + gap / 2;
    const h = (p.count / niceMax) * plotH;
    const y = pad.top + plotH - h;
    if (p.count > 0) {
      // Rounded top ends, square at the baseline.
      const r = Math.min(4, barW / 2, h);
      const path = `M${x},${pad.top + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${pad.top + plotH} Z`;
      svg.appendChild(mk("path", { d: path, fill: "#18181b" }));
    }
    const hit = mk("rect", { x: pad.left + i * slot, y: pad.top, width: slot, height: plotH, fill: "transparent" });
    hit.addEventListener("mouseenter", () => {
      const date = new Date(`${p.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
      tooltip.textContent = `${date}: ${p.count} new merchant${p.count === 1 ? "" : "s"}`;
      tooltip.classList.remove("hidden");
      const left = Math.min(Math.max(pad.left + i * slot + slot / 2 - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(y - 28, 0)}px`;
    });
    hit.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
    svg.appendChild(hit);

    const showMiddle = plotW >= 320;
    if (i === 0 || i === points.length - 1 || (showMiddle && i === Math.floor(points.length / 2))) {
      const anchor = i === 0 ? "start" : i === points.length - 1 ? "end" : "middle";
      const labelX = i === 0 ? pad.left : i === points.length - 1 ? width - pad.right : pad.left + i * slot + slot / 2;
      const label = mk("text", { x: labelX, y: height - 4, "text-anchor": anchor, "font-size": 10, fill: "#71717a" });
      label.textContent = new Date(`${p.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
      svg.appendChild(label);
    }
  });

  container.insertBefore(svg, tooltip);

  if (points.every((p) => p.count === 0)) {
    container.appendChild(
      el("div", "absolute inset-0 flex items-center justify-center text-[12.5px] text-zinc-400", "No new merchants in the last 30 days"),
    );
  }
}

function renderActivityList(container, items) {
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.appendChild(el("div", "px-2 py-2 text-sm text-zinc-400", "No admin activity recorded yet."));
    return;
  }
  items.forEach((item) => {
    const row = el("div", "flex items-start justify-between gap-3 px-2 py-2 rounded-lg");
    row.appendChild(el("div", "text-[13px]", item.summary));
    const when = el("div", "text-[11.5px] text-zinc-400 whitespace-nowrap", timeAgo(item.createdAt));
    when.title = formatDateTime(item.createdAt);
    row.appendChild(when);
    container.appendChild(row);
  });
}

// --- Categories page ---

function initCategoriesPage() {
  const grid = document.getElementById("categories-grid");
  const errorEl = document.getElementById("categories-error");
  const dialog = document.getElementById("category-dialog");
  const form = document.getElementById("category-form");
  const formError = document.getElementById("category-form-error");
  const titleEl = document.getElementById("category-dialog-title");
  const activeRow = document.getElementById("category-active-row");

  function openDialog(category) {
    form.reset();
    formError.classList.add("hidden");
    if (category) {
      titleEl.textContent = "Edit Category";
      form.elements.id.value = category.id;
      form.elements.name.value = category.name;
      form.elements.sortOrder.value = category.sortOrder;
      form.elements.isActive.checked = category.isActive;
      activeRow.classList.remove("hidden");
      activeRow.classList.add("flex");
    } else {
      titleEl.textContent = "Add Category";
      form.elements.id.value = "";
      activeRow.classList.add("hidden");
      activeRow.classList.remove("flex");
    }
    dialog.showModal();
  }

  async function loadCategories() {
    errorEl.classList.add("hidden");
    try {
      const categories = await authedFetch("/admin/shop/categories");
      renderCategories(categories);
    } catch (err) {
      showFormError(errorEl, err);
    }
  }

  function renderCategories(categories) {
    grid.innerHTML = "";
    if (categories.length === 0) {
      grid.appendChild(el("div", "col-span-full text-sm text-zinc-400", "No categories yet — add one to get started."));
      return;
    }

    categories.forEach((category, index) => {
      const palette = iconStyle(index);
      const card = el("div", "border border-zinc-200 rounded-xl p-5 flex flex-col gap-3.5");

      const top = el("div", "flex items-start justify-between");
      const iconBox = el("div", "h-11 w-11 rounded-[10px] flex items-center justify-center");
      iconBox.style.background = palette.bg;
      iconBox.innerHTML =
        `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${palette.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 12 22 2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="${palette.color}" stroke="none"/></svg>`;
      top.appendChild(iconBox);

      const actions = el("div", "flex gap-1.5");
      const editBtn = el("button", "h-6 w-6 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-zinc-50");
      editBtn.type = "button";
      editBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
      editBtn.addEventListener("click", () => openDialog(category));
      const deleteBtn = el("button", "h-6 w-6 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-red-50");
      deleteBtn.type = "button";
      deleteBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
      deleteBtn.addEventListener("click", () => deleteCategory(category));
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      top.appendChild(actions);
      card.appendChild(top);

      const info = el("div");
      info.appendChild(el("div", "text-[14.5px] font-bold", category.name));
      info.appendChild(
        el("div", "text-xs text-zinc-400", `${category.productCount} product${category.productCount === 1 ? "" : "s"}${category.isActive ? "" : " · Inactive"}`),
      );
      card.appendChild(info);

      grid.appendChild(card);
    });
  }

  async function deleteCategory(category) {
    if (!confirm(`Delete "${category.name}"?`)) return;
    try {
      await authedFetch(`/admin/shop/categories/${category.id}`, { method: "DELETE" });
      loadCategories();
    } catch (err) {
      errorEl.textContent = err.message || "Could not delete category.";
      errorEl.classList.remove("hidden");
    }
  }

  document.getElementById("add-category-btn").addEventListener("click", () => openDialog(null));
  document.getElementById("category-cancel-btn").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");

    const id = form.elements.id.value;
    const payload = {
      name: form.elements.name.value,
      sortOrder: Number(form.elements.sortOrder.value) || 0,
    };
    if (id) payload.isActive = form.elements.isActive.checked;

    try {
      if (id) {
        await authedFetch(`/admin/shop/categories/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await authedFetch("/admin/shop/categories", { method: "POST", body: JSON.stringify(payload) });
      }
      dialog.close();
      loadCategories();
    } catch (err) {
      showFormError(formError, err);
    }
  });

  loadCategories();
}

// --- Products page ---

function initProductsPage() {
  const tbody = document.getElementById("products-tbody");
  const errorEl = document.getElementById("products-error");
  const noticeEl = document.getElementById("products-notice");
  const dialog = document.getElementById("product-dialog");
  const form = document.getElementById("product-form");
  const formError = document.getElementById("product-form-error");
  const titleEl = document.getElementById("product-dialog-title");
  const searchInput = document.getElementById("product-search");
  const categoryFilter = document.getElementById("product-category-filter");
  const statusButtons = document.querySelectorAll(".product-status-filter-btn");
  const submitBtn = document.getElementById("product-submit-btn");
  const imagesGrid = document.getElementById("product-images-grid");
  const imagesInput = document.getElementById("product-images-input");
  const imagesDrop = document.getElementById("product-images-drop");
  const imagesCount = document.getElementById("product-images-count");
  const imagesHint = document.getElementById("product-images-hint");
  const imagesError = document.getElementById("product-images-error");
  const variantsList = document.getElementById("variants-list");
  const specsList = document.getElementById("specs-list");
  const stockHint = document.getElementById("product-stock-hint");

  let categories = [];
  let statusFilter = "";
  let searchTimer = null;
  let editing = null;

  function hideBanners() {
    errorEl.classList.add("hidden");
    noticeEl.classList.add("hidden");
  }

  function currentParams() {
    const params = new URLSearchParams();
    if (categoryFilter.value) params.set("categoryId", categoryFilter.value);
    if (statusFilter) params.set("status", statusFilter);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    return params;
  }

  function populateCategorySelects() {
    const selected = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    form.elements.categoryId.innerHTML = "";
    categories.forEach((category) => {
      categoryFilter.appendChild(new Option(category.name, category.id));
      form.elements.categoryId.appendChild(new Option(category.name, category.id));
    });
    categoryFilter.value = selected;
  }

  function openDialog(product) {
    form.reset();
    formError.classList.add("hidden");
    editing = product;
    if (product) {
      titleEl.textContent = "Edit Product";
      form.elements.id.value = product.id;
      form.elements.name.value = product.name;
      form.elements.categoryId.value = product.category.id;
      form.elements.sku.value = product.sku || "";
      form.elements.description.value = product.description || "";
      form.elements.price.value = product.price;
      form.elements.stock.value = product.stock;
      form.elements.status.value = product.status;
      form.elements.compareAtPrice.value = product.compareAtPrice || "";
      form.elements.unitLabel.value = product.unitLabel || "piece";
      form.elements.isFeatured.checked = !!product.isFeatured;
    } else {
      titleEl.textContent = "Add Product";
      form.elements.id.value = "";
    }
    variantsList.innerHTML = "";
    ((product && product.variants) || []).forEach((v) => addVariantRow(v));
    specsList.innerHTML = "";
    ((product && product.specs) || []).forEach((sp) => addSpecRow(sp));
    syncStockField();
    clearPending();
    showImagesError("");
    renderGallery();
    dialog.showModal();
  }

  async function loadProducts() {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-zinc-400 text-sm">Loading…</td></tr>';
    try {
      const products = await authedFetch(`/admin/shop/products?${currentParams().toString()}`);
      renderProducts(products);
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load products.");
    }
  }

  async function loadCategories() {
    categories = await authedFetch("/admin/shop/categories");
    populateCategorySelects();
  }

  function renderProducts(products) {
    if (products.length === 0) {
      emptyRow(tbody, 6, "No products match these filters.");
      return;
    }
    tbody.innerHTML = "";

    products.forEach((product, index) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0");

      const nameCell = el("td", "px-4 py-3");
      const nameWrap = el("div", "flex items-center gap-3");
      if (product.imageUrl) {
        const img = el("img", "h-9 w-9 rounded-lg object-cover border border-zinc-200 shrink-0");
        img.src = product.imageUrl;
        img.alt = "";
        img.loading = "lazy";
        nameWrap.appendChild(img);
      } else {
        const palette = iconStyle(index);
        const iconBox = el("div", "h-9 w-9 rounded-lg flex items-center justify-center shrink-0");
        iconBox.style.background = palette.bg;
        iconBox.title = "No photo yet";
        iconBox.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${palette.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/></svg>`;
        nameWrap.appendChild(iconBox);
      }
      const nameText = el("div");
      nameText.appendChild(el("div", "font-medium", product.name));
      const meta = [product.sku ? `SKU: ${product.sku}` : "", product.images.length ? `${product.images.length} image${product.images.length === 1 ? "" : "s"}` : "No images"].filter(Boolean);
      nameText.appendChild(el("div", "text-[11.5px] text-zinc-400", meta.join(" · ")));
      nameWrap.appendChild(nameText);
      nameCell.appendChild(nameWrap);
      row.appendChild(nameCell);

      row.appendChild(el("td", "px-4 py-3 text-zinc-500", product.category.name));
      const priceCell = el("td", "px-4 py-3 tabular-nums");
      priceCell.appendChild(el("div", "font-medium", product.price));
      if (product.compareAtPrice) priceCell.appendChild(el("div", "text-[11.5px] text-zinc-400 line-through", product.compareAtPrice));
      row.appendChild(priceCell);
      const stockCell = el("td", `px-4 py-3 tabular-nums ${product.lowStock ? "font-semibold text-amber-700" : ""}`);
      stockCell.appendChild(el("div", "", `${product.stock} ${product.unitLabel && product.unitLabel !== "piece" ? product.unitLabel : ""}`.trim()));
      if (product.variants && product.variants.length) stockCell.appendChild(el("div", "text-[11.5px] font-normal text-zinc-400", `${product.variants.length} option${product.variants.length === 1 ? "" : "s"}`));
      row.appendChild(stockCell);

      const statusCell = el("td", "px-4 py-3");
      statusCell.appendChild(badge(product.status === "ACTIVE" ? "Active" : "Draft", product.status === "ACTIVE" ? "green" : "gray"));
      if (product.isFeatured) {
        statusCell.appendChild(document.createTextNode(" "));
        statusCell.appendChild(badge("Featured", "amber"));
      }
      row.appendChild(statusCell);

      const actionsCell = el("td", "px-4 py-3 text-right");
      const actionsWrap = el("div", "flex justify-end gap-1.5");
      const editBtn = el("button", "h-7 w-7 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-zinc-50");
      editBtn.type = "button";
      editBtn.title = "Edit";
      editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
      editBtn.addEventListener("click", () => openDialog(product));
      const deleteBtn = el("button", "h-7 w-7 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-red-50");
      deleteBtn.type = "button";
      deleteBtn.title = "Delete";
      deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
      deleteBtn.addEventListener("click", () => deleteProduct(product));
      actionsWrap.appendChild(editBtn);
      actionsWrap.appendChild(deleteBtn);
      actionsCell.appendChild(actionsWrap);
      row.appendChild(actionsCell);

      tbody.appendChild(row);
    });
  }

  async function deleteProduct(product) {
    if (!confirm(`Delete "${product.name}"?`)) return;
    hideBanners();
    try {
      await authedFetch(`/admin/shop/products/${product.id}`, { method: "DELETE" });
      loadProducts();
    } catch (err) {
      showBanner(errorEl, err.message || "Could not delete product.");
    }
  }

  document.getElementById("add-product-btn").addEventListener("click", () => {
    hideBanners();
    if (categories.length === 0) {
      showBanner(errorEl, "Add a category first (Categories page), then add products.");
      return;
    }
    openDialog(null);
  });
  document.getElementById("product-cancel-btn").addEventListener("click", () => dialog.close());

  // ---- Options (variants) and specifications editors ----
  const CELL = "min-w-0 border border-zinc-200 rounded-md px-2 py-1.5 text-[12.5px] focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400";

  function removeButton(onClick, label) {
    const btn = el("button", "h-8 w-8 shrink-0 rounded-md border border-zinc-200 flex items-center justify-center text-zinc-500 hover:bg-red-50 hover:text-red-600");
    btn.type = "button";
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    btn.addEventListener("click", onClick);
    return btn;
  }

  function field(name, attrs, value) {
    const input = el("input", CELL);
    input.dataset.field = name;
    Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
    if (value !== undefined && value !== null) input.value = value;
    return input;
  }

  function addVariantRow(v) {
    v = v || {};
    const row = el("div", "variant-row grid grid-cols-6 sm:grid-cols-[1fr_1fr_36px_1fr_0.8fr_1fr_auto_auto] items-center gap-1.5 rounded-md bg-zinc-50 p-1.5");
    if (v.id) row.dataset.id = v.id;
    const size = field("size", { placeholder: "Size", maxlength: "40", class: `${CELL} col-span-3 sm:col-span-1` }, v.size);
    const color = field("color", { placeholder: "Color", maxlength: "40", class: `${CELL} col-span-3 sm:col-span-1` }, v.color);
    const hex = field("colorHex", { type: "color", title: "Swatch color", class: "h-8 w-9 col-span-1 rounded-md border border-zinc-200 bg-white p-0.5" }, v.colorHex || "#000000");
    hex.dataset.touched = v.colorHex ? "1" : "";
    hex.addEventListener("input", () => { hex.dataset.touched = "1"; });
    const price = field("price", { type: "number", min: "0", step: "0.01", placeholder: "Price", title: "Leave empty to use the product price", class: `${CELL} col-span-2 sm:col-span-1` }, v.price);
    const stock = field("stock", { type: "number", min: "0", step: "1", placeholder: "Stock", required: "", class: `${CELL} col-span-3 sm:col-span-1` }, v.stock !== undefined ? v.stock : 0);
    stock.addEventListener("input", syncStockField);
    const sku = field("sku", { placeholder: "SKU", maxlength: "60", class: `${CELL} col-span-3 sm:col-span-1` }, v.sku);
    const activeLabel = el("label", "col-span-2 sm:col-span-1 flex items-center gap-1 text-[11.5px] text-zinc-600");
    const active = el("input");
    active.type = "checkbox";
    active.dataset.field = "isActive";
    active.checked = v.isActive !== false;
    activeLabel.append(active, document.createTextNode("On"));
    activeLabel.title = "Merchants can buy this option";
    const remove = removeButton(() => { row.remove(); syncStockField(); }, "Remove option");
    remove.classList.add("justify-self-end");
    row.append(size, color, hex, price, stock, sku, activeLabel, remove);
    variantsList.appendChild(row);
    syncStockField();
    return row;
  }

  function addSpecRow(sp) {
    sp = sp || {};
    const row = el("div", "spec-row flex items-center gap-1.5");
    const label = field("label", { placeholder: "Label", maxlength: "60", class: `${CELL} w-2/5` }, sp.label);
    const value = field("value", { placeholder: "Value", maxlength: "200", class: `${CELL} flex-1` }, sp.value);
    row.append(label, value, removeButton(() => row.remove(), "Remove specification"));
    specsList.appendChild(row);
    return row;
  }

  function variantRows() {
    return Array.from(variantsList.querySelectorAll(".variant-row"));
  }

  function syncStockField() {
    const rows = variantRows();
    const has = rows.length > 0;
    form.elements.stock.disabled = has;
    stockHint.classList.toggle("hidden", !has);
    if (has) {
      form.elements.stock.value = rows.reduce((sum, r) => sum + (Number(r.querySelector('[data-field="stock"]').value) || 0), 0);
    }
  }

  function collectVariants() {
    return variantRows().map((row) => {
      const get = (name) => row.querySelector(`[data-field="${name}"]`);
      const text = (name) => get(name).value.trim() || undefined;
      const hex = get("colorHex");
      return {
        id: row.dataset.id || undefined,
        size: text("size"),
        color: text("color"),
        colorHex: hex.dataset.touched ? hex.value : undefined,
        sku: text("sku"),
        price: get("price").value === "" ? null : Number(get("price").value),
        stock: Number(get("stock").value) || 0,
        isActive: get("isActive").checked,
      };
    });
  }

  function collectSpecs() {
    return Array.from(specsList.querySelectorAll(".spec-row"))
      .map((row) => ({
        label: row.querySelector('[data-field="label"]').value.trim(),
        value: row.querySelector('[data-field="value"]').value.trim(),
      }))
      .filter((sp) => sp.label || sp.value);
  }

  const comparableVariants = (list) => JSON.stringify((list || []).map((v) => ({
    id: v.id || undefined, size: v.size || undefined, color: v.color || undefined, colorHex: v.colorHex || undefined,
    sku: v.sku || undefined, price: v.price === null || v.price === undefined || v.price === "" ? null : Number(v.price),
    stock: Number(v.stock) || 0, isActive: v.isActive !== false,
  })));
  const comparableSpecs = (list) => JSON.stringify((list || []).map((sp) => ({ label: sp.label, value: sp.value })));

  document.getElementById("add-variant-btn").addEventListener("click", () => {
    addVariantRow().querySelector('[data-field="size"]').focus();
  });
  document.getElementById("add-spec-btn").addEventListener("click", () => {
    addSpecRow().querySelector('[data-field="label"]').focus();
  });

  // ---- Image gallery in the product dialog ----
  // Saved images (editing.images) and newly picked files (pending) render in
  // one grid; the first tile is the cover. New files upload when the product
  // is saved — in Add mode that's right after the product is created.
  // Removing a saved image or changing the cover saves immediately.
  const MAX_IMAGES = 8;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  let pending = [];

  function clearPending() {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending = [];
  }

  function savedImages() {
    return (editing && editing.images) || [];
  }

  function showImagesError(text) {
    imagesError.textContent = text;
    imagesError.classList.toggle("hidden", !text);
  }

  // Same check the server makes: look at the file's first bytes, not its
  // extension — a renamed non-image reports image/png as its type.
  async function sniffImageType(file) {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v)) return "image/png";
    const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    return null;
  }

  async function addFiles(fileList) {
    const errors = [];
    for (const file of Array.from(fileList || [])) {
      if (savedImages().length + pending.length >= MAX_IMAGES) {
        errors.push(`A product can have up to ${MAX_IMAGES} images.`);
        break;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(`"${file.name}" is larger than 5 MB.`);
        continue;
      }
      const realType = await sniffImageType(file).catch(() => null);
      if (!realType || !IMAGE_TYPES.includes(realType)) {
        errors.push(`"${file.name}" isn't a valid JPEG, PNG or WebP image.`);
        continue;
      }
      pending.push({ key: `${file.name}-${file.size}-${Math.random()}`, file, url: URL.createObjectURL(file) });
    }
    showImagesError(errors.join("\n"));
    renderGallery();
  }

  function imageTile(src, { cover, isNew, onRemove, onMakeCover, removeLabel }) {
    const tile = el("div", "group relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100");
    const img = el("img", "h-full w-full object-cover");
    img.src = src;
    img.alt = "";
    tile.appendChild(img);

    const badges = el("div", "absolute left-1 top-1 flex flex-col items-start gap-1");
    if (cover) badges.appendChild(el("span", "rounded bg-zinc-900/85 px-1.5 py-0.5 text-[10px] font-semibold text-white", "Cover"));
    if (isNew) badges.appendChild(el("span", "rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700", "New"));
    tile.appendChild(badges);

    const remove = el("button", "absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-zinc-700 shadow hover:bg-white hover:text-red-600");
    remove.type = "button";
    remove.title = removeLabel;
    remove.setAttribute("aria-label", removeLabel);
    remove.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    remove.addEventListener("click", onRemove);
    tile.appendChild(remove);

    if (onMakeCover) {
      const makeCover = el("button", "absolute inset-x-1 bottom-1 rounded bg-white/95 py-1 text-[10.5px] font-semibold text-zinc-800 shadow hover:bg-white", "Make cover");
      makeCover.type = "button";
      makeCover.addEventListener("click", onMakeCover);
      tile.appendChild(makeCover);
    }
    return tile;
  }

  function renderGallery() {
    imagesGrid.innerHTML = "";
    const saved = savedImages();
    const total = saved.length + pending.length;

    saved.forEach((image, index) => {
      imagesGrid.appendChild(
        imageTile(image.url, {
          cover: index === 0,
          removeLabel: "Remove image",
          onRemove: () => removeSavedImage(image),
          onMakeCover: index === 0 ? null : () => makeSavedCover(image),
        }),
      );
    });

    pending.forEach((item, index) => {
      const isCover = saved.length === 0 && index === 0;
      imagesGrid.appendChild(
        imageTile(item.url, {
          cover: isCover,
          isNew: true,
          removeLabel: "Don't upload this image",
          onRemove: () => {
            URL.revokeObjectURL(item.url);
            pending = pending.filter((p) => p !== item);
            renderGallery();
          },
          // Choosing the cover among not-yet-uploaded images is only possible
          // before any image is saved; afterwards, use "Make cover" once saved.
          onMakeCover: saved.length === 0 && index > 0 ? () => {
            pending = [item, ...pending.filter((p) => p !== item)];
            renderGallery();
          } : null,
        }),
      );
    });

    imagesGrid.classList.toggle("hidden", total === 0);
    imagesCount.textContent = total ? `${total} / ${MAX_IMAGES}` : "";
    imagesDrop.classList.toggle("hidden", total >= MAX_IMAGES);
    imagesHint.textContent = editing
      ? "New images upload when you save. Removing an image or changing the cover saves right away."
      : "Images upload when you save the product. The first image is the cover.";
  }

  async function removeSavedImage(image) {
    if (!confirm("Remove this image from the product?")) return;
    showImagesError("");
    try {
      editing = await authedFetch(`/admin/shop/products/${editing.id}/images/${image.id}`, { method: "DELETE" });
      renderGallery();
      loadProducts();
    } catch (err) {
      showImagesError(err.message || "Could not remove the image.");
    }
  }

  async function makeSavedCover(image) {
    showImagesError("");
    const order = [image.id, ...savedImages().filter((i) => i.id !== image.id).map((i) => i.id)];
    try {
      editing = await authedFetch(`/admin/shop/products/${editing.id}/images/order`, {
        method: "PATCH",
        body: JSON.stringify({ imageIds: order }),
      });
      renderGallery();
      loadProducts();
    } catch (err) {
      showImagesError(err.message || "Could not change the cover.");
    }
  }

  imagesInput.addEventListener("change", () => {
    addFiles(imagesInput.files);
    imagesInput.value = "";
  });
  imagesDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    imagesDrop.classList.add("border-zinc-900", "bg-zinc-100");
  });
  imagesDrop.addEventListener("dragleave", () => imagesDrop.classList.remove("border-zinc-900", "bg-zinc-100"));
  imagesDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    imagesDrop.classList.remove("border-zinc-900", "bg-zinc-100");
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });

  document.getElementById("export-products-btn").addEventListener("click", async () => {
    hideBanners();
    try {
      const csv = await authedFetch(`/admin/shop/products/export?${currentParams().toString()}`);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = el("a");
      link.href = url;
      link.download = `zomaal-shop-products-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showBanner(errorEl, err.message || "Export failed.");
    }
  });

  document.getElementById("import-products-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    hideBanners();
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await authedFetch("/admin/shop/products/import", { method: "POST", body });
      showBanner(
        noticeEl,
        `Import complete: ${result.created} created, ${result.updated} updated${result.createdCategories ? `, ${result.createdCategories} new categor${result.createdCategories === 1 ? "y" : "ies"}` : ""}.`,
      );
      await loadCategories();
      loadProducts();
    } catch (err) {
      showBanner(errorEl, err.message || "Import failed.");
    }
  });

  categoryFilter.addEventListener("change", loadProducts);
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadProducts, 300);
  });
  statusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      statusFilter = btn.dataset.status;
      setSegmentActive(statusButtons, btn);
      loadProducts();
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");
    showImagesError("");

    const variants = collectVariants();
    const specs = collectSpecs();
    const hadVariants = !!(editing && editing.variants && editing.variants.length);
    const compareAt = form.elements.compareAtPrice.value;
    const payload = {
      name: form.elements.name.value,
      categoryId: form.elements.categoryId.value,
      sku: form.elements.sku.value.trim() || undefined,
      description: form.elements.description.value.trim() || undefined,
      price: Number(form.elements.price.value),
      compareAtPrice: compareAt === "" ? null : Number(compareAt),
      unitLabel: form.elements.unitLabel.value.trim() || "piece",
      isFeatured: form.elements.isFeatured.checked,
      status: form.elements.status.value,
    };
    // A product with options takes its stock from them; the server refuses
    // a direct stock edit while options exist.
    if (!variants.length && !hadVariants) payload.stock = Number(form.elements.stock.value);
    const isNew = !form.elements.id.value;
    const uploading = pending.length;

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      editing = isNew
        ? await authedFetch("/admin/shop/products", { method: "POST", body: JSON.stringify(payload) })
        : await authedFetch(`/admin/shop/products/${form.elements.id.value}`, { method: "PATCH", body: JSON.stringify(payload) });
      form.elements.id.value = editing.id;
      titleEl.textContent = "Edit Product";

      if (comparableVariants(variants) !== comparableVariants(editing.variants)) {
        editing = await authedFetch(`/admin/shop/products/${editing.id}/variants`, {
          method: "PUT",
          body: JSON.stringify({ variants }),
        });
        // Options removed: the product is back to a single stock number.
        if (!variants.length && hadVariants) {
          editing = await authedFetch(`/admin/shop/products/${editing.id}`, {
            method: "PATCH",
            body: JSON.stringify({ stock: Number(form.elements.stock.value) || 0 }),
          });
        }
        variantsList.innerHTML = "";
        editing.variants.forEach((v) => addVariantRow(v));
      }
      if (comparableSpecs(specs) !== comparableSpecs(editing.specs)) {
        editing = await authedFetch(`/admin/shop/products/${editing.id}/specs`, {
          method: "PUT",
          body: JSON.stringify({ specs }),
        });
      }
    } catch (err) {
      showFormError(formError, err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Product";
      if (editing) loadProducts();
      return;
    }

    if (uploading) {
      submitBtn.textContent = `Uploading ${uploading} image${uploading === 1 ? "" : "s"}…`;
      const body = new FormData();
      pending.forEach((p) => body.append("images", p.file));
      try {
        editing = await authedFetch(`/admin/shop/products/${editing.id}/images`, { method: "POST", body });
        clearPending();
      } catch (err) {
        // The product itself is saved. Keep the dialog open in edit mode with
        // the picked images still queued, so saving again retries the upload.
        renderGallery();
        showImagesError(
          `${isNew ? "Product created" : "Product saved"}, but the images didn't upload: ${err.message || "upload failed"}\nSave again to retry, or remove them.`,
        );
        submitBtn.disabled = false;
        submitBtn.textContent = "Save Product";
        loadProducts();
        return;
      }
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Save Product";
    dialog.close();
    showBanner(
      noticeEl,
      `${isNew ? "Added" : "Saved"} "${editing.name}"${uploading ? ` with ${uploading} new image${uploading === 1 ? "" : "s"}` : ""}.`,
    );
    loadProducts();
  });

  dialog.addEventListener("close", () => {
    clearPending();
    showImagesError("");
  });

  loadCategories()
    .catch((err) => showBanner(errorEl, err.message || "Could not load categories."))
    .finally(loadProducts);
}

// --- Merchant edit dialog (shared by the list and the detail page) ---

function setupMerchantDialog(onSaved) {
  const dialog = document.getElementById("merchant-dialog");
  const form = document.getElementById("merchant-form");
  const formError = document.getElementById("merchant-form-error");

  document.getElementById("merchant-cancel-btn").addEventListener("click", () => dialog.close());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");
    const payload = {
      businessName: form.elements.businessName.value,
      ownerName: form.elements.ownerName.value,
      address: form.elements.address.value,
      city: form.elements.city.value,
      country: form.elements.country.value,
      isActive: form.elements.isActive.checked,
    };
    try {
      const updated = await authedFetch(`/admin/merchants/${form.elements.userId.value}`, { method: "PATCH", body: JSON.stringify(payload) });
      dialog.close();
      onSaved(updated);
    } catch (err) {
      showFormError(formError, err);
    }
  });

  return function open(merchant) {
    form.reset();
    formError.classList.add("hidden");
    form.elements.userId.value = merchant.id;
    form.elements.businessName.value = merchant.businessName;
    form.elements.ownerName.value = merchant.ownerName;
    form.elements.address.value = merchant.address;
    form.elements.city.value = merchant.city;
    form.elements.country.value = merchant.country;
    form.elements.isActive.checked = merchant.isActive;
    dialog.showModal();
  };
}

async function confirmAndDeleteMerchant(merchant) {
  const typed = prompt(
    `This permanently deletes "${merchant.businessName}" and everything it owns — store, products, customers, orders, staff, connections. It cannot be undone.\n\nType the business name to confirm:`,
  );
  if (typed === null) return false;
  if (typed.trim() !== merchant.businessName) {
    alert("The name didn't match. Nothing was deleted.");
    return false;
  }
  await authedFetch(`/admin/merchants/${merchant.id}`, { method: "DELETE" });
  return true;
}

// --- Merchants page ---

function initMerchantsPage() {
  const tbody = document.getElementById("merchants-tbody");
  const errorEl = document.getElementById("merchants-error");
  const searchInput = document.getElementById("merchant-search");
  const statusButtons = document.querySelectorAll(".merchant-status-filter-btn");

  let activeFilter = "";
  let searchTimer = null;
  const openEdit = setupMerchantDialog(() => loadMerchants());

  async function loadMerchants() {
    errorEl.classList.add("hidden");
    tbody.innerHTML = '<tr><td colspan="7" class="px-4 py-6 text-center text-zinc-400 text-sm">Loading…</td></tr>';
    const params = new URLSearchParams();
    if (activeFilter) params.set("isActive", activeFilter);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());

    try {
      renderMerchants(await authedFetch(`/admin/merchants?${params.toString()}`));
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load merchants.");
    }
  }

  function renderMerchants(merchants) {
    if (merchants.length === 0) {
      emptyRow(tbody, 7, "No merchants match these filters.");
      return;
    }
    tbody.innerHTML = "";

    merchants.forEach((merchant) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60");

      const nameCell = el("td", "px-4 py-3");
      const link = el("a", "font-medium hover:underline", merchant.businessName);
      link.href = `/merchants/${merchant.id}`;
      nameCell.appendChild(link);
      nameCell.appendChild(el("div", "text-[11.5px] text-zinc-400", merchant.ownerName));
      row.appendChild(nameCell);

      row.appendChild(el("td", "px-4 py-3 text-zinc-500 tabular-nums", merchant.phone));
      row.appendChild(el("td", "px-4 py-3 text-zinc-500", `${merchant.city}, ${merchant.country}`));
      row.appendChild(el("td", "px-4 py-3 tabular-nums", String(merchant.productCount)));
      row.appendChild(el("td", "px-4 py-3 tabular-nums", String(merchant.customerCount)));

      const statusCell = el("td", "px-4 py-3");
      statusCell.appendChild(badge(merchant.isActive ? "Active" : "Suspended", merchant.isActive ? "green" : "red"));
      row.appendChild(statusCell);

      const actionsCell = el("td", "px-4 py-3 text-right");
      const actionsWrap = el("div", "flex justify-end gap-1.5");
      const viewBtn = el("a", "h-7 px-2.5 border border-zinc-200 rounded-md flex items-center text-[12px] font-semibold hover:bg-zinc-50", "View");
      viewBtn.href = `/merchants/${merchant.id}`;
      const editBtn = el("button", "h-7 w-7 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-zinc-50");
      editBtn.type = "button";
      editBtn.title = "Edit";
      editBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
      editBtn.addEventListener("click", () => openEdit(merchant));
      const deleteBtn = el("button", "h-7 w-7 border border-zinc-200 rounded-md flex items-center justify-center hover:bg-red-50");
      deleteBtn.type = "button";
      deleteBtn.title = "Delete";
      deleteBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>`;
      deleteBtn.addEventListener("click", async () => {
        try {
          if (await confirmAndDeleteMerchant(merchant)) loadMerchants();
        } catch (err) {
          showBanner(errorEl, err.message || "Could not delete merchant.");
        }
      });
      actionsWrap.appendChild(viewBtn);
      actionsWrap.appendChild(editBtn);
      actionsWrap.appendChild(deleteBtn);
      actionsCell.appendChild(actionsWrap);
      row.appendChild(actionsCell);

      tbody.appendChild(row);
    });
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadMerchants, 300);
  });
  statusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.active;
      setSegmentActive(statusButtons, btn);
      loadMerchants();
    });
  });

  loadMerchants();
}

// --- Merchant detail page ---

function initMerchantDetailPage() {
  const root = document.getElementById("merchant-detail");
  const userId = root.dataset.userId;
  const errorEl = document.getElementById("detail-error");
  const toggleBtn = document.getElementById("d-toggle-btn");
  let current = null;

  const openEdit = setupMerchantDialog(() => load());

  async function load() {
    try {
      const [overview, activity] = await Promise.all([
        authedFetch(`/admin/merchants/${userId}/overview`),
        authedFetch(`/admin/activity?entityType=MERCHANT&entityId=${userId}&limit=20`),
      ]);
      render(overview, activity.items);
    } catch (err) {
      showBanner(errorEl, err.message || "Could not load this merchant.");
    }
  }

  function render(o, activity) {
    const m = o.merchant;
    current = m;
    document.title = `${m.businessName} — Zomaal Admin`;
    document.getElementById("d-business").textContent = m.businessName;
    const status = document.getElementById("d-status");
    status.innerHTML = "";
    status.appendChild(badge(m.isActive ? "Active" : "Suspended", m.isActive ? "green" : "red"));
    document.getElementById("d-sub").textContent = `${m.ownerName} · ${m.phone} · joined ${formatDateTime(m.createdAt)}`;

    toggleBtn.classList.remove("hidden");
    toggleBtn.textContent = m.isActive ? "Suspend" : "Reactivate";

    document.getElementById("d-orders").textContent = o.orders.total;
    document.getElementById("d-orders-30").textContent = `${o.orders.last30Days} in the last 30 days`;
    const revenue = document.getElementById("d-revenue");
    revenue.innerHTML = "";
    if (o.orders.revenueByCurrency.length === 0) revenue.textContent = "—";
    o.orders.revenueByCurrency.forEach((r) => revenue.appendChild(el("div", "", money(r.totalCollected, r.currency))));
    document.getElementById("d-customers").textContent = o.customers.total;
    document.getElementById("d-blacklisted").textContent = `${o.customers.blacklisted} blacklisted`;
    document.getElementById("d-products").textContent = m.productCount;

    const shop = o.zomaalShop;
    const shopList = document.getElementById("d-shop-orders");
    shopList.innerHTML = "";
    document.getElementById("d-shop-summary").textContent = shop.orders
      ? `${shop.orders} order${shop.orders === 1 ? "" : "s"} · ${Object.entries(shop.byStatus).map(([k, v]) => `${v} ${ORDER_STATUS[k] ? ORDER_STATUS[k][0].toLowerCase() : k}`).join(" · ")}${shop.deliveredSpend ? ` · ${shop.deliveredSpend} spent` : ""}`
      : "";
    if (!shop.recent.length) shopList.appendChild(el("div", "px-[18px] py-4 text-sm text-zinc-400", "This merchant hasn't ordered from the Zomaal Shop yet."));
    shop.recent.forEach((order) => {
      const row = el("a", "px-[18px] py-3 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-zinc-50");
      row.href = `/orders/${order.id}`;
      row.appendChild(el("span", "font-semibold text-[13px]", order.number));
      row.appendChild(orderStatusBadge(order.status));
      row.appendChild(el("span", "ml-auto text-[13px] tabular-nums font-medium", money(order.total, order.currency)));
      row.appendChild(el("span", "w-full sm:w-auto text-[12px] text-zinc-400", formatDateTime(order.createdAt)));
      shopList.appendChild(row);
    });

    const profile = document.getElementById("d-profile");
    profile.innerHTML = "";
    [
      ["Owner", m.ownerName],
      ["Phone", m.phone],
      ["Address", m.address],
      ["City", m.city],
      ["Country", m.country],
      ["Currency", m.baseCurrency],
      ["Onboarding", m.onboardingComplete ? "Complete" : "Incomplete"],
      ["Last updated", formatDateTime(m.updatedAt)],
    ].forEach(([k, v]) => {
      const row = el("div", "flex justify-between gap-3");
      row.appendChild(el("dt", "text-zinc-500", k));
      row.appendChild(el("dd", "font-medium text-right", v || "—"));
      profile.appendChild(row);
    });

    const orders = document.getElementById("d-recent-orders");
    if (o.orders.recent.length === 0) {
      emptyRow(orders, 5, "No orders yet.");
    } else {
      orders.innerHTML = "";
      o.orders.recent.forEach((order) => {
        const row = el("tr", "border-b border-zinc-100 last:border-0");
        row.appendChild(el("td", "px-4 py-2.5 font-medium", order.orderName));
        row.appendChild(el("td", "px-4 py-2.5 text-zinc-500", PLATFORM_LABEL[order.platform] || order.platform));
        const pay = el("td", "px-4 py-2.5");
        const paid = order.financialStatus === "PAID";
        pay.appendChild(badge(order.financialStatus.replace(/_/g, " ").toLowerCase(), paid ? "green" : order.status === "CANCELLED" ? "red" : "gray"));
        row.appendChild(pay);
        row.appendChild(el("td", "px-4 py-2.5 text-right tabular-nums", money(order.totalCollected, order.currency)));
        row.appendChild(el("td", "px-4 py-2.5 text-right text-zinc-500 whitespace-nowrap", formatDateTime(order.processedAt)));
        orders.appendChild(row);
      });
    }

    const connections = document.getElementById("d-connections");
    connections.innerHTML = "";
    if (o.connections.length === 0) {
      connections.appendChild(el("div", "px-[18px] py-4 text-sm text-zinc-400", "No platforms connected."));
    }
    o.connections.forEach((c) => {
      const row = el("div", "px-[18px] py-3 flex items-start justify-between gap-3");
      const left = el("div");
      left.appendChild(el("div", "text-[13px] font-semibold", `${PLATFORM_LABEL[c.platform] || c.platform}${c.displayName ? ` · ${c.displayName}` : ""}`));
      left.appendChild(
        el("div", "text-[11.5px] text-zinc-500", c.isManual ? `${c.orderCount} manual orders` : `${c.orderCount} orders · last sync ${timeAgo(c.lastSyncedAt)}`),
      );
      if (c.lastSyncError) left.appendChild(el("div", "text-[11.5px] text-red-600 mt-0.5", c.lastSyncError));
      row.appendChild(left);
      row.appendChild(
        c.isManual ? badge("Manual", "gray") : c.status !== "ACTIVE" ? badge("Disconnected", "gray") : c.lastSyncError ? badge("Sync error", "red") : badge("Connected", "green"),
      );
      connections.appendChild(row);
    });

    const staff = document.getElementById("d-staff");
    staff.innerHTML = "";
    if (o.staff.length === 0) staff.appendChild(el("div", "px-[18px] py-4 text-sm text-zinc-400", "No staff members."));
    o.staff.forEach((s) => {
      const row = el("div", "px-[18px] py-3 flex items-start justify-between gap-3");
      const left = el("div");
      left.appendChild(el("div", "text-[13px] font-semibold", s.name));
      left.appendChild(el("div", "text-[11.5px] text-zinc-500", [s.role || s.jobTitle || "No role", s.phone, `last login ${timeAgo(s.lastLoginAt)}`].join(" · ")));
      row.appendChild(left);
      row.appendChild(badge(s.status === "ACTIVE" ? "Active" : "Inactive", s.status === "ACTIVE" ? "green" : "gray"));
      staff.appendChild(row);
    });

    renderActivityList(document.getElementById("d-activity"), activity);
  }

  document.getElementById("d-edit-btn").addEventListener("click", () => current && openEdit(current));

  toggleBtn.addEventListener("click", async () => {
    if (!current) return;
    const suspending = current.isActive;
    if (!confirm(suspending ? `Suspend "${current.businessName}"?` : `Reactivate "${current.businessName}"?`)) return;
    try {
      await authedFetch(`/admin/merchants/${userId}`, { method: "PATCH", body: JSON.stringify({ isActive: !suspending }) });
      load();
    } catch (err) {
      showBanner(errorEl, err.message || "Could not update the merchant.");
    }
  });

  document.getElementById("d-delete-btn").addEventListener("click", async () => {
    if (!current) return;
    try {
      if (await confirmAndDeleteMerchant(current)) window.location.href = "/merchants";
    } catch (err) {
      showBanner(errorEl, err.message || "Could not delete the merchant.");
    }
  });

  load();
}

// --- Integrations page ---

function initIntegrationsPage() {
  const tbody = document.getElementById("integrations-tbody");
  const errorEl = document.getElementById("integrations-error");
  const summary = document.getElementById("integration-summary");
  const healthFilter = document.getElementById("integration-health-filter");
  const platformFilter = document.getElementById("integration-platform-filter");

  async function load() {
    errorEl.classList.add("hidden");
    tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-zinc-400">Loading…</td></tr>';
    try {
      // Summary counts always reflect all connections; the table follows the filters.
      const params = new URLSearchParams();
      if (healthFilter.value) params.set("health", healthFilter.value);
      if (platformFilter.value) params.set("platform", platformFilter.value);
      const [all, filtered] = await Promise.all([
        authedFetch("/admin/integrations"),
        authedFetch(`/admin/integrations?${params.toString()}`),
      ]);
      renderSummary(all);
      renderRows(filtered);
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load integrations.");
    }
  }

  function renderSummary(all) {
    summary.innerHTML = "";
    ["ERROR", "STALE", "DISCONNECTED", "HEALTHY"].forEach((health) => {
      const [label, tone] = HEALTH_BADGE[health];
      const count = all.filter((c) => c.health === health).length;
      const tile = el("button", `border rounded-xl p-3.5 text-left hover:border-zinc-300 ${healthFilter.value === health ? "border-zinc-900" : "border-zinc-200"}`);
      tile.type = "button";
      const top = el("div", "flex items-center justify-between");
      top.appendChild(el("span", "text-[12px] text-zinc-500", label));
      top.appendChild(badge(String(count), count > 0 && health !== "HEALTHY" ? tone : "gray"));
      tile.appendChild(top);
      tile.addEventListener("click", () => {
        healthFilter.value = healthFilter.value === health ? "" : health;
        load();
      });
      summary.appendChild(tile);
    });
  }

  function renderRows(rows) {
    if (rows.length === 0) {
      emptyRow(tbody, 5, "No connections match these filters.");
      return;
    }
    tbody.innerHTML = "";
    rows.forEach((c) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0 align-top");
      const merchantCell = el("td", "px-4 py-3");
      const link = el("a", "font-medium hover:underline", c.merchant.businessName);
      link.href = `/merchants/${c.merchant.userId}`;
      merchantCell.appendChild(link);
      merchantCell.appendChild(el("div", "text-[11.5px] text-zinc-400", c.merchant.phone + (c.merchant.isActive ? "" : " · suspended")));
      row.appendChild(merchantCell);

      const platformCell = el("td", "px-4 py-3");
      platformCell.appendChild(el("div", "font-medium", PLATFORM_LABEL[c.platform] || c.platform));
      if (c.displayName) platformCell.appendChild(el("div", "text-[11.5px] text-zinc-400", c.displayName));
      row.appendChild(platformCell);

      const healthCell = el("td", "px-4 py-3");
      const [label, tone] = HEALTH_BADGE[c.health];
      healthCell.appendChild(badge(label, tone));
      if (c.lastSyncError) healthCell.appendChild(el("div", "text-[11.5px] text-red-600 mt-1 max-w-sm", c.lastSyncError));
      row.appendChild(healthCell);

      const syncCell = el("td", "px-4 py-3 text-zinc-500 whitespace-nowrap", timeAgo(c.lastSyncedAt));
      syncCell.title = formatDateTime(c.lastSyncedAt);
      row.appendChild(syncCell);
      row.appendChild(el("td", "px-4 py-3 text-right tabular-nums", String(c.orderCount)));
      tbody.appendChild(row);
    });
  }

  healthFilter.addEventListener("change", load);
  platformFilter.addEventListener("change", load);
  load();
}

// --- Blacklist page ---

function initBlacklistPage() {
  const tbody = document.getElementById("blacklist-tbody");
  const errorEl = document.getElementById("blacklist-error");
  const searchInput = document.getElementById("bl-search");
  const multiOnly = document.getElementById("bl-multi-only");
  let searchTimer = null;

  async function load() {
    errorEl.classList.add("hidden");
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-zinc-400">Loading…</td></tr>';
    const params = new URLSearchParams();
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    if (multiOnly.checked) params.set("multiStoreOnly", "true");
    try {
      const data = await authedFetch(`/admin/customers/blacklisted?${params.toString()}`);
      document.getElementById("bl-total").textContent = data.total;
      document.getElementById("bl-multi").textContent = data.multiStorePhones;
      render(data.items);
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load the blacklist.");
    }
  }

  function render(items) {
    if (items.length === 0) {
      emptyRow(tbody, 6, multiOnly.checked || searchInput.value.trim() ? "No blacklisted customers match." : "No merchant has blacklisted a customer yet.");
      return;
    }
    tbody.innerHTML = "";
    items.forEach((c) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0 align-top");
      const who = el("td", "px-4 py-3");
      who.appendChild(el("div", "font-medium tabular-nums", c.phone));
      who.appendChild(el("div", "text-[11.5px] text-zinc-400", [c.name, c.city].filter(Boolean).join(" · ") || "No name on file"));
      row.appendChild(who);

      const merchant = el("td", "px-4 py-3");
      const link = el("a", "hover:underline", c.merchant.businessName);
      link.href = `/merchants/${c.merchant.userId}`;
      merchant.appendChild(link);
      row.appendChild(merchant);

      row.appendChild(
        el("td", "px-4 py-3 text-[12px] text-zinc-600", `${c.totalOrders} orders · ${c.returns} returns · ${c.cancellations} cancelled · ${c.refusals} refused · ${c.noAnswer} no answer`),
      );
      row.appendChild(el("td", "px-4 py-3 text-[12.5px] text-zinc-600 max-w-xs", c.reason || "—"));
      const flagged = el("td", "px-4 py-3 text-right");
      flagged.appendChild(badge(`${c.flaggedByStores} merchant${c.flaggedByStores === 1 ? "" : "s"}`, c.flaggedByStores > 1 ? "red" : "gray"));
      row.appendChild(flagged);
      row.appendChild(el("td", "px-4 py-3 text-right text-zinc-500 whitespace-nowrap", formatDateTime(c.blacklistedAt)));
      tbody.appendChild(row);
    });
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(load, 300);
  });
  multiOnly.addEventListener("change", load);
  load();
}

// --- Activity log page ---

function initActivityPage() {
  const tbody = document.getElementById("activity-tbody");
  const errorEl = document.getElementById("activity-error");
  const typeFilter = document.getElementById("activity-type-filter");
  const moreBtn = document.getElementById("activity-more-btn");
  let cursor = null;

  async function load(append) {
    errorEl.classList.add("hidden");
    if (!append) {
      cursor = null;
      tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-zinc-400">Loading…</td></tr>';
    }
    const params = new URLSearchParams({ limit: "50" });
    if (typeFilter.value) params.set("entityType", typeFilter.value);
    if (append && cursor) params.set("cursor", cursor);
    try {
      const page = await authedFetch(`/admin/activity?${params.toString()}`);
      if (!append) tbody.innerHTML = "";
      if (!append && page.items.length === 0) emptyRow(tbody, 4, "No activity recorded yet.");
      page.items.forEach((item) => {
        const row = el("tr", "border-b border-zinc-100 last:border-0 align-top");
        const when = el("td", "px-4 py-3 text-zinc-500 whitespace-nowrap", formatDateTime(item.createdAt));
        when.title = timeAgo(item.createdAt);
        row.appendChild(when);
        const what = el("td", "px-4 py-3");
        what.appendChild(el("div", "", item.summary));
        const changes = describeChanges(item.metadata);
        if (changes) what.appendChild(el("div", "text-[11.5px] text-zinc-500 mt-0.5", changes));
        row.appendChild(what);
        const action = el("td", "px-4 py-3");
        action.appendChild(badge(item.action.replace(/_/g, " ").toLowerCase(), activityTone(item.action)));
        row.appendChild(action);
        row.appendChild(el("td", "px-4 py-3 text-zinc-500", item.adminUsername));
        tbody.appendChild(row);
      });
      cursor = page.nextCursor;
      moreBtn.classList.toggle("hidden", !cursor);
    } catch (err) {
      if (!append) tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load the activity log.");
    }
  }

  typeFilter.addEventListener("change", () => load(false));
  moreBtn.addEventListener("click", () => load(true));
  load(false);
}

function activityTone(action) {
  if (/DELETED|SUSPENDED|REMOVED/.test(action)) return "red";
  if (/CREATED|REACTIVATED|IMPORTED|UPLOADED/.test(action)) return "green";
  return "gray";
}

// Renders {field: {from, to}} change metadata as "price: 12.00 → 14.00".
function describeChanges(metadata) {
  if (!metadata || typeof metadata !== "object") return "";
  const parts = Object.entries(metadata)
    .filter(([, v]) => v && typeof v === "object" && "from" in v && "to" in v)
    .map(([field, v]) => `${field}: ${v.from ?? "—"} → ${v.to ?? "—"}`);
  return parts.join(" · ");
}

// --- Zomaal Shop operations: shared helpers ---

const ORDER_STATUS = {
  PENDING: ["Pending", "amber"],
  CONFIRMED: ["Confirmed", "blue"],
  SHIPPED: ["Shipped", "violet"],
  DELIVERED: ["Delivered", "green"],
  CANCELLED: ["Cancelled", "red"],
};
BADGE_TONES.blue = "bg-sky-100 text-sky-700";
BADGE_TONES.violet = "bg-violet-100 text-violet-700";

function orderStatusBadge(status) {
  const [label, tone] = ORDER_STATUS[status] || [status, "gray"];
  return badge(label, tone);
}

function paymentBadge(order) {
  const method = order.paymentMethod === "COD" ? "Cash on delivery" : "Online";
  return badge(`${method} · ${order.paymentStatus === "PAID" ? "Paid" : "Unpaid"}`, order.paymentStatus === "PAID" ? "green" : "gray");
}

// <input type="datetime-local"> works in local time without a zone.
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null;
}

function optionalNumber(value) {
  return value === "" || value === null || value === undefined ? null : Number(value);
}

function wireDialogClose(dialog) {
  dialog.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog.close()));
}

function hideAll(...nodes) {
  nodes.forEach((n) => n && n.classList.add("hidden"));
}

function iconButton(svgPath, title, onClick, danger) {
  const btn = el("button", `h-7 w-7 border border-zinc-200 rounded-md flex items-center justify-center ${danger ? "hover:bg-red-50" : "hover:bg-zinc-50"}`);
  btn.type = "button";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
  btn.addEventListener("click", onClick);
  return btn;
}
const EDIT_ICON = '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>';
const DELETE_ICON = '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>';

// --- Shop orders list ---

function initOrdersPage() {
  const tbody = document.getElementById("orders-tbody");
  const errorEl = document.getElementById("orders-error");
  const searchInput = document.getElementById("order-search");
  const statusButtons = document.querySelectorAll(".order-status-btn");
  const prevBtn = document.getElementById("orders-prev");
  const nextBtn = document.getElementById("orders-next");
  const rangeEl = document.getElementById("orders-range");

  const initial = new URLSearchParams(location.search);
  let status = initial.get("status") || "";
  let page = 1;
  let searchTimer = null;

  const activeBtn = Array.from(statusButtons).find((b) => b.dataset.status === status) || statusButtons[0];
  setSegmentActive(statusButtons, activeBtn);

  async function load() {
    errorEl.classList.add("hidden");
    const params = new URLSearchParams({ page: String(page) });
    if (status) params.set("status", status);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    history.replaceState(null, "", status ? `/orders?status=${status}` : "/orders");
    try {
      render(await authedFetch(`/admin/shop/orders?${params.toString()}`));
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load orders.");
    }
  }

  function render(data) {
    const all = Object.values(data.statusCounts).reduce((a, b) => a + b, 0);
    statusButtons.forEach((b) => {
      const n = b.dataset.status ? data.statusCounts[b.dataset.status] : all;
      b.querySelector(".count").textContent = n ? String(n) : "";
    });
    const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
    rangeEl.textContent = data.total ? `${from}–${from + data.items.length - 1} of ${data.total}` : "";
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = !data.hasMore;

    if (!data.items.length) {
      emptyRow(tbody, 7, searchInput.value.trim() || status ? "No orders match these filters." : "No shop orders yet. They appear here when merchants check out in the app.");
      return;
    }
    tbody.innerHTML = "";
    data.items.forEach((order) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 cursor-pointer");
      row.addEventListener("click", (e) => {
        if (!e.target.closest("a")) location.href = `/orders/${order.id}`;
      });
      const numCell = el("td", "px-4 py-3");
      const link = el("a", "font-semibold hover:underline", order.number);
      link.href = `/orders/${order.id}`;
      numCell.appendChild(link);
      if (order.city) numCell.appendChild(el("div", "text-[11.5px] text-zinc-400", order.city));
      row.appendChild(numCell);

      const merchantCell = el("td", "px-4 py-3");
      const mLink = el("a", "font-medium hover:underline", order.merchant.businessName);
      mLink.href = `/merchants/${order.merchant.userId}`;
      merchantCell.appendChild(mLink);
      merchantCell.appendChild(el("div", "text-[11.5px] text-zinc-400 tabular-nums", order.merchant.phone));
      row.appendChild(merchantCell);

      row.appendChild(el("td", "px-4 py-3 tabular-nums text-zinc-500", String(order.itemCount)));
      row.appendChild(el("td", "px-4 py-3 tabular-nums font-medium", money(order.total, order.currency)));
      const payCell = el("td", "px-4 py-3");
      payCell.appendChild(paymentBadge(order));
      row.appendChild(payCell);
      const statusCell = el("td", "px-4 py-3");
      statusCell.appendChild(orderStatusBadge(order.status));
      row.appendChild(statusCell);
      const dateCell = el("td", "px-4 py-3 text-right text-zinc-500 text-[12.5px]", timeAgo(order.createdAt));
      dateCell.title = formatDateTime(order.createdAt);
      row.appendChild(dateCell);
      tbody.appendChild(row);
    });
  }

  statusButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      status = btn.dataset.status;
      page = 1;
      setSegmentActive(statusButtons, btn);
      load();
    });
  });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, 300);
  });
  prevBtn.addEventListener("click", () => { page -= 1; load(); });
  nextBtn.addEventListener("click", () => { page += 1; load(); });

  document.getElementById("export-orders-btn").addEventListener("click", async () => {
    errorEl.classList.add("hidden");
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (searchInput.value.trim()) params.set("search", searchInput.value.trim());
    try {
      const csv = await authedFetch(`/admin/shop/orders/export?${params.toString()}`);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = el("a");
      link.href = url;
      link.download = `zomaal-shop-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showBanner(errorEl, err.message || "Export failed.");
    }
  });

  load();
}

// --- Shop order detail ---

const ADVANCE_COPY = {
  CONFIRMED: ["Confirm order", "The merchant sees the order as confirmed and can no longer cancel it from the app."],
  SHIPPED: ["Mark as shipped", "The merchant sees the order as on its way."],
  DELIVERED: ["Mark as delivered", "Cash on delivery is marked paid, and the items are added to the merchant's Purchases as “From Shop”. This can't be undone."],
};

function initOrderDetailPage() {
  const root = document.getElementById("order-detail");
  const orderId = root.dataset.orderId;
  const errorEl = document.getElementById("order-error");
  const noticeEl = document.getElementById("order-notice");
  const actions = document.getElementById("order-actions");
  const advanceDialog = document.getElementById("order-advance-dialog");
  const advanceForm = document.getElementById("order-advance-form");
  const advanceError = document.getElementById("order-advance-error");
  const cancelDialog = document.getElementById("order-cancel-dialog");
  const cancelForm = document.getElementById("order-cancel-form");
  const cancelError = document.getElementById("order-cancel-error");
  const noteForm = document.getElementById("order-note-form");
  const noteStatus = document.getElementById("order-note-status");
  wireDialogClose(advanceDialog);
  wireDialogClose(cancelDialog);
  let order = null;

  const set = (id, text) => (document.getElementById(id).textContent = text);

  function render(o) {
    order = o;
    document.title = `${o.number} — Zomaal Admin`;
    set("order-title", `Order ${o.number}`);
    const sb = document.getElementById("order-status-badge");
    sb.innerHTML = "";
    sb.appendChild(orderStatusBadge(o.status));
    const pb = document.getElementById("order-payment-badge");
    pb.innerHTML = "";
    pb.appendChild(paymentBadge(o));
    set("order-subtitle", `Placed ${formatDateTime(o.createdAt)} · ${o.itemCount} item${o.itemCount === 1 ? "" : "s"}${o.trackingNumber ? ` · Tracking ${o.trackingNumber}` : ""}`);

    actions.innerHTML = "";
    o.nextStatuses.forEach((next, i) => {
      const primary = i === 0;
      const btn = el("button", primary
        ? "bg-zinc-900 text-white rounded-lg px-3.5 py-2 text-[13px] font-semibold hover:bg-zinc-800"
        : "border border-zinc-200 rounded-lg px-3.5 py-2 text-[13px] font-semibold hover:bg-zinc-50", ADVANCE_COPY[next][0]);
      btn.type = "button";
      btn.addEventListener("click", () => openAdvance(next));
      actions.appendChild(btn);
    });
    if (o.canCancel) {
      const btn = el("button", "border border-red-300 text-red-700 rounded-lg px-3.5 py-2 text-[13px] font-semibold hover:bg-red-50", "Cancel order");
      btn.type = "button";
      btn.addEventListener("click", () => {
        cancelForm.reset();
        cancelError.classList.add("hidden");
        cancelDialog.showModal();
      });
      actions.appendChild(btn);
    }

    const items = document.getElementById("order-items");
    items.innerHTML = "";
    o.items.forEach((item) => {
      const row = el("div", "px-5 py-3 flex items-center gap-3");
      if (item.imageUrl) {
        const img = el("img", "h-11 w-11 rounded-lg object-cover border border-zinc-200 shrink-0");
        img.src = item.imageUrl;
        img.alt = "";
        row.appendChild(img);
      } else {
        row.appendChild(el("div", "h-11 w-11 rounded-lg bg-zinc-100 border border-zinc-200 shrink-0"));
      }
      const text = el("div", "min-w-0 flex-1");
      const name = item.productId ? el("div", "text-[13px] font-medium truncate", item.productName) : el("div", "text-[13px] font-medium truncate", `${item.productName} (removed from shop)`);
      text.appendChild(name);
      text.appendChild(el("div", "text-[12px] text-zinc-400", [item.variantLabel, `${money(item.unitPrice, o.currency)} × ${item.quantity} ${item.unitLabel}`].filter(Boolean).join(" · ")));
      row.appendChild(text);
      row.appendChild(el("div", "text-[13px] font-semibold tabular-nums", money(item.lineTotal, o.currency)));
      items.appendChild(row);
    });
    set("order-subtotal", money(o.subtotal, o.currency));
    set("order-discount", Number(o.discount) ? `− ${money(o.discount, o.currency)}` : "—");
    set("order-promo", o.promoCode ? `(${o.promoCode})` : "");
    set("order-delivery", Number(o.deliveryFee) ? money(o.deliveryFee, o.currency) : "Free");
    set("order-total", money(o.total, o.currency));

    const timeline = document.getElementById("order-timeline");
    timeline.innerHTML = "";
    const steps = [
      ["Placed", o.timeline.placedAt],
      ["Confirmed", o.timeline.confirmedAt],
      ["Shipped", o.timeline.shippedAt],
      ["Delivered", o.timeline.deliveredAt],
    ];
    if (o.timeline.cancelledAt) {
      steps.push([`Cancelled by ${o.cancelledBy === "MERCHANT" ? "the merchant" : "Zomaal"}${o.cancelReason ? ` — ${o.cancelReason}` : ""}`, o.timeline.cancelledAt, true]);
    }
    steps.forEach(([label, at, danger]) => {
      if (!at && o.status === "CANCELLED") return;
      const li = el("li", "flex items-start gap-3");
      const dot = el("span", `mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${danger ? "bg-red-500" : at ? "bg-zinc-900" : "border-2 border-zinc-300"}`);
      li.appendChild(dot);
      const t = el("div", "text-[13px]");
      t.appendChild(el("div", at ? "font-medium" : "text-zinc-400", label));
      if (at) t.appendChild(el("div", "text-[12px] text-zinc-400", formatDateTime(at)));
      li.appendChild(t);
      timeline.appendChild(li);
    });

    const merchant = document.getElementById("order-merchant");
    merchant.innerHTML = "";
    const mLink = el("a", "font-semibold hover:underline", o.merchant.businessName);
    mLink.href = `/merchants/${o.merchant.userId}`;
    merchant.appendChild(mLink);
    merchant.appendChild(el("div", "text-zinc-500", o.merchant.ownerName));
    merchant.appendChild(el("div", "text-zinc-500 tabular-nums", o.merchant.phone));

    const addr = document.getElementById("order-address");
    addr.innerHTML = "";
    const a = o.shippingAddress;
    addr.appendChild(el("div", "font-semibold", a.fullName));
    addr.appendChild(el("div", "text-zinc-500 tabular-nums", a.phone));
    addr.appendChild(el("div", "text-zinc-600", a.formatted));
    if (a.label) addr.appendChild(el("div", "text-[12px] text-zinc-400", a.label));

    set("order-merchant-note", o.note || "No note.");
    document.getElementById("order-merchant-note").classList.toggle("text-zinc-400", !o.note);
    noteForm.elements.adminNote.value = o.adminNote || "";
  }

  function openAdvance(next) {
    advanceForm.reset();
    advanceError.classList.add("hidden");
    advanceForm.elements.status.value = next;
    set("order-advance-title", `${ADVANCE_COPY[next][0]} ${order.number}`);
    set("order-advance-text", ADVANCE_COPY[next][1]);
    document.getElementById("order-tracking-row").classList.toggle("hidden", next !== "SHIPPED");
    advanceForm.elements.trackingNumber.value = order.trackingNumber || "";
    advanceDialog.showModal();
  }

  async function load() {
    try {
      render(await authedFetch(`/admin/shop/orders/${orderId}`));
    } catch (err) {
      set("order-subtitle", "");
      showBanner(errorEl, err.message || "Could not load this order.");
    }
  }

  advanceForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = advanceForm.querySelector('[type="submit"]');
    btn.disabled = true;
    const next = advanceForm.elements.status.value;
    const body = { status: next };
    if (next === "SHIPPED" && advanceForm.elements.trackingNumber.value.trim()) body.trackingNumber = advanceForm.elements.trackingNumber.value.trim();
    try {
      render(await authedFetch(`/admin/shop/orders/${orderId}/status`, { method: "POST", body: JSON.stringify(body) }));
      advanceDialog.close();
      hideAll(errorEl);
      showBanner(noticeEl, `${order.number} is now ${ORDER_STATUS[order.status][0].toLowerCase()}.`);
    } catch (err) {
      showFormError(advanceError, err);
      load();
    } finally {
      btn.disabled = false;
    }
  });

  cancelForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = cancelForm.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      render(await authedFetch(`/admin/shop/orders/${orderId}/cancel`, { method: "POST", body: JSON.stringify({ reason: cancelForm.elements.reason.value.trim() }) }));
      cancelDialog.close();
      hideAll(errorEl);
      showBanner(noticeEl, `${order.number} was cancelled. Stock was returned to the shop.`);
    } catch (err) {
      showFormError(cancelError, err);
      load();
    } finally {
      btn.disabled = false;
    }
  });

  noteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const value = noteForm.elements.adminNote.value.trim();
      render(await authedFetch(`/admin/shop/orders/${orderId}/note`, { method: "PATCH", body: JSON.stringify({ adminNote: value || null }) }));
      showStatus(noteStatus, "Saved", false);
    } catch (err) {
      showStatus(noteStatus, err.message || "Could not save", true);
    }
  });

  load();
}

// --- Banners ---

function initBannersPage() {
  const grid = document.getElementById("banners-grid");
  const errorEl = document.getElementById("banners-error");
  const noticeEl = document.getElementById("banners-notice");
  const dialog = document.getElementById("banner-dialog");
  const form = document.getElementById("banner-form");
  const formError = document.getElementById("banner-form-error");
  const titleEl = document.getElementById("banner-dialog-title");
  const preview = document.getElementById("banner-image-preview");
  const linkRow = document.getElementById("banner-link-row");
  const linkLabel = document.getElementById("banner-link-label");
  wireDialogClose(dialog);

  let products = [];
  let categories = [];
  let previewUrl = null;

  function setPreview(src) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.classList.toggle("hidden", !src);
    preview.querySelector("img").src = src || "";
  }

  function syncLinkOptions(selectedId) {
    const type = form.elements.linkType.value;
    const show = type !== "NONE";
    linkRow.classList.toggle("hidden", !show);
    linkRow.classList.toggle("flex", show);
    const select = form.elements.linkId;
    select.innerHTML = "";
    if (!show) return;
    linkLabel.textContent = type === "PRODUCT" ? "Product" : "Category";
    const list = type === "PRODUCT" ? products : categories;
    list.forEach((item) => select.appendChild(new Option(item.status === "DRAFT" ? `${item.name} (draft)` : item.isActive === false ? `${item.name} (hidden)` : item.name, item.id)));
    if (selectedId) select.value = selectedId;
  }

  function openDialog(banner) {
    form.reset();
    formError.classList.add("hidden");
    form.elements.id.value = banner ? banner.id : "";
    titleEl.textContent = banner ? "Edit Banner" : "Add Banner";
    if (banner) {
      form.elements.title.value = banner.title || "";
      form.elements.subtitle.value = banner.subtitle || "";
      form.elements.linkType.value = banner.linkType;
      form.elements.sortOrder.value = banner.sortOrder;
      form.elements.isActive.checked = banner.isActive;
      form.elements.startsAt.value = toLocalInput(banner.startsAt);
      form.elements.endsAt.value = toLocalInput(banner.endsAt);
    }
    syncLinkOptions(banner && banner.linkId);
    setPreview(banner && banner.imageUrl);
    dialog.showModal();
  }

  form.elements.linkType.addEventListener("change", () => syncLinkOptions());
  form.elements.image.addEventListener("change", () => {
    const file = form.elements.image.files[0];
    setPreview(null);
    if (file) {
      previewUrl = URL.createObjectURL(file);
      preview.classList.remove("hidden");
      preview.querySelector("img").src = previewUrl;
    }
  });

  async function load() {
    try {
      render(await authedFetch("/admin/shop/banners"));
    } catch (err) {
      grid.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load banners.");
    }
  }

  function render(banners) {
    grid.innerHTML = "";
    if (!banners.length) {
      grid.appendChild(el("div", "col-span-full rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-400", "No banners yet. The shop home shows no slider until you add one with an image."));
      return;
    }
    banners.forEach((b) => {
      const card = el("div", "border border-zinc-200 rounded-xl overflow-hidden flex flex-col");
      const media = el("div", "relative aspect-[2/1] bg-zinc-100");
      if (b.imageUrl) {
        const img = el("img", "h-full w-full object-cover");
        img.src = b.imageUrl;
        img.alt = "";
        img.loading = "lazy";
        media.appendChild(img);
      } else {
        media.appendChild(el("div", "absolute inset-0 flex items-center justify-center text-[12.5px] text-zinc-400", "No image — not shown to merchants"));
      }
      const badges = el("div", "absolute left-2 top-2 flex gap-1");
      badges.appendChild(b.live ? badge("Live", "green") : badge(!b.isActive ? "Off" : !b.imageUrl ? "Needs image" : b.startsAt && new Date(b.startsAt) > new Date() ? "Scheduled" : "Ended", b.isActive && b.imageUrl ? "amber" : "gray"));
      media.appendChild(badges);
      card.appendChild(media);

      const body = el("div", "p-3.5 flex items-start gap-3");
      const text = el("div", "min-w-0 flex-1");
      text.appendChild(el("div", "text-[13.5px] font-semibold truncate", b.title || "Untitled banner"));
      if (b.subtitle) text.appendChild(el("div", "text-[12px] text-zinc-500 truncate", b.subtitle));
      const meta = [
        b.linkType === "NONE" ? "No link" : `Opens ${b.linkType === "PRODUCT" ? "product" : "category"}: ${b.linkName || "(deleted)"}`,
        `Position ${b.sortOrder}`,
      ];
      if (b.startsAt || b.endsAt) meta.push(`${b.startsAt ? formatDateTime(b.startsAt) : "now"} → ${b.endsAt ? formatDateTime(b.endsAt) : "no end"}`);
      text.appendChild(el("div", "mt-1 text-[11.5px] text-zinc-400", meta.join(" · ")));
      body.appendChild(text);
      const act = el("div", "flex gap-1.5 shrink-0");
      act.appendChild(iconButton(EDIT_ICON, "Edit", () => openDialog(b)));
      act.appendChild(iconButton(DELETE_ICON, "Delete", async () => {
        if (!confirm(`Delete banner "${b.title || "Untitled"}"?`)) return;
        try {
          await authedFetch(`/admin/shop/banners/${b.id}`, { method: "DELETE" });
          load();
        } catch (err) {
          showBanner(errorEl, err.message || "Could not delete the banner.");
        }
      }, true));
      body.appendChild(act);
      card.appendChild(body);
      grid.appendChild(card);
    });
  }

  document.getElementById("add-banner-btn").addEventListener("click", () => openDialog(null));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");
    const btn = form.querySelector('[type="submit"]');
    const id = form.elements.id.value;
    const linkType = form.elements.linkType.value;
    const payload = {
      title: form.elements.title.value.trim(),
      subtitle: form.elements.subtitle.value.trim(),
      linkType,
      sortOrder: Number(form.elements.sortOrder.value) || 0,
      isActive: form.elements.isActive.checked,
      startsAt: fromLocalInput(form.elements.startsAt.value),
      endsAt: fromLocalInput(form.elements.endsAt.value),
    };
    if (linkType !== "NONE") {
      if (!form.elements.linkId.value) {
        showFormError(formError, { message: `Choose the ${linkType === "PRODUCT" ? "product" : "category"} this banner opens.` });
        return;
      }
      payload.linkId = form.elements.linkId.value;
    }
    const file = form.elements.image.files[0];
    btn.disabled = true;
    try {
      const saved = id
        ? await authedFetch(`/admin/shop/banners/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await authedFetch("/admin/shop/banners", { method: "POST", body: JSON.stringify(payload) });
      form.elements.id.value = saved.id;
      titleEl.textContent = "Edit Banner";
      if (file) {
        const body = new FormData();
        body.append("image", file);
        try {
          await authedFetch(`/admin/shop/banners/${saved.id}/image`, { method: "POST", body });
        } catch (err) {
          showFormError(formError, { message: `Banner saved, but the image didn't upload: ${err.message || "upload failed"}. Save again to retry.` });
          load();
          return;
        }
      }
      dialog.close();
      showBanner(noticeEl, `Banner ${id ? "saved" : "added"}.`);
      load();
    } catch (err) {
      showFormError(formError, err);
    } finally {
      btn.disabled = false;
    }
  });

  dialog.addEventListener("close", () => setPreview(null));

  Promise.all([authedFetch("/admin/shop/products"), authedFetch("/admin/shop/categories")])
    .then(([p, c]) => { products = p; categories = c; })
    .catch(() => {})
    .finally(load);
}

// --- Promo codes ---

const PROMO_STATUS = {
  ACTIVE: ["Active", "green"],
  SCHEDULED: ["Scheduled", "blue"],
  EXPIRED: ["Expired", "gray"],
  USED_UP: ["Used up", "amber"],
  INACTIVE: ["Off", "gray"],
};

function initPromoCodesPage() {
  const tbody = document.getElementById("promos-tbody");
  const errorEl = document.getElementById("promos-error");
  const noticeEl = document.getElementById("promos-notice");
  const dialog = document.getElementById("promo-dialog");
  const form = document.getElementById("promo-form");
  const formError = document.getElementById("promo-form-error");
  const titleEl = document.getElementById("promo-dialog-title");
  wireDialogClose(dialog);
  let currency = "MAD";

  function syncType() {
    const percent = form.elements.type.value === "PERCENT";
    document.getElementById("promo-value-label").textContent = percent ? "Percent off" : `Amount off (${currency})`;
    form.elements.value.max = percent ? "100" : "";
    document.getElementById("promo-max-row").classList.toggle("invisible", !percent);
  }
  form.elements.type.addEventListener("change", syncType);

  function openDialog(promo) {
    form.reset();
    formError.classList.add("hidden");
    form.elements.id.value = promo ? promo.id : "";
    titleEl.textContent = promo ? `Edit ${promo.code}` : "Add Promo Code";
    if (promo) {
      form.elements.code.value = promo.code;
      form.elements.type.value = promo.type;
      form.elements.value.value = Number(promo.value);
      form.elements.maxDiscount.value = promo.maxDiscount ?? "";
      form.elements.description.value = promo.description || "";
      form.elements.minSubtotal.value = promo.minSubtotal ?? "";
      form.elements.usageLimit.value = promo.usageLimit ?? "";
      form.elements.perStoreLimit.value = promo.perStoreLimit ?? "";
      form.elements.isActive.checked = promo.isActive;
      form.elements.startsAt.value = toLocalInput(promo.startsAt);
      form.elements.endsAt.value = toLocalInput(promo.endsAt);
    }
    syncType();
    dialog.showModal();
  }

  async function load() {
    try {
      render(await authedFetch("/admin/shop/promo-codes"));
    } catch (err) {
      tbody.innerHTML = "";
      showBanner(errorEl, err.message || "Could not load promo codes.");
    }
  }

  function render(promos) {
    if (!promos.length) {
      emptyRow(tbody, 7, "No promo codes yet.");
      return;
    }
    tbody.innerHTML = "";
    promos.forEach((p) => {
      const row = el("tr", "border-b border-zinc-100 last:border-0");
      const codeCell = el("td", "px-4 py-3");
      codeCell.appendChild(el("div", "font-mono font-semibold tracking-wide", p.code));
      if (p.description) codeCell.appendChild(el("div", "text-[11.5px] text-zinc-400", p.description));
      row.appendChild(codeCell);
      row.appendChild(el("td", "px-4 py-3 tabular-nums font-medium", p.type === "PERCENT"
        ? `${Number(p.value)}%${p.maxDiscount ? ` (max ${money(p.maxDiscount, currency)})` : ""}`
        : money(p.value, currency)));
      const rules = [];
      if (p.minSubtotal) rules.push(`Min ${money(p.minSubtotal, currency)}`);
      if (p.perStoreLimit) rules.push(`${p.perStoreLimit}× per merchant`);
      row.appendChild(el("td", "px-4 py-3 text-[12.5px] text-zinc-500", rules.join(" · ") || "—"));
      const usage = el("td", "px-4 py-3 text-[12.5px]");
      usage.appendChild(el("div", "tabular-nums font-medium", `${p.usedCount}${p.usageLimit ? ` / ${p.usageLimit}` : ""} used`));
      usage.appendChild(el("div", "text-zinc-400 tabular-nums", `${money(p.totalDiscountGiven, currency)} given`));
      row.appendChild(usage);
      row.appendChild(el("td", "px-4 py-3 text-[12px] text-zinc-500", p.startsAt || p.endsAt
        ? `${p.startsAt ? formatDateTime(p.startsAt) : "Now"} → ${p.endsAt ? formatDateTime(p.endsAt) : "no end"}`
        : "Always"));
      const statusCell = el("td", "px-4 py-3");
      const [label, tone] = PROMO_STATUS[p.status] || [p.status, "gray"];
      statusCell.appendChild(badge(label, tone));
      row.appendChild(statusCell);
      const act = el("td", "px-4 py-3 text-right");
      const wrap = el("div", "flex justify-end gap-1.5");
      wrap.appendChild(iconButton(EDIT_ICON, "Edit", () => openDialog(p)));
      wrap.appendChild(iconButton(DELETE_ICON, "Delete", async () => {
        const msg = p.ordersCount
          ? `Delete ${p.code}? It was used on ${p.ordersCount} order(s); those orders keep their discount.`
          : `Delete ${p.code}?`;
        if (!confirm(msg)) return;
        try {
          await authedFetch(`/admin/shop/promo-codes/${p.id}`, { method: "DELETE" });
          load();
        } catch (err) {
          showBanner(errorEl, err.message || "Could not delete the promo code.");
        }
      }, true));
      act.appendChild(wrap);
      row.appendChild(act);
      tbody.appendChild(row);
    });
  }

  document.getElementById("add-promo-btn").addEventListener("click", () => openDialog(null));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.classList.add("hidden");
    const id = form.elements.id.value;
    const percent = form.elements.type.value === "PERCENT";
    const payload = {
      code: form.elements.code.value.trim().toUpperCase(),
      type: form.elements.type.value,
      value: Number(form.elements.value.value),
      maxDiscount: percent ? optionalNumber(form.elements.maxDiscount.value) : null,
      description: form.elements.description.value.trim(),
      minSubtotal: optionalNumber(form.elements.minSubtotal.value),
      usageLimit: optionalNumber(form.elements.usageLimit.value),
      perStoreLimit: optionalNumber(form.elements.perStoreLimit.value),
      isActive: form.elements.isActive.checked,
      startsAt: fromLocalInput(form.elements.startsAt.value),
      endsAt: fromLocalInput(form.elements.endsAt.value),
    };
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const saved = id
        ? await authedFetch(`/admin/shop/promo-codes/${id}`, { method: "PATCH", body: JSON.stringify(payload) })
        : await authedFetch("/admin/shop/promo-codes", { method: "POST", body: JSON.stringify(payload) });
      dialog.close();
      showBanner(noticeEl, `${saved.code} ${id ? "saved" : "created"}.`);
      load();
    } catch (err) {
      showFormError(formError, err);
    } finally {
      btn.disabled = false;
    }
  });

  authedFetch("/admin/shop/settings")
    .then((st) => { currency = st.currency; })
    .catch(() => {})
    .finally(load);
}

// --- Shop settings ---

function initShopSettingsPage() {
  const form = document.getElementById("shop-settings-form");
  const statusEl = document.getElementById("shop-settings-status");
  const updatedEl = document.getElementById("shop-settings-updated");

  function fill(st) {
    form.elements.currency.value = st.currency;
    form.elements.deliveryFee.value = Number(st.deliveryFee);
    form.elements.freeDeliveryMinSubtotal.value = st.freeDeliveryMinSubtotal === null ? "" : Number(st.freeDeliveryMinSubtotal);
    form.elements.codEnabled.checked = st.codEnabled;
    form.elements.codCancellationLimit.value = st.codCancellationLimit;
    form.elements.codCancellationWindowDays.value = st.codCancellationWindowDays;
    updatedEl.textContent = `Last updated ${formatDateTime(st.updatedAt)}`;
  }

  authedFetch("/admin/shop/settings")
    .then(fill)
    .catch((err) => showStatus(statusEl, err.message || "Could not load settings.", true));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    statusEl.classList.add("hidden");
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      fill(await authedFetch("/admin/shop/settings", {
        method: "PATCH",
        body: JSON.stringify({
          currency: form.elements.currency.value.trim().toUpperCase(),
          deliveryFee: Number(form.elements.deliveryFee.value),
          freeDeliveryMinSubtotal: optionalNumber(form.elements.freeDeliveryMinSubtotal.value),
          codEnabled: form.elements.codEnabled.checked,
          codCancellationLimit: Number(form.elements.codCancellationLimit.value),
          codCancellationWindowDays: Number(form.elements.codCancellationWindowDays.value),
        }),
      }));
      showStatus(statusEl, "Saved", false);
    } catch (err) {
      showStatus(statusEl, err.message || "Could not save.", true);
    } finally {
      btn.disabled = false;
    }
  });
}
