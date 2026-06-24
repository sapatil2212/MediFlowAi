with open(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "Patients" in line:
        print(f"Line {idx+1}: {line.strip()}")
