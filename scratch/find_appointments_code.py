import re

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx"
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines, 1):
    if 'activeTab === "appointments"' in line:
        print(f"Tab matching: line {idx}: {line.strip()}")
    if 'appointments.map' in line:
        print(f"Map loop: line {idx}: {line.strip()}")
    if 'Edit3' in line or 'Trash2' in line or 'Eye' in line:
        if 'button' in line or 'onClick' in line or 'Icon' in line or 'className' in line:
            print(f"Icon action: line {idx}: {line.strip()}")
