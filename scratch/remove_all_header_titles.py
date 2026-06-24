import os

def remove_header_title(filepath, name, search_pattern):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    if search_pattern in content:
        # We replace the search_pattern and any trailing newline if there's any spacing
        content = content.replace(search_pattern, "")
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"SUCCESS: Removed header title from {name} dashboard!")
    else:
        # Try with a regex check or a general split check in case of spacing variation
        import re
        # Find <h2 ...> ... </h2>
        h2_pattern = r'\s*<h2 className="text-sm font-bold text-zinc-900 capitalize">\s*\{activeTab === "overview".*?\}\s*</h2>'
        match = re.search(h2_pattern, content)
        if match:
            content = content.replace(match.group(0), "")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"SUCCESS (Regex): Removed header title from {name} dashboard!")
        else:
            print(f"ERROR: Could not find header title pattern in {name} dashboard!")

def main():
    # Mappings
    dashboards = [
        {
            "name": "Gym",
            "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx",
            "pattern": """            <h2 className="text-sm font-bold text-zinc-900 capitalize">
              {activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}
            </h2>"""
        },
        {
            "name": "Education",
            "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
            "pattern": """            <h2 className="text-sm font-bold text-zinc-900 capitalize">
              {activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Students" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}
            </h2>"""
        },
        {
            "name": "Beauty",
            "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
            "pattern": """            <h2 className="text-sm font-bold text-zinc-900 capitalize">
              {activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}
            </h2>"""
        },
        {
            "name": "Professional",
            "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
            "pattern": """            <h2 className="text-sm font-bold text-zinc-900 capitalize">
              {activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}
            </h2>"""
        },
        {
            "name": "Medical",
            "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\medical.tsx",
            "pattern": """            <h2 className="text-sm font-bold text-zinc-900 capitalize">
              {activeTab === "overview" ? "Dashboard Overview" : activeTab.replace("-", " ")}
            </h2>"""
        }
    ]
    
    for db in dashboards:
        remove_header_title(db["path"], db["name"], db["pattern"])

if __name__ == "__main__":
    main()
