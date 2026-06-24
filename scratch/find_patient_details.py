filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx"
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines, 1):
    if 'selectedPatient' in line and ('&&' in line or '===' in line or '?' in line or '{' in line) and ('id' not in line) and ('set' not in line):
        print(f"line {idx}: {line.strip()}")
