(() => {
  const state = {
    roles: [],
    rolesMap: new Map(),
    accessKeysCatalog: [],
    accessKeysMap: new Map(),
    routesOriginal: null,
    routesWorking: null,
    embeddedRolesRaw: null,
    embeddedRoutesRaw: null,
    embeddedAccessKeysRaw: null,
    nodesById: new Map(),
    rootNodeIds: [],
    expanded: new Set(),
    selectedNodeId: null,
    search: "",
    changedOnly: false
  };
  const i18n = window.__ROLE_MENU_MAPPER_I18N || {};

  const el = {
    importFile: document.getElementById("importFile"),
    importRolesFile: document.getElementById("importRolesFile"),
    importRoutesFile: document.getElementById("importRoutesFile"),
    importAccessKeysFile: document.getElementById("importAccessKeysFile"),
    exportMappedBtn: document.getElementById("exportMappedBtn"),
    searchInput: document.getElementById("searchInput"),
    statusLine: document.getElementById("statusLine"),
    errorBox: document.getElementById("errorBox"),
    treeRoot: document.getElementById("treeRoot"),
    selectedMeta: document.getElementById("selectedMeta"),
    rolesBox: document.getElementById("rolesBox"),
    allRolesBtn: document.getElementById("allRolesBtn"),
    clearRolesBtn: document.getElementById("clearRolesBtn"),
    allAccessBtn: document.getElementById("allAccessBtn"),
    clearAccessBtn: document.getElementById("clearAccessBtn"),
    expandAllBtn: document.getElementById("expandAllBtn"),
    collapseAllBtn: document.getElementById("collapseAllBtn")
  };

  function setError(msg) { el.errorBox.textContent = msg || ""; }
  function setStatus(msg, ok = false) {
    el.statusLine.textContent = msg;
    el.statusLine.className = ok ? "status ok" : "status muted";
  }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function nodeId(route, parentId, index) { return `${parentId || "root"}|${index}|${String(route.path || "")}|${String(route.name || "")}`; }

  async function parseJsonFile(file) {
    const text = await file.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error(`Некорректный JSON: ${e.message}`); }
  }

  function normalizeRolesJson(raw) {
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.data) ? raw.data : null;
    if (!list) throw new Error("roles.json: ожидается массив или объект с data[]");
    const roles = list.map((r) => ({
      authority: String(r.authority || "").trim(),
      title: String(r.title || r.authority || "").trim(),
      groupTitle: String(r.groupTitle || "").trim()
    })).filter((r) => r.authority);
    if (!roles.length) throw new Error("roles.json: список ролей пуст");
    return roles;
  }

  function normalizeAccessKeysCatalog(raw) {
    if (!raw) return [];
    const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.accessInfo) ? raw.accessInfo : null;
    if (!list) return [];
    return [...new Set(list.map((k) => String(k).trim()).filter(Boolean))].sort();
  }

  function initializeWorkingRoles(route) {
    if (!route.meta) route.meta = {};
    const roles = Array.isArray(route.meta.roles) ? route.meta.roles.filter((r) => typeof r === "string") : [];
    return roles;
  }

  function initializeWorkingAccessKeys(route) {
    if (!route.meta) route.meta = {};
    const keys = Array.isArray(route.meta.accessInfoKeys)
      ? route.meta.accessInfoKeys.filter((k) => typeof k === "string")
      : [];
    return keys;
  }

  function findOriginalById(id) {
    const parts = id.split("|");
    let cursor = state.routesOriginal;
    for (let i = 0; i < parts.length; i += 4) {
      const index = Number(parts[i + 1]);
      if (!Array.isArray(cursor) || Number.isNaN(index) || index >= cursor.length) return null;
      const node = cursor[index];
      if (i >= parts.length - 4) return node;
      cursor = node.children;
    }
    return null;
  }

  function extractOriginalRoles(route) {
    if (!route || !route.meta || !Array.isArray(route.meta.roles) || route.meta.roles.length === 0) {
      return [];
    }
    return route.meta.roles.filter((r) => typeof r === "string");
  }

  function extractOriginalAccessKeys(route) {
    if (!route || !route.meta || !Array.isArray(route.meta.accessInfoKeys) || route.meta.accessInfoKeys.length === 0) {
      return [];
    }
    return route.meta.accessInfoKeys.filter((k) => typeof k === "string");
  }

  function collectNodes(routes, parentId = null, depth = 0) {
    const ids = [];
    routes.forEach((route, index) => {
      const id = nodeId(route, parentId, index);
      const original = findOriginalById(id);
      state.nodesById.set(id, {
        id,
        route,
        depth,
        parentId,
        roles: new Set(initializeWorkingRoles(route)),
        originalRoles: new Set(extractOriginalRoles(original)),
        accessKeys: new Set(initializeWorkingAccessKeys(route)),
        originalAccessKeys: new Set(extractOriginalAccessKeys(original)),
        childIds: [],
        visible: true
      });
      ids.push(id);
      if (Array.isArray(route.children) && route.children.length) {
        state.nodesById.get(id).childIds = collectNodes(route.children, id, depth + 1);
      }
    });
    return ids;
  }

  function resolveTitle(route) {
    const raw = route && route.meta && route.meta.title ? String(route.meta.title) : "";
    if (raw && i18n[raw]) return i18n[raw];
    if (raw) return raw;
    return route && (route.name || route.path) ? String(route.name || route.path) : "unnamed";
  }

  function getEffectiveRoles(node) {
    if (!node) return new Set();
    if (!node.childIds.length) return new Set(node.roles);
    const merged = new Set();
    node.childIds.forEach((cid) => {
      const child = state.nodesById.get(cid);
      getEffectiveRoles(child).forEach((role) => merged.add(role));
    });
    return merged;
  }

  function getEffectiveAccessKeys(node) {
    if (!node) return new Set();
    if (!node.childIds.length) return new Set(node.accessKeys);
    const merged = new Set();
    node.childIds.forEach((cid) => {
      getEffectiveAccessKeys(state.nodesById.get(cid)).forEach((k) => merged.add(k));
    });
    return merged;
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  function isChanged(node) {
    return !setsEqual(getEffectiveRoles(node), node.originalRoles)
      || !setsEqual(getEffectiveAccessKeys(node), node.originalAccessKeys);
  }

  function matchesSearch(node) {
    if (!state.search) return true;
    const route = node.route || {};
    const keys = [...getEffectiveAccessKeys(node)].join(" ");
    const text = `${route.path || ""} ${route.name || ""} ${resolveTitle(route)} ${keys}`.toLowerCase();
    return text.includes(state.search);
  }

  function updateVisibility(nodeId) {
    const node = state.nodesById.get(nodeId);
    const hasVisibleChild = node.childIds.some((cid) => updateVisibility(cid));
    const selfVisible = matchesSearch(node) && (!state.changedOnly || isChanged(node));
    node.visible = selfVisible || hasVisibleChild;
    return node.visible;
  }

  function syncNodeToRoute(node) {
    if (!node.route.meta) node.route.meta = {};
    node.route.meta.roles = [...getEffectiveRoles(node)].sort();
    node.route.meta.accessInfoKeys = [...getEffectiveAccessKeys(node)].sort();
  }

  function syncAllNodesToRoutes() {
    state.nodesById.forEach((node) => syncNodeToRoute(node));
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function refreshCounters() {
    const ready = Boolean(state.routesWorking && state.roles.length);
    el.exportMappedBtn.disabled = !ready;
    el.expandAllBtn.disabled = !ready;
    el.collapseAllBtn.disabled = !ready;
  }

  function renderTreeNode(nodeId, container) {
    const node = state.nodesById.get(nodeId);
    if (!node || !node.visible) return;
    const hasChildren = node.childIds.length > 0;
    const wrap = document.createElement("div");
    wrap.style.marginLeft = `${node.depth * 14}px`;
    const row = document.createElement("div");
    const isHiddenRoute = node.route && node.route.meta && node.route.meta.visible === false;
    row.className = `tree-item${state.selectedNodeId === nodeId ? " selected" : ""}${isHiddenRoute ? " hidden-route" : ""}`;
    row.addEventListener("click", () => {
      state.selectedNodeId = nodeId;
      renderTree();
      renderRolesPanel();
    });

    const toggle = document.createElement("span");
    if (hasChildren) {
      toggle.className = "tree-toggle";
      toggle.textContent = state.expanded.has(nodeId) ? "▾" : "▸";
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (state.expanded.has(nodeId)) state.expanded.delete(nodeId);
        else state.expanded.add(nodeId);
        renderTree();
      });
    } else {
      toggle.className = "tree-pad";
      toggle.textContent = "";
    }
    row.appendChild(toggle);

    const name = document.createElement("span");
    name.className = "tree-name";
    name.textContent = `${resolveTitle(node.route)} (${node.route.path || "-"})`;
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "tree-meta";
    meta.textContent = `roles: ${getEffectiveRoles(node).size} | flags: ${getEffectiveAccessKeys(node).size}${isChanged(node) ? " | changed" : ""}`;
    row.appendChild(meta);

    wrap.appendChild(row);
    container.appendChild(wrap);
    if (hasChildren && state.expanded.has(nodeId)) node.childIds.forEach((cid) => renderTreeNode(cid, container));
  }

  function renderTree() {
    el.treeRoot.innerHTML = "";
    if (!state.rootNodeIds.length) {
      el.treeRoot.textContent = "Нет данных";
      return;
    }
    state.rootNodeIds.forEach((id) => renderTreeNode(id, el.treeRoot));
  }

  function appendSubsection(parent, title) {
    const h = document.createElement("div");
    h.className = "pane-subtitle";
    h.textContent = title;
    parent.appendChild(h);
  }

  function appendSelectedList(parent, title, items, itemFormatter) {
    const box = document.createElement("div");
    box.className = "selected-box";
    const header = document.createElement("div");
    header.className = "selected-box-title";
    header.textContent = `${title}: ${items.length}`;
    box.appendChild(header);

    const content = document.createElement("div");
    content.className = "selected-box-content";
    if (!items.length) {
      const empty = document.createElement("span");
      empty.className = "selected-empty";
      empty.textContent = "Ничего не выбрано";
      content.appendChild(empty);
    } else {
      items.forEach((item) => {
        const chip = document.createElement("span");
        chip.className = "selected-chip";
        chip.textContent = itemFormatter(item);
        content.appendChild(chip);
      });
    }
    box.appendChild(content);
    parent.appendChild(box);
  }

  function createTwoColumnLayout() {
    const split = document.createElement("div");
    split.className = "roles-flags-split";
    const colRoles = document.createElement("div");
    colRoles.className = "roles-flags-col roles-flags-col--roles";
    const colFlags = document.createElement("div");
    colFlags.className = "roles-flags-col roles-flags-col--flags";
    split.appendChild(colRoles);
    split.appendChild(colFlags);
    return { split, colRoles, colFlags };
  }

  function renderRolesPanel() {
    el.rolesBox.innerHTML = "";
    const node = state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : null;
    if (!node) {
      el.selectedMeta.textContent = "Узел не выбран";
      el.allRolesBtn.disabled = true;
      el.clearRolesBtn.disabled = true;
      el.allAccessBtn.disabled = true;
      el.clearAccessBtn.disabled = true;
      return;
    }

    const isParent = node.childIds.length > 0;
    const effectiveRoles = getEffectiveRoles(node);
    const effectiveAccess = getEffectiveAccessKeys(node);
    el.selectedMeta.textContent = `${resolveTitle(node.route)} | ${node.route.path || "-"} | Ролей: ${effectiveRoles.size}, флагов: ${effectiveAccess.size}`;
    el.allRolesBtn.disabled = isParent;
    el.clearRolesBtn.disabled = isParent;
    el.allAccessBtn.disabled = isParent;
    el.clearAccessBtn.disabled = isParent;

    if (isParent) {
      const info = document.createElement("div");
      info.className = "status muted";
      info.style.marginBottom = "8px";
      info.textContent = "У родителя роли и флаги считаются по объединению потомков (только просмотр).";
      el.rolesBox.appendChild(info);
      const { split, colRoles, colFlags } = createTwoColumnLayout();
      el.rolesBox.appendChild(split);
      appendSelectedList(
        colRoles,
        "Выбрано ролей",
        state.roles.filter((role) => effectiveRoles.has(role.authority)),
        (role) => role.authority
      );
      appendSubsection(colRoles, "Роли");
      state.roles.forEach((role) => {
        const label = document.createElement("label");
        label.className = "role-item role-item-readonly";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = effectiveRoles.has(role.authority);
        cb.disabled = true;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(` ${role.authority} — ${role.title}`));
        colRoles.appendChild(label);
      });
      appendSelectedList(
        colFlags,
        "Выбрано флагов",
        state.accessKeysCatalog.filter((key) => effectiveAccess.has(key)),
        (key) => key
      );
      appendSubsection(colFlags, "Флаги (accessInfoKeys)");
      state.accessKeysCatalog.forEach((key) => {
        const label = document.createElement("label");
        label.className = "role-item role-item-readonly access-key-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = effectiveAccess.has(key);
        cb.disabled = true;
        label.appendChild(cb);
        label.appendChild(document.createTextNode(` ${key}`));
        colFlags.appendChild(label);
      });
      return;
    }

    const { split, colRoles, colFlags } = createTwoColumnLayout();
    el.rolesBox.appendChild(split);
    appendSelectedList(
      colRoles,
      "Выбрано ролей",
      state.roles.filter((role) => effectiveRoles.has(role.authority)),
      (role) => role.authority
    );
    appendSubsection(colRoles, "Роли");
    state.roles.forEach((role) => {
      const label = document.createElement("label");
      label.className = "role-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = effectiveRoles.has(role.authority);
      cb.addEventListener("change", () => {
        if (cb.checked) node.roles.add(role.authority);
        else node.roles.delete(role.authority);
        syncNodeToRoute(node);
        refreshAll(false);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` ${role.authority} — ${role.title}`));
      colRoles.appendChild(label);
    });

    appendSelectedList(
      colFlags,
      "Выбрано флагов",
      state.accessKeysCatalog.filter((key) => effectiveAccess.has(key)),
      (key) => key
    );
    appendSubsection(colFlags, "Флаги (accessInfoKeys)");
    if (!state.accessKeysCatalog.length) {
      const empty = document.createElement("div");
      empty.className = "status muted";
      empty.textContent = "Каталог флагов пуст. Загрузите accessInfoKeys.json или обновите data.js.";
      colFlags.appendChild(empty);
      return;
    }
    state.accessKeysCatalog.forEach((key) => {
      const label = document.createElement("label");
      label.className = "role-item access-key-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = effectiveAccess.has(key);
      cb.addEventListener("change", () => {
        if (cb.checked) node.accessKeys.add(key);
        else node.accessKeys.delete(key);
        syncNodeToRoute(node);
        refreshAll(false);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` ${key}`));
      colFlags.appendChild(label);
    });
  }

  function refreshAll(resetFilters = true) {
    if (resetFilters) {
      state.search = "";
      state.changedOnly = false;
      el.searchInput.value = "";
    }
    state.rootNodeIds.forEach((id) => updateVisibility(id));
    refreshCounters();
    renderTree();
    renderRolesPanel();
  }

  function rebuildState(roles, routes) {
    state.roles = roles;
    state.rolesMap = new Map(roles.map((r) => [r.authority, r]));
    state.accessKeysMap = new Map(state.accessKeysCatalog.map((k) => [k, k]));
    state.routesOriginal = clone(routes);
    state.routesWorking = clone(routes);
    state.nodesById.clear();
    state.rootNodeIds = collectNodes(state.routesWorking, null, 0);
    state.expanded = new Set(state.rootNodeIds);
    state.selectedNodeId = null;
    refreshAll(true);
  }

  function applyImport(importRoutes) {
    if (!Array.isArray(importRoutes)) throw new Error("Импорт: ожидается массив routes");
    const importedNodes = new Map();
    (function walk(list, parentId = null) {
      list.forEach((route, index) => {
        const id = nodeId(route, parentId, index);
        importedNodes.set(id, route);
        if (Array.isArray(route.children)) walk(route.children, id);
      });
    })(importRoutes);

    let updated = 0;
    state.nodesById.forEach((node, id) => {
      const imported = importedNodes.get(id);
      if (!imported) return;
      const roles = imported.meta && Array.isArray(imported.meta.roles) ? imported.meta.roles : [];
      node.roles = new Set(roles.filter((r) => state.rolesMap.has(r)));
      const keys = imported.meta && Array.isArray(imported.meta.accessInfoKeys)
        ? imported.meta.accessInfoKeys
        : [];
      node.accessKeys = new Set(keys.filter((k) => state.accessKeysMap.has(k)));
      syncNodeToRoute(node);
      updated++;
    });
    refreshAll(false);
    setStatus(`Импорт применен, обновлено узлов: ${updated}`, true);
  }

  function setAllRolesForSelected(all) {
    const node = state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : null;
    if (!node || node.childIds.length) return;
    node.roles = all ? new Set(state.roles.map((r) => r.authority)) : new Set();
    syncNodeToRoute(node);
    refreshAll(false);
  }

  function setAllAccessKeysForSelected(all) {
    const node = state.selectedNodeId ? state.nodesById.get(state.selectedNodeId) : null;
    if (!node || node.childIds.length) return;
    node.accessKeys = all ? new Set(state.accessKeysCatalog) : new Set();
    syncNodeToRoute(node);
    refreshAll(false);
  }

  function expandCollapseAll(expand) {
    if (expand) {
      state.nodesById.forEach((node, id) => { if (node.childIds.length) state.expanded.add(id); });
    } else {
      state.expanded.clear();
    }
    renderTree();
  }

  function loadEmbeddedProjectData() {
    try {
      setError("");
      setStatus("Загрузка встроенных данных...");
      const embedded = window.__ROLE_MENU_MAPPER_DATA;
      if (!embedded || !embedded.roles || !embedded.routes) throw new Error("Не найдены встроенные данные (data.js).");
      state.embeddedRolesRaw = clone(embedded.roles);
      state.embeddedRoutesRaw = clone(embedded.routes);
      state.embeddedAccessKeysRaw = embedded.accessInfoKeys != null ? clone(embedded.accessInfoKeys) : null;
      state.accessKeysCatalog = normalizeAccessKeysCatalog(embedded.accessInfoKeys);
      const roles = normalizeRolesJson(embedded.roles);
      if (!Array.isArray(embedded.routes)) throw new Error("routes.json: ожидается массив");
      rebuildState(roles, embedded.routes);
      setStatus("Данные загружены. Редактируйте роли и флаги, затем экспортируйте JSON.", true);
    } catch (e) {
      setError(e.message);
      setStatus("Ошибка инициализации встроенных данных");
    }
  }

  el.importFile.addEventListener("change", async () => {
    try {
      setError("");
      const file = el.importFile.files && el.importFile.files[0];
      if (!file) return;
      const raw = await parseJsonFile(file);
      applyImport(raw);
    } catch (e) {
      setError(e.message);
    }
  });
  el.importRolesFile.addEventListener("change", async () => {
    try {
      setError("");
      const file = el.importRolesFile.files && el.importRolesFile.files[0];
      if (!file) return;
      const raw = await parseJsonFile(file);
      const roles = normalizeRolesJson(raw);
      const routesSource = state.routesWorking ? state.routesWorking : (state.embeddedRoutesRaw || []);
      rebuildState(roles, routesSource);
      setStatus("roles.json импортирован", true);
    } catch (e) {
      setError(e.message);
    }
  });
  el.importRoutesFile.addEventListener("change", async () => {
    try {
      setError("");
      const file = el.importRoutesFile.files && el.importRoutesFile.files[0];
      if (!file) return;
      const raw = await parseJsonFile(file);
      if (!Array.isArray(raw)) throw new Error("routes.json: ожидается массив");
      const rolesSource = state.roles.length ? state.roles : normalizeRolesJson(state.embeddedRolesRaw);
      rebuildState(rolesSource, raw);
      setStatus("routes.json импортирован", true);
    } catch (e) {
      setError(e.message);
    }
  });
  el.importAccessKeysFile.addEventListener("change", async () => {
    try {
      setError("");
      const file = el.importAccessKeysFile.files && el.importAccessKeysFile.files[0];
      if (!file) return;
      const raw = await parseJsonFile(file);
      const catalog = normalizeAccessKeysCatalog(raw);
      if (!catalog.length) throw new Error("accessInfoKeys: список пуст");
      state.accessKeysCatalog = catalog;
      state.embeddedAccessKeysRaw = raw;
      if (!state.routesWorking || !state.roles.length) throw new Error("Сначала загрузите roles и routes (или откройте страницу с data.js)");
      rebuildState(state.roles, clone(state.routesWorking));
      setStatus("accessInfoKeys.json импортирован", true);
    } catch (e) {
      setError(e.message);
    }
  });
  el.exportMappedBtn.addEventListener("click", () => {
    syncAllNodesToRoutes();
    downloadJson("routes.mapped.json", state.routesWorking);
    setStatus("Результат экспортирован", true);
  });
  el.allRolesBtn.addEventListener("click", () => setAllRolesForSelected(true));
  el.clearRolesBtn.addEventListener("click", () => setAllRolesForSelected(false));
  el.allAccessBtn.addEventListener("click", () => setAllAccessKeysForSelected(true));
  el.clearAccessBtn.addEventListener("click", () => setAllAccessKeysForSelected(false));
  el.expandAllBtn.addEventListener("click", () => expandCollapseAll(true));
  el.collapseAllBtn.addEventListener("click", () => expandCollapseAll(false));
  el.searchInput.addEventListener("input", () => {
    state.search = el.searchInput.value.trim().toLowerCase();
    state.rootNodeIds.forEach((id) => updateVisibility(id));
    renderTree();
  });
  loadEmbeddedProjectData();
})();
