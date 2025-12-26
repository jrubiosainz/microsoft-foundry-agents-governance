// Global State
let agentsData = [];
let cy = null;
let resourceCache = {};
let allLoadedAgents = []; // Store all loaded agents for global graph/KPIs
let charts = {}; // Store Chart.js instances
let activeLoadingRequests = 0; // Track active fetches

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

    // Filter Event Listeners
    const filterInputs = ["filter-project", "filter-agent", "filter-model", "filter-tool"];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", applyGlobalFilters);
        }
    });

    // Clear Filters
    const clearBtn = document.getElementById("clear-filters-btn");
    if(clearBtn) {
        clearBtn.addEventListener("click", () => {
            filterInputs.forEach(id => {
                const el = document.getElementById(id);
                el.value = "";
            });
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
        tbody.innerHTML = `<tr><td colspan="8" class="px-6 py-8 text-center text-gray-500">No agents loaded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = agents.map(agent => {
        const tools = agent.tools.map(t => `<span class="inline-block px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 text-xs border border-yellow-500/20 mr-1 mb-1">${t.name || t.type}</span>`).join("");
        const connections = agent.tools
            .filter(t => t.connection)
            .map(t => `<span class="inline-block px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-xs border border-green-500/20 mr-1 mb-1">${t.connection}</span>`)
            .join("");
        
        const accessCount = agent.accessCount !== undefined ? agent.accessCount : 'N/A';
        const accessClick = agent.projectId ? `onclick="openAccessDrawer('${agent.projectId}', '${agent.projectName}')"` : '';
        const accessClass = agent.projectId ? "text-blue-400 hover:text-blue-300 cursor-pointer underline decoration-dotted" : "text-gray-500";

        return `
            <tr class="hover:bg-white/5 transition-colors border-b border-white/5 last:border-0">
                <td class="px-6 py-4 font-medium text-white">${agent.name}</td>
                <td class="px-6 py-4">${agent.projectName || '-'}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded bg-blue-500/10 text-blue-400 text-xs border border-blue-500/20">${agent.model || 'N/A'}</span></td>
                <td class="px-6 py-4">${tools || '<span class="text-gray-600">-</span>'}</td>
                <td class="px-6 py-4">${connections || '<span class="text-gray-600">-</span>'}</td>
                <td class="px-6 py-4">
                    <span class="${accessClass}" ${accessClick}>
                        ${accessCount} users
                    </span>
                </td>
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
            tbody.innerHTML = `<tr><td colspan="4" class="px-4 py-8 text-center text-gray-500">No role assignments found.</td></tr>`;
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
                        <td class="px-4 py-3 text-gray-500 text-xs truncate max-w-[200px]" title="${role.id}">${role.id.split('/resourceGroups/')[1] || 'Subscription'}</td>
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

function applyGlobalFilters() {
    const projectFilter = document.getElementById("filter-project").value.toLowerCase();
    const agentFilter = document.getElementById("filter-agent").value.toLowerCase();
    const modelFilter = document.getElementById("filter-model").value.toLowerCase();
    const toolFilter = document.getElementById("filter-tool").value.toLowerCase();

    // Filter the global list of agents
    const filteredAgents = allLoadedAgents.filter(agent => {
        const p = (agent.projectName || "").toLowerCase();
        const a = (agent.name || "").toLowerCase();
        const m = (agent.model || "").toLowerCase();
        const t = agent.tools.map(tool => (tool.name || tool.type).toLowerCase()).join(" ");

        return (!projectFilter || p.includes(projectFilter)) &&
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
    
    agents.forEach((agent, idx) => {
        // Agent Node
        elements.push({
            data: { 
                id: agent.id, 
                label: agent.name, 
                type: "agent", 
                icon: ICONS.agent, 
                color: COLORS.agent 
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
                        color: COLORS.model 
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
            
            let icon = ICONS.tool;
            if (tool.type.toLowerCase().includes("search")) icon = ICONS.search;
            else if (tool.type.toLowerCase().includes("code")) icon = ICONS.code;
            else if (tool.type.toLowerCase().includes("retrieval")) icon = ICONS.database;
            else if (tool.type.toLowerCase().includes("mcp")) icon = "https://img.icons8.com/fluency/96/api-settings.png";

            // Tool Node
            elements.push({
                data: { 
                    id: toolId, 
                    label: toolName, 
                    type: "tool", 
                    icon: icon, 
                    color: COLORS.tool 
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
                
                if (connName.toLowerCase().includes("github")) connIcon = ICONS.github;
                else if (connName.toLowerCase().includes("search")) connIcon = ICONS.search;
                else if (connName.toLowerCase().includes("database") || connName.toLowerCase().includes("sql")) connIcon = ICONS.database;

                elements.push({
                    data: {
                        id: connId,
                        label: connName,
                        type: "resource",
                        icon: connIcon,
                        color: COLORS.resource
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

function initCytoscape(elements) {
    if (cy) cy.destroy();

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
        layout: {
            name: "cose",
            animate: true,
            randomize: true,
            componentSpacing: 80,
            nodeRepulsion: 400000,
            nodeOverlap: 10,
            idealEdgeLength: 80,
            edgeElasticity: 100,
            nestingFactor: 5,
            gravity: 80,
            numIter: 1000,
            initialTemp: 200,
            coolingFactor: 0.95,
            minTemp: 1.0
        },
        userZoomingEnabled: true,
        userPanningEnabled: true
    });
    
    cy.center();
    window.cy = cy;
}
