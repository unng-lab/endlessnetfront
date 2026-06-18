const defaultAPIBase =
  String(window.ENDLESSNET_API_BASE || "").trim().replace(/\/+$/, "") ||
  (location.hostname.endsWith("github.io") || location.protocol === "file:"
    ? "http://localhost:8080"
    : window.location.origin);

const state = {
  token: localStorage.getItem("endlessnet.token") || "",
  apiBase: localStorage.getItem("endlessnet.apiBase") || defaultAPIBase,
  me: null,
  networks: [],
  nodesByNetwork: new Map(),
  activeView: "overview",
  selectedNetwork: "",
};

const views = {
  overview: {
    title: "Обзор",
    subtitle: "Состояние VPN-сетей и устройств",
    element: document.querySelector("#overviewView"),
  },
  networks: {
    title: "Сети",
    subtitle: "Адресные пространства и DNS",
    element: document.querySelector("#networksView"),
  },
  nodes: {
    title: "Устройства",
    subtitle: "Клиенты внутри выбранной VPN-сети",
    element: document.querySelector("#nodesView"),
  },
  access: {
    title: "Доступ",
    subtitle: "Команды для клиента и MCP-сервера",
    element: document.querySelector("#accessView"),
  },
};

const els = {
  authPanel: document.querySelector("#authPanel"),
  apiBaseInput: document.querySelector("#apiBaseInput"),
  saveApiBaseButton: document.querySelector("#saveApiBaseButton"),
  loginLink: document.querySelector("#loginLink"),
  tokenInput: document.querySelector("#tokenInput"),
  saveTokenButton: document.querySelector("#saveTokenButton"),
  devTokenButton: document.querySelector("#devTokenButton"),
  logoutButton: document.querySelector("#logoutButton"),
  refreshButton: document.querySelector("#refreshButton"),
  reloadNetworksButton: document.querySelector("#reloadNetworksButton"),
  alertBox: document.querySelector("#alertBox"),
  userName: document.querySelector("#userName"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  viewTitle: document.querySelector("#viewTitle"),
  viewSubtitle: document.querySelector("#viewSubtitle"),
  metricNetworks: document.querySelector("#metricNetworks"),
  metricNodes: document.querySelector("#metricNodes"),
  metricPeers: document.querySelector("#metricPeers"),
  metricSession: document.querySelector("#metricSession"),
  topologyNetworkSelect: document.querySelector("#topologyNetworkSelect"),
  nodesNetworkSelect: document.querySelector("#nodesNetworkSelect"),
  topology: document.querySelector("#topology"),
  networksTable: document.querySelector("#networksTable"),
  nodesTable: document.querySelector("#nodesTable"),
  createNetworkForm: document.querySelector("#createNetworkForm"),
  installCommand: document.querySelector("#installCommand"),
  clientCommand: document.querySelector("#clientCommand"),
  mcpCommand: document.querySelector("#mcpCommand"),
  copyInstallCommand: document.querySelector("#copyInstallCommand"),
  copyClientCommand: document.querySelector("#copyClientCommand"),
  copyMCPCommand: document.querySelector("#copyMCPCommand"),
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

els.apiBaseInput.value = state.apiBase;

els.saveApiBaseButton.addEventListener("click", () => {
  const apiBase = normalizeAPIBase(els.apiBaseInput.value);
  if (!apiBase) {
    showAlert("Введите URL backend API");
    return;
  }
  setAPIBase(apiBase);
  loadAll();
});

els.apiBaseInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    els.saveApiBaseButton.click();
  }
});

els.saveTokenButton.addEventListener("click", () => {
  const token = els.tokenInput.value.trim();
  if (!token) {
    showAlert("Введите токен сессии");
    return;
  }
  setToken(token);
  loadAll();
});

els.tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    els.saveTokenButton.click();
  }
});

els.devTokenButton.addEventListener("click", async () => {
  try {
    const payload = await fetchJSON("/auth/dev-token", { auth: false });
    setToken(payload.token);
    await loadAll();
  } catch (error) {
    showAlert(error.message);
  }
});

els.logoutButton.addEventListener("click", async () => {
  try {
    await fetchJSON("/auth/logout", { method: "POST", auth: false });
  } catch {
    // Local state is cleared even if the cookie was already gone.
  }
  setToken("");
  state.me = null;
  state.networks = [];
  state.nodesByNetwork.clear();
  window.location.replace("/");
});

els.refreshButton.addEventListener("click", () => loadAll());
els.reloadNetworksButton.addEventListener("click", () => loadAll());

els.topologyNetworkSelect.addEventListener("change", (event) => {
  state.selectedNetwork = event.target.value;
  renderTopology();
});

els.nodesNetworkSelect.addEventListener("change", async (event) => {
  state.selectedNetwork = event.target.value;
  await ensureNodes(state.selectedNetwork);
  renderNodes();
  renderTopology();
});

els.createNetworkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const dns = String(form.get("dns") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    await fetchJSON("/api/v1/networks", {
      method: "POST",
      body: {
        name: String(form.get("name") || "").trim(),
        cidr: String(form.get("cidr") || "").trim(),
        dns,
      },
    });
    event.currentTarget.reset();
    event.currentTarget.elements.cidr.value = "100.64.0.0/24";
    await loadAll();
  } catch (error) {
    showAlert(error.message);
  }
});

els.copyInstallCommand.addEventListener("click", () => copyText(els.installCommand.textContent));
els.copyClientCommand.addEventListener("click", () => copyText(els.clientCommand.textContent));
els.copyMCPCommand.addEventListener("click", () => copyText(els.mcpCommand.textContent));

bootstrapTokenFromHash();
render();
loadAll();

function bootstrapTokenFromHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = params.get("token");
  if (token) {
    setToken(token);
    history.replaceState(null, "", window.location.pathname);
  }
}

function setToken(token) {
  state.token = token;
  if (token) {
    localStorage.setItem("endlessnet.token", token);
    els.tokenInput.value = "";
  } else {
    localStorage.removeItem("endlessnet.token");
  }
}

function setAPIBase(apiBase) {
  state.apiBase = apiBase;
  localStorage.setItem("endlessnet.apiBase", apiBase);
  els.apiBaseInput.value = apiBase;
  renderCommands();
  renderLoginLink();
}

async function loadAll() {
  clearAlert();
  try {
    state.me = await fetchJSON("/api/v1/me");
    state.networks = await fetchJSON("/api/v1/networks");
    if (!state.selectedNetwork && state.networks.length > 0) {
      state.selectedNetwork = state.networks[0].id;
    }
    await ensureNodes(state.selectedNetwork);
    render();
  } catch (error) {
    showAlert(error.message);
    if (/401|403|token/i.test(error.message)) {
      setToken("");
      window.location.replace(apiURL("/auth/login"));
      return;
    }
    render();
  }
}

async function ensureNodes(networkRef) {
  if (!networkRef) {
    return;
  }
  const nodes = await fetchJSON(`/api/v1/networks/${encodeURIComponent(networkRef)}/nodes`);
  state.nodesByNetwork.set(networkRef, nodes);
}

async function fetchJSON(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
  }
  const response = await fetch(apiURL(path), {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text.trim() || response.statusText}`);
  }
  return response.json();
}

function setView(view) {
  state.activeView = view;
  renderView();
}

function render() {
  renderSession();
  renderLoginLink();
  renderView();
  renderSelectors();
  renderMetrics();
  renderNetworks();
  renderNodes();
  renderTopology();
  renderCommands();
}

function renderSession() {
  const online = Boolean(state.token && state.me);
  els.authPanel.classList.toggle("hidden", Boolean(state.token));
  els.statusDot.classList.toggle("online", online);
  els.statusText.textContent = online ? "online" : "Нет сессии";
  els.metricSession.textContent = online ? "online" : "offline";
  els.userName.textContent = state.me?.name || state.me?.email || "Гость";
}

function renderView() {
  const meta = views[state.activeView] || views.overview;
  els.viewTitle.textContent = meta.title;
  els.viewSubtitle.textContent = meta.subtitle;
  Object.values(views).forEach((view) => view.element.classList.remove("active"));
  meta.element.classList.add("active");
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
}

function renderSelectors() {
  const options = state.networks.map((network) => {
    const selected = network.id === state.selectedNetwork ? "selected" : "";
    return `<option value="${escapeHTML(network.id)}" ${selected}>${escapeHTML(network.name)}</option>`;
  });
  const markup = options.length
    ? options.join("")
    : '<option value="">Нет сетей</option>';
  els.topologyNetworkSelect.innerHTML = markup;
  els.nodesNetworkSelect.innerHTML = markup;
}

function renderMetrics() {
  const nodes = currentNodes();
  els.metricNetworks.textContent = String(state.networks.length);
  els.metricNodes.textContent = String(totalNodes());
  els.metricPeers.textContent = String(Math.max(0, nodes.length * Math.max(0, nodes.length - 1)));
}

function renderNetworks() {
  if (state.networks.length === 0) {
    els.networksTable.innerHTML = `<tr><td colspan="4">Нет сетей</td></tr>`;
    return;
  }
  els.networksTable.innerHTML = state.networks
    .map(
      (network) => `<tr>
        <td><strong>${escapeHTML(network.name)}</strong></td>
        <td class="mono">${escapeHTML(network.cidr)}</td>
        <td>${(network.dns || []).map((dns) => `<span class="pill">${escapeHTML(dns)}</span>`).join("") || '<span class="muted">Не задан</span>'}</td>
        <td class="mono">${escapeHTML(network.id)}</td>
      </tr>`,
    )
    .join("");
}

function renderNodes() {
  const nodes = currentNodes();
  if (!state.selectedNetwork) {
    els.nodesTable.innerHTML = `<tr><td colspan="3">Выберите сеть</td></tr>`;
    return;
  }
  if (nodes.length === 0) {
    els.nodesTable.innerHTML = `<tr><td colspan="3">Устройств нет</td></tr>`;
    return;
  }
  els.nodesTable.innerHTML = nodes
    .map(
      (node) => `<tr>
        <td><strong>${escapeHTML(node.hostname || "Без имени")}</strong></td>
        <td class="mono">${escapeHTML(node.assigned_ip)}</td>
        <td>${renderTags(node.tags)}</td>
      </tr>`,
    )
    .join("");
}

function renderTopology() {
  const network = state.networks.find((item) => item.id === state.selectedNetwork);
  const nodes = currentNodes();
  if (!network) {
    els.topology.innerHTML = `<div class="empty-state">Создайте сеть</div>`;
    return;
  }
  if (nodes.length === 0) {
    els.topology.innerHTML = `<div class="empty-state">${escapeHTML(network.name)}: устройств нет</div>`;
    return;
  }
  const width = 900;
  const height = 420;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(260, 90 + nodes.length * 12);
  const points = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    return {
      node,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * Math.min(radius, 150),
    };
  });
  const links = points
    .map((point) => `<line class="link" x1="${centerX}" y1="${centerY}" x2="${point.x}" y2="${point.y}"></line>`)
    .join("");
  const renderedNodes = points
    .map(
      (point, index) => `<g>
        <circle class="node ${index === 0 ? "self" : ""}" cx="${point.x}" cy="${point.y}" r="28"></circle>
        <text x="${point.x}" y="${point.y + 48}" text-anchor="middle">${escapeHTML(shortName(point.node.hostname))}</text>
        <text x="${point.x}" y="${point.y + 66}" text-anchor="middle" class="mono">${escapeHTML(point.node.assigned_ip)}</text>
      </g>`,
    )
    .join("");
  els.topology.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Топология сети ${escapeHTML(network.name)}">
    <line class="link" x1="${centerX - 70}" y1="${centerY}" x2="${centerX + 70}" y2="${centerY}"></line>
    ${links}
    <rect x="${centerX - 86}" y="${centerY - 34}" width="172" height="68" rx="8" fill="#ffffff" stroke="#28735f" stroke-width="2"></rect>
    <text x="${centerX}" y="${centerY - 4}" text-anchor="middle" font-weight="700">${escapeHTML(network.name)}</text>
    <text x="${centerX}" y="${centerY + 18}" text-anchor="middle" class="mono">${escapeHTML(network.cidr)}</text>
    ${renderedNodes}
  </svg>`;
}

function renderCommands() {
  const server = state.apiBase;
  const network = selectedNetworkName();
  const token = state.token ? "<saved-token>" : "<token>";
  const siteRoot = new URL(window.ENDLESSNET_SITE_ROOT || "../", window.location.href);
  const installURL = new URL("install.sh", siteRoot).href;
  els.installCommand.textContent = [
    `curl -fsSL ${installURL} | ENDLESSNET_SERVER_URL="${server}" ENDLESSNET_AUTH_TOKEN="${token}" ENDLESSNET_NETWORK="${network || "<network>"}" sh`,
    "",
    "# If release binaries are not published yet, provide one source explicitly:",
    "# ENDLESSNET_RELEASE_BASE_URL=https://github.com/<owner>/<repo>/releases/latest/download",
    "# ENDLESSNET_GO_PACKAGE=github.com/<owner>/<repo>/cmd/endlessnet-client@latest",
  ].join("\n");
  els.clientCommand.textContent = [
    `go run ./cmd/endlessnet-client login --server ${server} --token ${token}`,
    `go run ./cmd/endlessnet-client network list`,
    `go run ./cmd/endlessnet-client up --network ${network || "<network>"} --hostname <hostname> --output .\\wg-endlessnet.conf`,
  ].join("\n");
  els.mcpCommand.textContent = [
    `$env:ENDLESSNET_SERVER_URL = "${server}"`,
    `$env:ENDLESSNET_TOKEN = "${token}"`,
    "go run ./cmd/endlessnet-mcp",
  ].join("\n");
}

function renderLoginLink() {
  els.loginLink.href = apiURL("/auth/login");
}

function currentNodes() {
  return state.nodesByNetwork.get(state.selectedNetwork) || [];
}

function totalNodes() {
  let total = 0;
  for (const nodes of state.nodesByNetwork.values()) {
    total += nodes.length;
  }
  return total;
}

function selectedNetworkName() {
  return state.networks.find((network) => network.id === state.selectedNetwork)?.name || "";
}

function shortName(value) {
  if (!value) {
    return "устройство";
  }
  return value.length > 16 ? `${value.slice(0, 13)}...` : value;
}

function renderTags(tags) {
  if (!tags || tags.length === 0) {
    return '<span class="muted">Без тегов</span>';
  }
  return tags.map((tag) => `<span class="pill">${escapeHTML(tag)}</span>`).join("");
}

function showAlert(message) {
  els.alertBox.textContent = message;
  els.alertBox.classList.remove("hidden");
}

function clearAlert() {
  els.alertBox.textContent = "";
  els.alertBox.classList.add("hidden");
}

function apiURL(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return `${state.apiBase}${path.startsWith("/") ? path : `/${path}`}`;
}

function normalizeAPIBase(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    clearAlert();
  } catch (error) {
    showAlert(error.message);
  }
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
