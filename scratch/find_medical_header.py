with open(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\medical.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "activeTab.replace" in line:
        print(f"Line {idx+1}: {line.strip()}")
