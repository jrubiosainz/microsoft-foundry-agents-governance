import os
import requests
from azure.identity import DefaultAzureCredential

def debug_resources():
    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default").token
    
    # Get first subscription
    sub_url = "https://management.azure.com/subscriptions?api-version=2022-12-01"
    headers = {"Authorization": f"Bearer {token}"}
    subs = requests.get(sub_url, headers=headers).json().get("value", [])
    
    if not subs:
        print("No subscriptions found.")
        return

    sub_id = subs[0]["subscriptionId"]
    print(f"Using Subscription: {sub_id}")

    # Fetch Projects
    ml_url = f"https://management.azure.com/subscriptions/{sub_id}/providers/Microsoft.MachineLearningServices/workspaces?api-version=2023-08-01-preview"
    
    print(f"Fetching Projects from: {ml_url}")
    resp = requests.get(ml_url, headers=headers)
    items = resp.json().get("value", [])
    
    for item in items:
        if item.get("kind", "").lower() == "project":
            print(f"\nProject: {item['name']}")
            print(f"ID: {item['id']}")
            props = item.get("properties", {})
            print("Properties keys:", props.keys())
            print(f"Discovery URL: {props.get('discoveryUrl')}")
            print(f"MLFlow Tracking URI: {props.get('mlFlowTrackingUri')}")
            # Check for other potential endpoints
            for k, v in props.items():
                if "url" in k.lower() or "endpoint" in k.lower() or "uri" in k.lower():
                    print(f"  {k}: {v}")

if __name__ == "__main__":
    debug_resources()
