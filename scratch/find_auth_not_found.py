path = r"c:\Users\swapn\Downloads\HealthSync AI\src\lib\auth.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.readlines()

for i, line in enumerate(content):
    if "not found" in line.lower() or "blocked" in line.lower() or "user not" in line.lower():
        print(f"{i+1}: {line.strip()}")
