import os

path = r"c:\Users\swapn\Downloads\HealthSync AI"
for root, dirs, files in os.walk(path):
    # Skip node_modules and .git
    if "node_modules" in root or ".git" in root or ".gemini" in root:
        continue
    for file in files:
        if file.endswith((".ts", ".tsx", ".js", ".jsx", ".json")):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                if "user not found" in content.lower():
                    print(f"Found in {filepath}")
            except Exception:
                pass
