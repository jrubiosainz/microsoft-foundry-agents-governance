// Global State
let agentsData = [];
let cy = null;
let resourceCache = {};
let allLoadedAgents = []; // Store all loaded agents for global graph/KPIs
let charts = {}; // Store Chart.js instances
let activeLoadingRequests = 0; // Track active fetches
let selectedProjects = new Set(); // Project names selected in the multi-select filter
const projectColorMap = {};        // projectName -> stable color (shared by dropdown + graph)

// Multi-select dropdown element refs (populated by initProjectMultiselect)
let _msBtn = null, _msPanel = null, _msList = null, _msSearch = null, _msOpen = false;
let debouncedApply = null;

// Distinct Colors for Agents
const AGENT_COLORS = [
    "#60cdff", "#8764b8", "#00cc6a", "#ffb900", "#e3008c", 
    "#0078d4", "#5c2d91", "#107c10", "#d83b01", "#b4009e"
];

// Icons Map (Fluent UI Style)
const ICONS = {
    agent: "/static/images/agent_logo.png",
    model: "https://img.icons8.com/fluency/96/artificial-intelligence.png",
    tool: "https://img.icons8.com/fluency/96/maintenance.png",
    github: "/static/images/github_logo.png",
    search: "https://img.icons8.com/fluency/96/search.png",
    code: "https://img.icons8.com/fluency/96/code.png",
    database: "https://img.icons8.com/fluency/96/database.png",
    connection: "https://img.icons8.com/fluency/96/link.png",
    resource: "https://img.icons8.com/fluency/96/folder-invoices.png",
    default: "https://img.icons8.com/fluency/96/help.png"
};

// Debounce helper — coalesces rapid calls (e.g. filter typing) into one
function debounce(fn, wait = 250) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

// Respect the user's reduced-motion preference for graph layout animation
function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function updateLoadingState(isLoading) {
    const indicator = document.getElementById("global-loading-indicator");
    const text = document.getElementById("loading-text");
    const spinner = indicator.querySelector(".animate-spin");

    if (isLoading) {
        activeLoadingRequests++;
        indicator.classList.remove("opacity-0");
        text.textContent = "Loading information...";
        text.classList.add("animate-pulse", "text-white");
        text.classList.remove("text-green-400");
        spinner.classList.remove("hidden");
    } else {
        activeLoadingRequests--;
        if (activeLoadingRequests <= 0) {
            activeLoadingRequests = 0;
            // All done
            text.textContent = "Your data is ready!";
            text.classList.remove("animate-pulse", "text-white");
            text.classList.add("text-green-400");
            spinner.classList.add("hidden");
            
            // Hide after 3 seconds
            setTimeout(() => {
                if (activeLoadingRequests === 0) {
                    indicator.classList.add("opacity-0");
                }
            }, 3000);
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Initialize Data
    loadAllData();

    // Filter Event Listeners (debounced to avoid rebuilding the graph on every keystroke)
    // Project is handled by a dedicated multi-select control (initProjectMultiselect).
    const filterInputs = ["filter-agent", "filter-model", "filter-tool"];
    const debouncedFilters = debounce(applyGlobalFilters, 250);
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const evt = el.tagName === "SELECT" ? "change" : "input";
            el.addEventListener(evt, debouncedFilters);
        }
    });

    // Project multi-select dropdown
    initProjectMultiselect();

    // Clear Filters
    const clearBtn = document.getElementById("clear-filters-btn");
    if(clearBtn) {
        clearBtn.addEventListener("click", () => {
            filterInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            selectedProjects.clear();
            syncProjectSelectionUI();
            if (_msOpen) renderProjectList(_msSearch ? _msSearch.value : "");
            applyGlobalFilters();
        });
    }

    // Graph Resize Observer
    const graphSection = document.getElementById('section-graph');
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.classList.contains('hidden') === false) {
                if (cy) {
                    cy.resize();
                    cy.fit();
                } else {
                    applyGlobalFilters();
                }
            }
        });
    });
    observer.observe(graphSection, { attributes: true, attributeFilter: ['class'] });
});

// --- View Toggle Logic ---
window.toggleGraphView = function(view) {
    const graphBtn = document.getElementById("view-toggle-graph");
    const tableBtn = document.getElementById("view-toggle-table");
    const graphContainer = document.getElementById("graph-view-container");
    const tableContainer = document.getElementById("table-view-container");

    if (view === 'graph') {
        graphBtn.classList.add("bg-white/10", "text-white", "shadow-sm");
        graphBtn.classList.remove("text-gray-400");
        tableBtn.classList.remove("bg-white/10", "text-white", "shadow-sm");
        tableBtn.classList.add("text-gray-400");

        graphContainer.classList.remove("hidden");
        tableContainer.classList.add("hidden");
        
        if (cy) cy.resize();
    } else {
        tableBtn.classList.add("bg-white/10", "text-white", "shadow-sm");
        tableBtn.classList.remove("text-gray-400");
        graphBtn.classList.remove("bg-white/10", "text-white", "shadow-sm");
        graphBtn.classList.add("text-gray-400");

        graphContainer.classList.add("hidden");
        tableContainer.classList.remove("hidden");
        
        applyGlobalFilters();
    }
};

function renderGlobalTable(agents = allLoadedAgents) {
    const tbody = document.getElementById("global-table-body");
    if (!tbody) return;

    if (agents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-gray-400">No agents loaded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = agents.map(agent => {
        const tools = agent.tools.map(t => `<span class="inline-block px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 text-xs border border-yellow-500/20 mr-1 mb-1">${t.name || t.type}</span>`).join("");
        const connections = agent.tools
            .filter(t => t.connection)
            .map(t => `<span class="inline-block px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-xs border border-green-500/20 mr-1 mb-1">${t.connection}</span>`)
            .join("");
        
        const accessCount = agent.accessCount !== undefined ? agent.accessCount : 'N/A';
        const accessCell = agent.projectId
            ? `<button type="button" onclick="openAccessDrawer('${agent.projectId}', '${agent.projectName}')" class="text-blue-400 hover:text-blue-300 underline decoration-dotted rounded focus-visible:outline-none">${accessCount} users</button>`
            : `<span class="text-gray-400">${accessCount} users</span>`;

        return `
            <tr class="hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                <td class="px-6 py-4 font-medium text-white">${agent.name}</td>
                <td class="px-6 py-4">${agent.projectName || '-'}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">${agent.model || 'N/A'}</span></td>
                <td class="px-6 py-4">${tools || '<span class="text-gray-400">-</span>'}</td>
                <td class="px-6 py-4">${connections || '<span class="text-gray-400">-</span>'}</td>
                <td class="px-6 py-4">${accessCell}</td>
            </tr>
        `;
    }).join("");
}

window.openAccessDrawer = async function(projectId, projectName) {
    const drawer = document.getElementById('access-drawer');
    const overlay = document.getElementById('drawer-overlay');
    const tbody = document.getElementById('access-table-body');
    const loading = document.getElementById('access-loading');
    const subtitle = document.getElementById('access-drawer-subtitle');

    subtitle.textContent = `Role assignments for Project: ${projectName}`;
    tbody.innerHTML = '';
    loading.classList.remove('hidden');
    
    drawer.classList.remove('translate-x-full');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.classList.remove('hidden');

    try {
        // projectId starts with /subscriptions/...
        // API expects /api/access/{resource_id}
        // We need to encode slashes or handle them. 
        // Since we used {resource_id:path} in FastAPI, we can pass it directly but without leading slash if we want to be safe, 
        // or just pass it. Let's strip leading slash to avoid double slash issues if any.
        const safeId = projectId.startsWith('/') ? projectId.substring(1) : projectId;
        const response = await fetch(`/api/access/${safeId}`);
        
        if (!response.ok) throw new Error("Failed to fetch access info");
        
        const assignments = await response.json();
        
        if (assignments.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-gray-400">No role assignments found.</td></tr>`;
        } else {
            tbody.innerHTML = assignments.map(role => {
                const props = role.properties;
                const principalId = props.principalId;
                const principalType = props.principalType;
                // Role Definition ID is a long string, we might want to resolve it to a name if possible, 
                // but for now we show the ID or try to guess common ones.
                // Common Roles: 
                // Owner: 8e3af657-a8ff-443c-a75c-2fe8c4bcb635
                // Contributor: b24988ac-6180-42a0-ab88-20f7382dd24c
                // Reader: acdd72a7-3385-48ef-bd42-f606fba81ae7
                
                let roleName = "Custom Role";
                if (props.roleDefinitionId.includes("8e3af657-a8ff-443c-a75c-2fe8c4bcb635")) roleName = "Owner";
                else if (props.roleDefinitionId.includes("b24988ac-6180-42a0-ab88-20f7382dd24c")) roleName = "Contributor";
                else if (props.roleDefinitionId.includes("acdd72a7-3385-48ef-bd42-f606fba81ae7")) roleName = "Reader";
                else if (props.roleDefinitionId.includes("5e0bd9bd-7b93-4f28-af87-19fc36ad61bd")) roleName = "Azure AI Developer";
                else roleName = props.roleDefinitionId.split('/').pop(); // Fallback to ID

                return `
                    <tr class="hover:bg-white/5 border-b border-white/5 last:border-0">
                        <td class="px-4 py-3 font-medium text-white">${principalId}</td>
                        <td class="px-4 py-3 text-gray-400">${principalType}</td>
                        <td class="px-4 py-3 text-blue-400">${roleName}</td>
                        <td class="px-4 py-3 text-gray-400 text-xs truncate max-w-[200px]" title="${role.id}">${role.id.split('/resourceGroups/')[1] || 'Subscription'}</td>
                    </tr>
                `;
            }).join("");
        }

    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-red-400">Error: ${e.message}</td></tr>`;
    } finally {
        loading.classList.add('hidden');
    }
};

// --- Data Loading Functions ---

async function loadAllData() {
    updateLoadingState(true);
    try {
        const subsResponse = await fetch("/api/subscriptions");
        if (!subsResponse.ok) throw new Error("Failed to fetch subscriptions");
        const subs = await subsResponse.json();

        const allAgentsPromises = subs.map(async (sub) => {
            try {
                const resResponse = await fetch(`/api/resources/${sub.subscriptionId}`);
                if (!resResponse.ok) return [];
                const data = await resResponse.json();
                resourceCache[sub.subscriptionId] = data;

                // Collect all projects (from hubs and orphans)
                const projects = data.projects || [];
                
                // Fetch agents for all projects
                return await fetchAgentsForProjects(projects);
            } catch (e) {
                console.error(`Error loading resources for sub ${sub.subscriptionId}`, e);
                return [];
            }
        });

        const agentsArrays = await Promise.all(allAgentsPromises);
        allLoadedAgents = agentsArrays.flat();

        populateProjectOptions();
        updateKPIs();
        applyGlobalFilters(); // This will render graph and table

    } catch (error) {
        console.error("Fatal error loading data", error);
    } finally {
        updateLoadingState(false);
    }
}

async function fetchAgentsForProjects(projects) {
    const allAgents = [];
    // Limit concurrency to avoid overwhelming the server/browser
    const CHUNK_SIZE = 5;
    for (let i = 0; i < projects.length; i += CHUNK_SIZE) {
        const chunk = projects.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (p) => {
            try {
                // Pass project_id (p.id) to fetch access info
                const response = await fetch(`/api/agents?project_endpoint=${encodeURIComponent(p.endpoint)}&project_id=${encodeURIComponent(p.id)}`);
                if (response.ok) {
                    const agents = await response.json();
                    agents.forEach(a => {
                        a.projectName = p.name;
                        a.projectEndpoint = p.endpoint;
                        // a.projectId is already set by backend if project_id was passed
                        allAgents.push(a);
                    });
                }
            } catch (e) {
                console.error(`Failed to fetch agents for ${p.name}`, e);
            }
        }));
    }
    return allAgents;
}

// --- Project multi-select dropdown ---------------------------------------

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

// Assign a stable color per project (shared between the dropdown swatch and the graph cluster)
function ensureProjectColor(name) {
    if (!projectColorMap[name]) {
        const idx = Object.keys(projectColorMap).length % AGENT_COLORS.length;
        projectColorMap[name] = AGENT_COLORS[idx];
    }
    return projectColorMap[name];
}

// Projects present in the loaded data, with agent counts, sorted by count desc then name
function getProjectStats() {
    const counts = {};
    allLoadedAgents.forEach(a => {
        const n = a.projectName || "Unassigned";
        counts[n] = (counts[n] || 0) + 1;
    });
    return Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
        .map(name => ({ name, count: counts[name], color: ensureProjectColor(name) }));
}

function populateProjectOptions() {
    // Pre-assign stable colors (alphabetical) so swatches stay consistent across renders
    [...new Set(allLoadedAgents.map(a => a.projectName || "Unassigned"))]
        .sort((a, b) => a.localeCompare(b))
        .forEach(ensureProjectColor);

    if (_msOpen) renderProjectList(_msSearch ? _msSearch.value : "");
    syncProjectSelectionUI();
}

function initProjectMultiselect() {
    _msBtn = document.getElementById("filter-project-btn");
    if (!_msBtn) return;

    debouncedApply = debounce(applyGlobalFilters, 220);

    // Panel is appended to <body> with position:fixed so it escapes the
    // scrollable filter bar / main overflow context (no clipping).
    _msPanel = document.createElement("div");
    _msPanel.className = "ms-panel hidden";
    _msPanel.setAttribute("role", "dialog");
    _msPanel.setAttribute("aria-label", "Select projects");
    _msPanel.innerHTML =
        '<input type="text" class="ms-panel__search" placeholder="Search projects..." aria-label="Search projects">' +
        '<div class="ms-panel__actions">' +
            '<button type="button" class="ms-panel__action" data-act="all">Select all</button>' +
            '<button type="button" class="ms-panel__action" data-act="clear">Clear</button>' +
        '</div>' +
        '<ul class="ms-panel__list" role="listbox" aria-multiselectable="true"></ul>';
    document.body.appendChild(_msPanel);
    _msSearch = _msPanel.querySelector(".ms-panel__search");
    _msList = _msPanel.querySelector(".ms-panel__list");

    _msBtn.addEventListener("click", (e) => { e.stopPropagation(); toggleProjectPanel(); });
    _msSearch.addEventListener("input", () => renderProjectList(_msSearch.value));
    _msPanel.querySelector('[data-act="all"]').addEventListener("click", () => {
        getProjectStats()
            .filter(p => !_msSearch.value || p.name.toLowerCase().includes(_msSearch.value.toLowerCase()))
            .forEach(p => selectedProjects.add(p.name));
        renderProjectList(_msSearch.value);
        syncProjectSelectionUI();
        applyGlobalFilters();
    });
    _msPanel.querySelector('[data-act="clear"]').addEventListener("click", () => {
        selectedProjects.clear();
        renderProjectList(_msSearch.value);
        syncProjectSelectionUI();
        applyGlobalFilters();
    });

    document.addEventListener("click", (e) => {
        if (_msOpen && !_msPanel.contains(e.target) && !_msBtn.contains(e.target)) closeProjectPanel();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && _msOpen) { closeProjectPanel(); _msBtn.focus(); }
    });
    window.addEventListener("resize", () => { if (_msOpen) positionProjectPanel(); });
    window.addEventListener("scroll", () => { if (_msOpen) positionProjectPanel(); }, true);
}

function renderProjectList(text) {
    if (!_msList) return;
    const q = (text || "").toLowerCase();
    const stats = getProjectStats().filter(p => !q || p.name.toLowerCase().includes(q));

    if (stats.length === 0) {
        _msList.innerHTML = '<li class="ms-panel__empty">' +
            (allLoadedAgents.length ? "No projects match" : "No projects loaded yet") + "</li>";
        return;
    }

    _msList.innerHTML = stats.map(p => {
        const safe = escapeHtml(p.name);
        const checked = selectedProjects.has(p.name) ? "checked" : "";
        return '<li><label class="ms-option">' +
            '<input type="checkbox" value="' + safe + '" ' + checked + '>' +
            '<span class="ms-option__swatch" style="background:' + p.color + '"></span>' +
            '<span class="ms-option__name" title="' + safe + '">' + safe + '</span>' +
            '<span class="ms-option__count">' + p.count + '</span>' +
        '</label></li>';
    }).join("");

    _msList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener("change", () => {
            if (cb.checked) selectedProjects.add(cb.value);
            else selectedProjects.delete(cb.value);
            syncProjectSelectionUI();
            debouncedApply();
        });
    });
}

function syncProjectSelectionUI() {
    const label = document.getElementById("filter-project-label");
    const countEl = document.getElementById("filter-project-count");
    if (!label || !countEl) return;
    const n = selectedProjects.size;
    if (n === 0) {
        label.textContent = "All Projects";
        countEl.classList.add("hidden");
    } else if (n === 1) {
        label.textContent = [...selectedProjects][0];
        countEl.classList.add("hidden");
    } else {
        label.textContent = "Projects";
        countEl.textContent = String(n);
        countEl.classList.remove("hidden");
    }
}

function toggleProjectPanel() { _msOpen ? closeProjectPanel() : openProjectPanel(); }

function openProjectPanel() {
    _msOpen = true;
    _msBtn.setAttribute("aria-expanded", "true");
    _msSearch.value = "";
    renderProjectList("");
    _msPanel.classList.remove("hidden");
    positionProjectPanel();
    _msSearch.focus();
}

function closeProjectPanel() {
    _msOpen = false;
    _msBtn.setAttribute("aria-expanded", "false");
    _msPanel.classList.add("hidden");
}

function positionProjectPanel() {
    const r = _msBtn.getBoundingClientRect();
    const panelW = _msPanel.offsetWidth || 256;
    const maxLeft = window.innerWidth - panelW - 8;
    const left = Math.max(8, Math.min(r.left, maxLeft));
    _msPanel.style.top = (r.bottom + 6) + "px";
    _msPanel.style.left = left + "px";
}

function applyGlobalFilters() {
    const agentFilter = document.getElementById("filter-agent").value.toLowerCase();
    const modelFilter = document.getElementById("filter-model").value.toLowerCase();
    const toolFilter = document.getElementById("filter-tool").value.toLowerCase();

    // Filter the global list of agents
    const filteredAgents = allLoadedAgents.filter(agent => {
        const projName = agent.projectName || "Unassigned";
        const a = (agent.name || "").toLowerCase();
        const m = (agent.model || "").toLowerCase();
        const t = agent.tools.map(tool => (tool.name || tool.type).toLowerCase()).join(" ");

        return (selectedProjects.size === 0 || selectedProjects.has(projName)) &&
               (!agentFilter || a.includes(agentFilter)) &&
               (!modelFilter || m.includes(modelFilter)) &&
               (!toolFilter || t.includes(toolFilter));
    });

    // Update Graph
    renderGlobalGraph(filteredAgents);

    // Update Table
    renderGlobalTable(filteredAgents);
}

// --- KPI & Graph Logic ---

function updateKPIs() {
    const totalAgents = allLoadedAgents.length;
    const activeModels = new Set(allLoadedAgents.map(a => a.model).filter(m => m)).size;
    
    // Calculate Total Projects from resourceCache
    let totalProjects = 0;
    Object.values(resourceCache).forEach(subData => {
        totalProjects += (subData.projects || []).length;
    });

    const kpiAgents = document.getElementById("kpi-total-agents");
    const kpiModels = document.getElementById("kpi-active-models");
    const kpiProjects = document.getElementById("kpi-total-projects");

    if(kpiAgents) kpiAgents.textContent = totalAgents;
    if(kpiModels) kpiModels.textContent = activeModels;
    if(kpiProjects) kpiProjects.textContent = totalProjects;

    updateDashboardCharts();
}

function updateDashboardCharts() {
    // 1. Model Distribution
    const modelCounts = {};
    allLoadedAgents.forEach(a => {
        const m = a.model || "Unknown";
        modelCounts[m] = (modelCounts[m] || 0) + 1;
    });
    renderChart("chart-models", "doughnut", "Model Distribution", modelCounts);

    // 2. Project Utilization (Active vs Empty)
    let totalProjects = 0;
    let activeProjects = new Set();
    
    Object.values(resourceCache).forEach(subData => {
        (subData.projects || []).forEach(p => {
            totalProjects++;
            // Check if this project has agents in allLoadedAgents
            // We match by endpoint or name. allLoadedAgents has projectEndpoint.
            if (allLoadedAgents.some(a => a.projectEndpoint === p.endpoint)) {
                activeProjects.add(p.endpoint);
            }
        });
    });
    
    const emptyProjects = totalProjects - activeProjects.size;
    renderChart("chart-projects", "pie", "Project Utilization", {
        "Active Projects": activeProjects.size,
        "Empty Projects": emptyProjects
    }, ["#00cc6a", "#374151"]); // Green vs Gray

    // 3. Tool Types
    const toolCounts = {};
    allLoadedAgents.forEach(a => {
        a.tools.forEach(t => {
            let type = t.type || "custom";
            if (type.includes("search")) type = "File Search";
            else if (type.includes("code")) type = "Code Interpreter";
            else if (type.includes("function")) type = "Function";
            else if (type.includes("mcp")) type = "MCP Tool";
            
            toolCounts[type] = (toolCounts[type] || 0) + 1;
        });
    });
    renderChart("chart-tools", "bar", "Tool Types", toolCounts);
}

function renderChart(canvasId, type, label, dataMap, customColors = null) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    const labels = Object.keys(dataMap);
    const data = Object.values(dataMap);
    
    // Generate colors if not provided
    const colors = customColors || labels.map((_, i) => AGENT_COLORS[i % AGENT_COLORS.length]);

    charts[canvasId] = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: colors,
                borderColor: "rgba(0,0,0,0.1)",
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { color: '#9ca3af', boxWidth: 12, font: { size: 10 } }
                }
            },
            scales: type === 'bar' ? {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9ca3af' } },
                x: { grid: { display: false }, ticks: { color: '#9ca3af' } }
            } : {
                display: false // No scales for pie/doughnut
            }
        }
    });
}

function renderGlobalGraph(agents = allLoadedAgents) {
    if (!document.getElementById("cy")) return;

    const elements = [];

    // Fixed Colors from Legend
    const COLORS = {
        agent: "#a855f7", // Purple
        model: "#3b82f6", // Blue
        tool: "#eab308",  // Yellow
        resource: "#22c55e" // Green
    };

    // 1. Project parent (compound) nodes — one circle per project cluster
    const projectCounts = {};
    agents.forEach(a => {
        const n = a.projectName || "Unassigned";
        projectCounts[n] = (projectCounts[n] || 0) + 1;
    });
    const projectParentId = {};
    Object.keys(projectCounts).forEach(name => {
        const pid = `proj::${name}`;
        projectParentId[name] = pid;
        const count = projectCounts[name];
        elements.push({
            data: {
                id: pid,
                label: `${name}\n${count} agent${count === 1 ? "" : "s"}`,
                type: "project",
                color: ensureProjectColor(name)
            },
            selectable: false
        });
    });

    agents.forEach((agent) => {
        const parent = projectParentId[agent.projectName || "Unassigned"];

        // Agent Node
        elements.push({
            data: {
                id: agent.id,
                label: agent.name,
                type: "agent",
                icon: ICONS.agent,
                color: COLORS.agent,
                parent: parent
            }
        });

        // Model Node
        if (agent.model) {
            const modelId = `${agent.id}_model`;
            // Check if node exists to avoid duplicates (shared models)
            if (!elements.find(e => e.data.id === modelId)) {
                elements.push({
                    data: {
                        id: modelId,
                        label: agent.model,
                        type: "model",
                        icon: ICONS.model,
                        color: COLORS.model,
                        parent: parent
                    }
                });
            }
            elements.push({
                data: { source: agent.id, target: modelId, color: COLORS.model }
            });
        }

        // Tools & Connections
        agent.tools.forEach((tool, i) => {
            const toolName = tool.name || tool.type;
            const toolId = `${agent.id}_tool_${i}`;
            const tl = (tool.type || "").toLowerCase();

            let icon = ICONS.tool;
            if (tl.includes("search")) icon = ICONS.search;
            else if (tl.includes("code")) icon = ICONS.code;
            else if (tl.includes("retrieval")) icon = ICONS.database;
            else if (tl.includes("mcp")) icon = "https://img.icons8.com/fluency/96/api-settings.png";

            // Tool Node
            elements.push({
                data: {
                    id: toolId,
                    label: toolName,
                    type: "tool",
                    icon: icon,
                    color: COLORS.tool,
                    parent: parent
                }
            });
            elements.push({
                data: { source: agent.id, target: toolId, color: COLORS.tool }
            });

            // Connection Node (New Edge from Tool)
            if (tool.connection) {
                const connId = `${toolId}_conn`;
                const connName = tool.connection;
                let connIcon = ICONS.resource;
                const cn = connName.toLowerCase();

                if (cn.includes("github")) connIcon = ICONS.github;
                else if (cn.includes("search")) connIcon = ICONS.search;
                else if (cn.includes("database") || cn.includes("sql")) connIcon = ICONS.database;

                elements.push({
                    data: {
                        id: connId,
                        label: connName,
                        type: "resource",
                        icon: connIcon,
                        color: COLORS.resource,
                        parent: parent
                    }
                });
                elements.push({
                    data: { source: toolId, target: connId, color: COLORS.resource }
                });
            }
        });
    });

    initCytoscape(elements);
}

function graphLayout(nodeCount) {
    const reduce = prefersReducedMotion();
    // Disable entrance animation for large graphs or reduced-motion users
    const animate = !reduce && nodeCount <= 350;

    if (typeof window.cytoscapeFcose !== "undefined") {
        return {
            name: "fcose",
            quality: "default",
            animate: animate,
            animationDuration: 700,
            animationEasing: "ease-out",
            randomize: true,
            fit: true,
            padding: 40,
            packComponents: true,   // pack the per-project clusters tightly
            nodeSeparation: 80,
            idealEdgeLength: 55,
            nodeRepulsion: 6500,
            gravity: 0.3,
            gravityRange: 3.8,
            gravityCompound: 1.4,
            gravityRangeCompound: 1.6,
            nestingFactor: 0.1,
            numIter: 2500,
            tile: true
        };
    }

    // Fallback if the fcose extension failed to load: cose still respects compounds
    return {
        name: "cose",
        animate: animate,
        randomize: true,
        componentSpacing: 100,
        nodeRepulsion: 400000,
        nodeOverlap: 12,
        idealEdgeLength: 70,
        edgeElasticity: 100,
        nestingFactor: 5,
        gravity: 80,
        numIter: 1000,
        coolingFactor: 0.95,
        minTemp: 1.0
    };
}

function initCytoscape(elements) {
    if (cy) cy.destroy();

    const reduce = prefersReducedMotion();
    const nodeCount = elements.filter(e => !e.data.source).length;

    cy = cytoscape({
        container: document.getElementById("cy"),
        elements: elements,
        style: [
            {
                selector: "node",
                style: {
                    "background-color": "data(color)",
                    "background-opacity": 0.2,
                    "background-image": "data(icon)",
                    "background-fit": "cover",
                    "background-width": "60%",
                    "background-height": "60%",
                    "border-width": 2,
                    "border-color": "data(color)",
                    "width": 50,
                    "height": 50,
                    "label": "data(label)",
                    "font-family": "Segoe UI, sans-serif",
                    "font-size": "10px",
                    "color": "#e5e7eb", // Light text for dark mode
                    "text-valign": "bottom",
                    "text-margin-y": 6,
                    "text-wrap": "wrap",
                    "text-max-width": 80,
                    "text-outline-color": "#000000",
                    "text-outline-width": 2,
                    "text-outline-opacity": 0.5
                }
            },
            {
                // Project cluster bubble (compound parent) — the "circle per project"
                selector: 'node[type="project"]',
                style: {
                    "background-image": "none",
                    "background-color": "data(color)",
                    "background-opacity": 0.07,
                    // Cytoscape renders compound parents as rectangles only; round the corners for a softer "bubble".
                    "shape": "round-rectangle",
                    "border-width": 2,
                    "border-color": "data(color)",
                    "border-opacity": 0.55,
                    "padding": "34px",
                    "label": "data(label)",
                    "text-valign": "bottom",
                    "text-halign": "center",
                    "text-margin-y": 12,
                    "text-wrap": "wrap",
                    "font-size": "15px",
                    "font-weight": "bold",
                    "color": "#f3f4f6",
                    "text-outline-color": "#0f1117",
                    "text-outline-width": 3,
                    "text-outline-opacity": 0.9
                }
            },
            {
                selector: 'node[type="project"]:active',
                style: { "background-opacity": 0.14 }
            },
            {
                selector: "node[icon*='github_logo.png']",
                style: {
                    "background-color": "#ffffff",
                    "background-opacity": 1,
                    "background-width": "80%",
                    "background-height": "80%"
                }
            },
            {
                selector: "node[type=\"agent\"]",
                style: {
                    "width": 70,
                    "height": 70,
                    "border-width": 3,
                    "font-weight": "bold",
                    "font-size": "12px"
                }
            },
            {
                selector: "edge",
                style: {
                    "width": 1,
                    "line-color": "data(color)",
                    "target-arrow-color": "data(color)",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "opacity": 0.4
                }
            }
        ],
        layout: graphLayout(nodeCount),
        userZoomingEnabled: true,
        userPanningEnabled: true
    });

    // Tap a project bubble to zoom into it; tap empty canvas to reset the view
    cy.on("tap", 'node[type="project"]', (evt) => {
        cy.animate({ fit: { eles: evt.target, padding: 50 } }, { duration: reduce ? 0 : 350 });
    });
    cy.on("tap", (evt) => {
        if (evt.target === cy) {
            cy.animate({ fit: { eles: cy.elements(), padding: 40 } }, { duration: reduce ? 0 : 350 });
        }
    });

    window.cy = cy;
}
