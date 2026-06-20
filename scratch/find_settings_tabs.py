path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.readlines()

for i, line in enumerate(content):
    if "settingsSubTab" in line or "Manage Users" in line or "manage-users" in line or "users" in line.lower():
        if "reception" in line or "doctor" in line or "sub" in line or "tab" in line:
            print(f"{i+1}: {line.strip()}")
