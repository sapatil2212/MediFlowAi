path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.readlines()

for i, line in enumerate(content):
    if "docerror" in line.lower() and ("div" in line.lower() or "{" in line.lower()):
        print(f"{i+1}: {line.strip()}")
