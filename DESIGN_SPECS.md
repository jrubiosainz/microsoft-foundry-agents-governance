# Azure AI Foundry Agents Governance - Design Specifications

## 1. Product Vision
**"Crystal Clear Governance for AI Agents"**
A unified, enterprise-grade dashboard that provides total visibility into the AI Agent supply chain (Project -> Agent -> Model -> Tools). The interface combines the density and utility of Azure Portal with the modern, fluid aesthetics of Windows 11 (Mica/Acrylic materials).

## 2. Design System & Tokens

### 2.1. Color Palette (Dark Mode Default)
*   **Backgrounds**:
    *   `--bg-app`: `#0f1117` (Deep Graphite/Navy)
    *   `--bg-surface`: `rgba(30, 34, 45, 0.6)` (Acrylic Layer)
    *   `--bg-card`: `rgba(255, 255, 255, 0.04)` (Glass Card)
    *   `--bg-card-hover`: `rgba(255, 255, 255, 0.08)`
*   **Accents (Azure Brand)**:
    *   `--accent-primary`: `#0078d4` (Azure Blue)
    *   `--accent-secondary`: `#60cdff` (Light Blue)
    *   `--accent-purple`: `#8a2be2` (Foundry Purple)
*   **Semantic States**:
    *   `--status-success`: `#107c10` / `#57f287`
    *   `--status-warning`: `#fce100` / `#fde047`
    *   `--status-error`: `#c50f1f` / `#f87171`
    *   `--status-info`: `#0078d4` / `#60a5fa`

### 2.2. Typography (Segoe UI Variable)
*   **H1 (Page Title)**: 24px, Semibold, Tracking -0.01em
*   **H2 (Section)**: 18px, Semibold
*   **H3 (Card Title)**: 14px, Semibold, Uppercase, Tracking 0.05em
*   **Body**: 13px/14px, Regular
*   **Monospace**: Consolas / Cascadia Code (for IDs, Logs)

### 2.3. Materials & Effects
*   **Acrylic Blur**: `backdrop-filter: blur(20px) saturate(125%)`
*   **Glass Border**: `border: 1px solid rgba(255, 255, 255, 0.08)`
*   **Shadows**:
    *   `--shadow-card`: `0 4px 24px -1px rgba(0, 0, 0, 0.2)`
    *   `--shadow-glow`: `0 0 15px rgba(96, 205, 255, 0.15)`
*   **Radius**:
    *   `--radius-lg`: `12px` (Cards, Modals)
    *   `--radius-md`: `6px` (Buttons, Inputs)

## 3. Layout Structure

### 3.1. Shell
*   **Left Rail (Sidebar)**: 240px fixed. Collapsible. Acrylic background.
    *   *Items*: Overview, Inventory, Graph, Analytics, Usage, Reliability, Security, Settings.
*   **Top Command Bar**: 60px height. Sticky. Glass background.
    *   *Left*: Breadcrumbs (Subscription > Resource Group).
    *   *Center*: Global Search (Ctrl+K).
    *   *Right*: User Profile, Notifications, Refresh, Time Range.
*   **Main Canvas**: Fluid width. Padding 24px. Scrollable.

## 4. Screen Definitions

### 4.1. Overview (Executive Dashboard)
*   **Header**: Context chips (Region: East US, Env: Prod).
*   **KPI Row**: 5 Cards.
    *   *Total Agents*: Big number + Trend.
    *   *Active Models*: Count.
    *   *Risk Score*: Gauge chart.
    *   *Est. Cost*: Currency + MoM %.
    *   *Incidents*: Sparkline.
*   **Action Center**: "Top 5 Governance Actions" (e.g., "Agent X using deprecated model").
*   **Charts**:
    *   *Model Distribution*: Treemap.
    *   *Usage Heatmap*: Calendar view.

### 4.2. Inventory (Projects & Agents)
*   **Tabs**: Projects | Agents.
*   **Projects View**: Grid of "Glass Cards".
    *   Card content: Project Name, Agent Count, Top Model, Health Badge.
    *   Action: "Drill down".
*   **Agents View**: Data Grid (Table).
    *   Columns: Name, Project, Model, Tools (Badges), Owner, Risk, Last Active.
    *   Filters: Faceted sidebar (Model, Tool, Risk).

### 4.3. Graph Explorer (The Differentiator)
*   **Canvas**: Full screen height.
*   **Nodes**:
    *   *Project*: Square, Blue.
    *   *Agent*: Circle, Purple (Pulse animation if active).
    *   *Model*: Hexagon, Green.
    *   *Tool*: Diamond, Orange.
*   **Interactions**:
    *   *Click*: Opens "Detail Drawer" on right.
    *   *Hover*: Highlights path to root.
*   **Controls**: Zoom, Fit, Layout Toggle (Force/Concentric), Filters (Show only Risky).

### 4.4. Agent Detail Drawer
*   **Slide-over panel** (40% width).
*   **Header**: Agent Name + Status + "Open in Foundry" button.
*   **Tabs**:
    *   *Overview*: Metadata, Owner, Description.
    *   *Configuration*: System Prompt (truncated), Temperature, TopP.
    *   *Tools*: List of enabled tools with config details.
    *   *Telemetry*: Mini charts for Latency/Errors.

## 5. Component Library (Reusable)

*   **`GlassCard`**: Base container with acrylic bg, border, and hover glow.
*   **`StatusBadge`**: Pill shape, dot indicator + label.
*   **`MetricTile`**: Label, Value, Trend Indicator.
*   **`AgentTable`**: Sortable, filterable, row actions.
*   **`FilterSidebar`**: Accordion style filters.

## 6. Proposed Visualizations (Charts)
1.  **Agents by Model** (Donut): Market share of models in your org.
2.  **Tool Adoption** (Bar): Which tools are most popular (Bing vs File Search).
3.  **Token Usage Trend** (Area): Daily token consumption.
4.  **Error Rate by Project** (Heatmap): Identify unstable projects.
5.  **Risk Scatter Plot** (Scatter): X=Usage, Y=Risk Score.
6.  **Latency Distribution** (Histogram): Performance profiling.
7.  **Cost by Agent** (Bar): Top 10 most expensive agents.
8.  **Call Volume** (Line): Requests per minute/hour.
9.  **Compliance Score** (Gauge): % of agents meeting policy.
10. **Dependency Graph** (Network): Visual map of Agent->Model connections.

## 7. Implementation Plan
1.  **Phase 1: Foundation**: Setup CSS variables, Layout Shell, Navigation.
2.  **Phase 2: Inventory**: Implement the Data Grid and Filter logic.
3.  **Phase 3: Graph**: Enhance Cytoscape visualization with new node styles.
4.  **Phase 4: Dashboard**: Build the Overview page with KPI cards and Charts.
