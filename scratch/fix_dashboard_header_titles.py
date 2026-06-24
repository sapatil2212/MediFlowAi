def patch_file(filepath, name, replacement):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    target = '{activeTab === "overview" ? "Dashboard Overview" : activeTab.replace("-", " ")}'
    
    if target in content:
        content = content.replace(target, replacement)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"SUCCESS: Patched header title in {name} dashboard!")
    else:
        print(f"ERROR: Could not find target in {name} dashboard!")

def main():
    patch_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx",
        "Gym",
        '{activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}'
    )
    patch_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
        "Education",
        '{activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Students" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}'
    )
    patch_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
        "Beauty",
        '{activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}'
    )
    patch_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
        "Professional",
        '{activeTab === "overview" ? "Dashboard Overview" : activeTab === "patients" ? "Clients" : activeTab === "appointments" ? "Bookings List" : activeTab.replace("-", " ")}'
    )

if __name__ == "__main__":
    main()
