import os
import requests
import json
from azure.identity import DefaultAzureCredential
from typing import List, Dict, Any, Optional

class FoundryClient:
    def __init__(self, project_endpoint: Optional[str] = None):
        self.project_endpoint = project_endpoint or os.getenv("PROJECT_ENDPOINT")
        # Allow initialization without endpoint for resource listing
        self.credential = DefaultAzureCredential()
        self.api_version = "2025-11-15-preview"

    def _get_token(self) -> str:
        return self.credential.get_token("https://ai.azure.com/.default").token

    def _get_mgmt_token(self) -> str:
        return self.credential.get_token("https://management.azure.com/.default").token

    def get_subscriptions(self) -> List[Dict[str, Any]]:
        url = "https://management.azure.com/subscriptions?api-version=2022-12-01"
        try:
            token = self._get_mgmt_token()
            headers = {"Authorization": f"Bearer {token}"}
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json().get("value", [])
        except Exception as e:
            print(f"Error fetching subscriptions: {e}")
            return []

    def get_foundry_resources(self, subscription_id: str) -> Dict[str, List[Dict[str, Any]]]:
        # 1. Fetch Cognitive Services Accounts (The "Hubs")
        # Using 2025-06-01 to ensure 'defaultProject' property is returned as per user requirement
        cog_url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.CognitiveServices/accounts?api-version=2025-06-01"
        
        # 2. Fetch ML Workspaces (The "Projects")
        ml_url = f"https://management.azure.com/subscriptions/{subscription_id}/providers/Microsoft.MachineLearningServices/workspaces?api-version=2023-08-01-preview"
        
        hubs = []
        projects = []
        
        try:
            token = self._get_mgmt_token()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Fetch Hubs (Cognitive Services)
            hub_endpoints = {}
            try:
                resp_cog = requests.get(cog_url, headers=headers, timeout=30)
                resp_cog.raise_for_status()
                cog_items = resp_cog.json().get("value", [])
                for item in cog_items:
                    # Only list resources of kind 'AIServices' as requested
                    kind = item.get("kind", "").lower()
                    if kind != "aiservices":
                        continue

                    props = item.get("properties", {})
                    endpoint = props.get("endpoint")
                    default_project = props.get("defaultProject")
                    hub_endpoints[item["id"].lower()] = endpoint
                    hubs.append({
                        "id": item["id"],
                        "name": item["name"],
                        "location": item["location"],
                        "resourceGroup": item["id"].split("/")[4],
                        "kind": item.get("kind", "").lower(),
                        "endpoint": endpoint,
                        "type": "Microsoft.CognitiveServices/accounts",
                        "defaultProject": default_project
                    })
            except Exception as e:
                print(f"Error fetching CogServices: {e}")

            # Fetch Projects (ML Workspaces)
            try:
                resp_ml = requests.get(ml_url, headers=headers, timeout=30)
                resp_ml.raise_for_status()
                ml_items = resp_ml.json().get("value", [])
                for item in ml_items:
                    if item.get("kind", "").lower() == "project":
                        props = item.get("properties", {})
                        hub_id = props.get("hubResourceId")
                        
                        # Construct the correct Agents API endpoint based on User's instruction
                        # Format: https://{hub_name}.services.ai.azure.com/api/projects/{project_name}
                        
                        endpoint = None
                        if hub_id:
                            hub_name = hub_id.split("/")[-1]
                            # Use services.ai.azure.com as requested
                            endpoint = f"https://{hub_name}.services.ai.azure.com/api/projects/{item['name']}"
                        
                        if not endpoint:
                             # Fallback to discoveryUrl
                             endpoint = props.get("discoveryUrl")
                             if not endpoint:
                                 endpoint = f"https://{item['name']}.{item['location']}.api.azureml.ms"
                        
                        projects.append({
                            "id": item["id"],
                            "name": item["name"],
                            "location": item["location"],
                            "resourceGroup": item["id"].split("/")[4],
                            "kind": "project",
                            "endpoint": endpoint,
                            "hubId": hub_id
                        })
            except Exception as e:
                print(f"Error fetching ML Workspaces: {e}")

            # 3. Fetch Cognitive Services Projects (Child resources of Hubs)
            # These are Microsoft.CognitiveServices/accounts/projects
            # We need to iterate over hubs to find them, or use a subscription-level list if available.
            # Subscription-level list for sub-resources is not standard, so we iterate hubs.
            
            for hub in hubs:
                try:
                    # List projects under this hub
                    # API Version for projects: 2024-10-01 or similar
                    proj_url = f"https://management.azure.com{hub['id']}/projects?api-version=2024-10-01"
                    resp_proj = requests.get(proj_url, headers=headers, timeout=10)
                    if resp_proj.status_code == 200:
                        sub_projects = resp_proj.json().get("value", [])
                        for sp in sub_projects:
                            # Construct endpoint for these projects
                            # Usually: https://{hub_name}.services.ai.azure.com/api/projects/{project_name}
                            hub_name = hub["name"]
                            project_name = sp["name"]
                            endpoint = f"https://{hub_name}.services.ai.azure.com/api/projects/{project_name}"
                            
                            projects.append({
                                "id": sp["id"],
                                "name": sp["name"],
                                "location": sp["location"],
                                "resourceGroup": sp["id"].split("/")[4],
                                "kind": "project",
                                "endpoint": endpoint,
                                "hubId": hub["id"]
                            })
                except Exception as e:
                    print(f"Error fetching projects for hub {hub['name']}: {e}")

            # Add "Self-Projects" for Hubs that might be standalone Foundry projects
            existing_project_ids = set(p["id"] for p in projects)
            
            for hub in hubs:
                if hub["id"] in existing_project_ids:
                    continue
                
                # Construct the endpoint for the Hub acting as a Project
                hub_name = hub["name"]
                # Use defaultProject if available, otherwise fallback to hub name
                project_name = hub.get("defaultProject") or hub_name
                
                endpoint = f"https://{hub_name}.services.ai.azure.com/api/projects/{project_name}"
                
                projects.append({
                    "id": hub["id"],
                    "name": hub["name"],
                    "location": hub["location"],
                    "resourceGroup": hub["resourceGroup"],
                    "kind": "project",
                    "endpoint": endpoint,
                    "hubId": hub["id"] # Link to itself so it appears under the Hub in UI
                })

            return {"hubs": hubs, "projects": projects}
            
        except Exception as e:
            print(f"Error in get_foundry_resources: {e}")
            return {"hubs": [], "projects": []}

    def get_role_assignments(self, resource_id: str) -> List[Dict[str, Any]]:
        url = f"https://management.azure.com{resource_id}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01"
        try:
            token = self._get_mgmt_token()
            headers = {"Authorization": f"Bearer {token}"}
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            return response.json().get("value", [])
        except Exception as e:
            print(f"Error fetching role assignments for {resource_id}: {e}")
            return []

    def get_agents(self, project_id: Optional[str] = None) -> List[Dict[str, Any]]:
        # If the endpoint already has /api/projects/, we append /agents
        # The user example: https://.../api/projects/{project}/agents
        
        if "/api/projects/" in self.project_endpoint:
             url = f"{self.project_endpoint.rstrip('/')}/agents"
        else:
             # Fallback for old style endpoints
             url = f"{self.project_endpoint.rstrip('/')}/agents"
             
        print(f"Fetching agents from: {url}") # Debug log
        params = {
            "api-version": self.api_version,
            "limit": 100
        }
        
        # Fetch Access Info if project_id is provided
        access_count = 0
        role_assignments = []
        
        if project_id:
            # 1. Access Control
            role_assignments = self.get_role_assignments(project_id)
            unique_principals = set(r["properties"]["principalId"] for r in role_assignments)
            access_count = len(unique_principals)

        try:
            token = self._get_token()
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }

            response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            items = data.get("value") or data.get("data") or []
            
            full_agents = []
            for item in items:
                agent_id = item.get('id')
                full_agent = item
                if agent_id:
                    details = self.get_agent_details(agent_id, headers)
                    if details:
                        full_agent = details
                
                # Parse and inject access info
                parsed = self.parse_agent_graph_data(full_agent)
                parsed["accessCount"] = access_count
                parsed["projectId"] = project_id # Store for detailed view
                
                full_agents.append(parsed)
            
            return full_agents

        except Exception as e:
            print(f"Error fetching agents: {e}")
            return []

    def get_agent_details(self, agent_id: str, headers: Dict[str, str]) -> Optional[Dict[str, Any]]:
        try:
            url = f"{self.project_endpoint.rstrip('/')}/agents/{agent_id}"
            params = {"api-version": self.api_version}
            response = requests.get(url, params=params, headers=headers, timeout=10)
            if response.status_code == 200:
                return response.json()
        except Exception:
            pass
        return None

    def parse_agent_graph_data(self, agent: Dict[str, Any]) -> Dict[str, Any]:
        """
        Parses agent data into a structure suitable for graph visualization.
        Returns:
            {
                "id": str,
                "name": str,
                "model": str,
                "tools": List[Dict],
                "resources": List[Dict]
            }
        """
        # Extract details from 'versions' -> 'latest' if available
        latest_version = agent.get('versions', {}).get('latest', {})
        definition = latest_version.get('definition', {})
        
        # Fallback
        name = agent.get('name', 'Unknown Agent')
        agent_id = agent.get('id', 'unknown')
        model = definition.get('model') or agent.get('model') or "Unknown Model"
        
        tools_data = []
        raw_tools = definition.get("tools") or agent.get("tools", [])
        
        # Get resources map to link with tools (e.g. file_search -> vector_store)
        raw_resources = definition.get("tool_resources") or agent.get("resources", {})

        for t in raw_tools:
            t_type = t.get('type', 'unknown')
            tool_info = {"type": t_type}
            if "name" in t:
                tool_info["name"] = t["name"]
            
            # Connection info
            if "connection_id" in t:
                tool_info["connection"] = t["connection_id"].split('/')[-1]
            
            # --- Specific Tool Logic ---
            
            # 1. MCP Tool
            if t_type == "mcp":
                # Try to find server_label or project_connection_id
                if "server_label" in t:
                    tool_info["connection"] = t["server_label"]
                elif "project_connection_id" in t:
                    tool_info["connection"] = t["project_connection_id"]
                elif "server_url" in t:
                    tool_info["connection"] = t["server_url"]

            # 2. File Search
            elif t_type == "file_search":
                # Check if there is a vector store associated in resources
                fs_resources = raw_resources.get("file_search", {})
                vs_ids = fs_resources.get("vector_store_ids", [])
                if vs_ids:
                    # Display the first vector store ID
                    tool_info["connection"] = f"VS: {vs_ids[0]}"

            # 3. Memory Search (Bing Grounding, etc.)
            elif "memory" in t_type or "search" in t_type:
                 # Check resources for memory stores
                 # Sometimes memory config is in the tool definition itself or resources
                 # Try to find memory_store_name in tool definition first
                 if "memory_store_name" in t:
                     tool_info["connection"] = t["memory_store_name"]
                 else:
                     # Check resources
                     mem_resources = raw_resources.get(t_type, {})
                     if not mem_resources and "memory_search" in raw_resources:
                         mem_resources = raw_resources["memory_search"]
                     
                     if isinstance(mem_resources, dict):
                         if "memory_store_name" in mem_resources:
                             tool_info["connection"] = mem_resources["memory_store_name"]

            # 4. Azure AI Search / Cognitive Search
            if "azure_ai_search" in t_type or "cognitive_search" in t_type:
                 if "index_name" in t:
                     tool_info["connection"] = f"Index: {t['index_name']}"

            # Other resource IDs (fallback)
            for k, v in t.items():
                if k not in ["type", "name", "connection_id", "server_label", "server_url", "project_connection_id"] and isinstance(v, str) and "/subscriptions/" in v:
                     tool_info["resource_id"] = v.split('/')[-1]
            
            tools_data.append(tool_info)

        resources_data = []
        if raw_resources:
             for k, v in raw_resources.items():
                # Skip file_search here if we handled it in tools to avoid duplication, 
                # or keep it if we want to show it as a separate resource node.
                # Let's keep it for completeness but maybe format it better.
                if isinstance(v, dict):
                    for sub_k, sub_v in v.items():
                         resources_data.append({"type": k, "detail": f"{sub_k}: {sub_v}"})
                else:
                    resources_data.append({"type": k, "detail": str(v)})

        # Extract timestamps
        created_at = agent.get('created_at')
        # Use updated_at as proxy for last used if explicit last_used not found
        last_used_at = agent.get('last_run_at') or agent.get('updated_at')

        return {
            "id": agent_id,
            "name": name,
            "model": model,
            "tools": tools_data,
            "resources": resources_data
        }
