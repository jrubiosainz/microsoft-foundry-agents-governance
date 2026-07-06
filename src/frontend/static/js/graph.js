// Global State
let agentsData = [];
let cy = null;
let resourceCache = {};
let allLoadedAgents = []; // Store all loaded agents for global graph/KPIs
let charts = {}; // Store Chart.js instances
let activeLoadingRequests = 0; // Track active fetches
let selectedProjects = new Set(); // Project names selected in the multi-select filter
let selectedAgents = new Set();   // Agent names selected in the multi-select filter
let selectedModels = new Set();   // Model names selected in the multi-select filter
const projectColorMap = {};        // projectName -> stable color (shared by dropdown + graph)

// Multi-select controllers (created by initMultiselects)
let msProject = null, msAgent = null, msModel = null;
let debouncedApply = null;

// Distinct Colors for Agents
const AGENT_COLORS = [
    "#60cdff", "#8764b8", "#00cc6a", "#ffb900", "#e3008c", 
    "#0078d4", "#5c2d91", "#107c10", "#d83b01", "#b4009e"
];

// Icons Map — official service logos vendored under /static/images/logos
const ICONS = {
    agent: "/static/images/foundry_logo.png",              // Foundry Agent Service
    model: "/static/images/logos/openai.svg",              // Azure OpenAI / model deployments
    tool: "/static/images/logos/function.svg",             // generic tool = Azure Functions
    github: "/static/images/github_logo.png",
    search: "/static/images/logos/ai-search.svg",          // search-type tools (grounding)
    aisearch: "/static/images/logos/ai-search.svg",        // Azure AI Search connections
    code: "/static/images/logos/code.svg",                 // code interpreter
    database: "/static/images/logos/sql.svg",              // Azure SQL / databases
    storage: "/static/images/logos/storage.svg",           // Azure Storage / blob
    mcp: "/static/images/logos/mcp.svg",                   // Model Context Protocol
    cognitive: "/static/images/logos/cognitive.svg",       // Azure AI Services
    bot: "/static/images/logos/bot.svg",                   // Azure Bot Service
    connection: "/static/images/logos/resource.svg",
    resource: "/static/images/logos/resource.svg",
    default: "/static/images/logos/resource.svg"
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
    // Project / Agent / Model are handled by dedicated multi-select controls (initMultiselects).
    const filterInputs = ["filter-tool"];
    const debouncedFilters = debounce(applyGlobalFilters, 250);
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const evt = el.tagName === "SELECT" ? "change" : "input";
            el.addEventListener(evt, debouncedFilters);
        }
    });

    // Project / Agent / Model multi-select dropdowns
    initMultiselects();

    // Clear Filters
    const clearBtn = document.getElementById("clear-filters-btn");
    if(clearBtn) {
        clearBtn.addEventListener("click", () => {
            filterInputs.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            selectedProjects.clear();
            selectedAgents.clear();
            selectedModels.clear();
            [msProject, msAgent, msModel].forEach(ms => ms && ms.refresh());
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

        populateFilterOptions();
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

// Distinct agent names present in the loaded data, with occurrence counts
function getAgentStats() {
    const counts = {};
    allLoadedAgents.forEach(a => {
        const n = a.name || "Unnamed";
        counts[n] = (counts[n] || 0) + 1;
    });
    return Object.keys(counts)
        .sort((a, b) => a.localeCompare(b))
        .map(name => ({ name, count: counts[name], color: "#a855f7" }));
}

// Distinct models present in the loaded data, with usage counts (busiest first)
function getModelStats() {
    const counts = {};
    allLoadedAgents.forEach(a => { if (a.model) counts[a.model] = (counts[a.model] || 0) + 1; });
    return Object.keys(counts)
        .sort((a, b) => counts[b] - counts[a] || a.localeCompare(b))
        .map(name => ({ name, count: counts[name], color: "#3b82f6" }));
}

function populateFilterOptions() {
    // Pre-assign stable project colors (alphabetical) so swatches stay consistent across renders
    [...new Set(allLoadedAgents.map(a => a.projectName || "Unassigned"))]
        .sort((a, b) => a.localeCompare(b))
        .forEach(ensureProjectColor);

    [msProject, msAgent, msModel].forEach(ms => ms && ms.refresh());
}

// Reusable multi-select dropdown. One instance per filter (project / agent / model).
// The panel is appended to <body> with position:fixed so it escapes the scrollable
// filter bar / main overflow context (no clipping), per the interaction rules.
function createMultiSelect(opts) {
    const btn = document.getElementById(opts.triggerId);
    if (!btn) return null;
    const labelEl = btn.querySelector(".ms-trigger__label");
    const countEl = btn.querySelector(".ms-trigger__count");

    const panel = document.createElement("div");
    panel.className = "ms-panel hidden";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", opts.dialogLabel);
    panel.innerHTML =
        '<input type="text" class="ms-panel__search" placeholder="' + opts.searchPlaceholder + '" aria-label="' + opts.searchPlaceholder + '">' +
        '<div class="ms-panel__actions">' +
            '<button type="button" class="ms-panel__action" data-act="all">Select all</button>' +
            '<button type="button" class="ms-panel__action" data-act="clear">Clear</button>' +
        '</div>' +
        '<ul class="ms-panel__list" role="listbox" aria-multiselectable="true"></ul>';
    document.body.appendChild(panel);
    const search = panel.querySelector(".ms-panel__search");
    const list = panel.querySelector(".ms-panel__list");
    const debounced = debounce(opts.onChange, 220);
    let open = false;

    function renderList(text) {
        const q = (text || "").toLowerCase();
        const stats = opts.getStats().filter(s => !q || s.name.toLowerCase().includes(q));
        if (stats.length === 0) {
            list.innerHTML = '<li class="ms-panel__empty">' +
                (allLoadedAgents.length ? "No matches" : "Nothing loaded yet") + "</li>";
            return;
        }
        list.innerHTML = stats.map(s => {
            const safe = escapeHtml(s.name);
            const checked = opts.selected.has(s.name) ? "checked" : "";
            const swatch = s.color
                ? '<span class="ms-option__swatch" style="background:' + s.color + '"></span>'
                : "";
            return '<li><label class="ms-option">' +
                '<input type="checkbox" value="' + safe + '" ' + checked + '>' +
                swatch +
                '<span class="ms-option__name" title="' + safe + '">' + safe + '</span>' +
                '<span class="ms-option__count">' + s.count + '</span>' +
            '</label></li>';
        }).join("");
        list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener("change", () => {
                if (cb.checked) opts.selected.add(cb.value);
                else opts.selected.delete(cb.value);
                syncUI();
                debounced();
            });
        });
    }

    function syncUI() {
        if (!labelEl) return;
        const n = opts.selected.size;
        if (n === 0) {
            labelEl.textContent = opts.allLabel;
            if (countEl) countEl.classList.add("hidden");
        } else if (n === 1) {
            labelEl.textContent = [...opts.selected][0];
            if (countEl) countEl.classList.add("hidden");
        } else {
            labelEl.textContent = opts.pluralLabel;
            if (countEl) { countEl.textContent = String(n); countEl.classList.remove("hidden"); }
        }
    }

    function position() {
        const r = btn.getBoundingClientRect();
        const panelW = panel.offsetWidth || 256;
        const left = Math.max(8, Math.min(r.left, window.innerWidth - panelW - 8));
        panel.style.top = (r.bottom + 6) + "px";
        panel.style.left = left + "px";
    }
    function openPanel() {
        open = true;
        btn.setAttribute("aria-expanded", "true");
        search.value = "";
        renderList("");
        panel.classList.remove("hidden");
        position();
        search.focus();
    }
    function closePanel() {
        open = false;
        btn.setAttribute("aria-expanded", "false");
        panel.classList.add("hidden");
    }

    btn.addEventListener("click", (e) => { e.stopPropagation(); open ? closePanel() : openPanel(); });
    search.addEventListener("input", () => renderList(search.value));
    panel.querySelector('[data-act="all"]').addEventListener("click", () => {
        opts.getStats()
            .filter(s => !search.value || s.name.toLowerCase().includes(search.value.toLowerCase()))
            .forEach(s => opts.selected.add(s.name));
        renderList(search.value);
        syncUI();
        opts.onChange();
    });
    panel.querySelector('[data-act="clear"]').addEventListener("click", () => {
        opts.selected.clear();
        renderList(search.value);
        syncUI();
        opts.onChange();
    });
    document.addEventListener("click", (e) => {
        if (open && !panel.contains(e.target) && !btn.contains(e.target)) closePanel();
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && open) { closePanel(); btn.focus(); }
    });
    window.addEventListener("resize", () => { if (open) position(); });
    window.addEventListener("scroll", () => { if (open) position(); }, true);

    return {
        refresh() { if (open) renderList(search.value); syncUI(); },
        syncUI
    };
}

function initMultiselects() {
    debouncedApply = debounce(applyGlobalFilters, 220);
    msProject = createMultiSelect({
        triggerId: "filter-project-btn", dialogLabel: "Select projects",
        searchPlaceholder: "Search projects...", allLabel: "All Projects", pluralLabel: "Projects",
        selected: selectedProjects, getStats: getProjectStats, onChange: applyGlobalFilters
    });
    msAgent = createMultiSelect({
        triggerId: "filter-agent-btn", dialogLabel: "Select agents",
        searchPlaceholder: "Search agents...", allLabel: "All Agents", pluralLabel: "Agents",
        selected: selectedAgents, getStats: getAgentStats, onChange: applyGlobalFilters
    });
    msModel = createMultiSelect({
        triggerId: "filter-model-btn", dialogLabel: "Select models",
        searchPlaceholder: "Search models...", allLabel: "All Models", pluralLabel: "Models",
        selected: selectedModels, getStats: getModelStats, onChange: applyGlobalFilters
    });
}

function applyGlobalFilters() {
    const toolFilter = (document.getElementById("filter-tool").value || "").toLowerCase();

    // Filter the global list of agents by the multi-select sets (empty set = all)
    const filteredAgents = allLoadedAgents.filter(agent => {
        const projName = agent.projectName || "Unassigned";
        const agentName = agent.name || "Unnamed";
        const t = agent.tools.map(tool => (tool.name || tool.type || "").toLowerCase()).join(" ");

        return (selectedProjects.size === 0 || selectedProjects.has(projName)) &&
               (selectedAgents.size === 0 || selectedAgents.has(agentName)) &&
               (selectedModels.size === 0 || (agent.model && selectedModels.has(agent.model))) &&
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
            if (tl.includes("mcp")) icon = ICONS.mcp;
            else if (tl.includes("search") || tl.includes("bing") || tl.includes("grounding")) icon = ICONS.search;
            else if (tl.includes("code")) icon = ICONS.code;
            else if (tl.includes("retrieval") || tl.includes("file")) icon = ICONS.database;
            else if (tl.includes("function")) icon = ICONS.tool;

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
                else if (cn.includes("search")) connIcon = ICONS.aisearch;
                else if (cn.includes("sql") || cn.includes("database") || cn.includes("cosmos")) connIcon = ICONS.database;
                else if (cn.includes("storage") || cn.includes("blob")) connIcon = ICONS.storage;
                else if (cn.includes("openai") || cn.includes("aoai")) connIcon = ICONS.model;
                else if (cn.includes("cognitive") || cn.includes("aiservice") || cn.includes("ai service")) connIcon = ICONS.cognitive;
                else if (cn.includes("bot")) connIcon = ICONS.bot;

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
