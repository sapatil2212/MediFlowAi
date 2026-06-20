path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.readlines()

for i, line in enumerate(content):
    if "doc" in line.lower() and "error" in line.lower():
        if "set" in line.lower() or "div" in line.lower() or "p" in line.lower():
            print(f"{i+1}: {line.strip()}")
