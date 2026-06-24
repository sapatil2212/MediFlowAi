with open(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "activeTab" in line and ("h1" in line.lower() or "h2" in line.lower() or "span" in line.lower() or "font-bold" in line.lower() or "text-" in line.lower()):
        # Print the line and 3 lines before/after
        print(f"\n--- Line {idx+1} ---")
        for i in range(max(0, idx-3), min(len(lines), idx+4)):
            print(f"{i+1}: {lines[i].strip()}")
