with open(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "Patients" in line and ("h1" in line.lower() or "h2" in line.lower() or "span" in line.lower() or "text-" in line):
        print(f"Line {idx+1}: {line.strip()}")
