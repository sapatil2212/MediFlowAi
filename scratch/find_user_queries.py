import os

path = r"c:\Users\swapn\Downloads\HealthSync AI"
for root, dirs, files in os.walk(path):
    if "node_modules" in root or ".git" in root or ".gemini" in root:
        continue
    for file in files:
        if file.endswith((".ts", ".tsx", ".js", ".jsx")):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read()
                if "from user where" in content.lower():
                    # print lines around it
                    lines = content.splitlines()
                    for i, line in enumerate(lines):
                        if "from user where" in line.lower():
                            print(f"{file}:{i+1}: {line.strip()}")
            except Exception:
                pass
