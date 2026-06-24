import os
import re

dashboards_dir = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards"
files = ["gym.tsx", "medical.tsx", "beauty.tsx", "professional.tsx", "education.tsx"]

for filename in files:
    filepath = os.path.join(dashboards_dir, filename)
    if not os.path.exists(filepath):
        print(f"Skipping {filename} as it does not exist")
        continue

    print(f"Fixing text color in {filename}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace constant arrays
    content = content.replace("doc.textColor = [12, 114, 114];", "doc.setTextColor(12, 114, 114);")
    content = content.replace("doc.textColor = [74, 85, 104];", "doc.setTextColor(74, 85, 104);")
    content = content.replace("doc.textColor = [113, 128, 150];", "doc.setTextColor(113, 128, 150);")

    # 2. Replace comma operator color arrays (e.g., doc.textColor = primaryColor[0], primaryColor[1], primaryColor[2];)
    pattern = r"doc\.textColor\s*=\s*([a-zA-Z_0-9]+)\[0\],\s*\1\[1\],\s*\1\[2\];"
    replacement = r"doc.setTextColor(\1[0], \1[1], \1[2]);"
    content, count = re.subn(pattern, replacement, content)
    print(f"Fixed {count} dynamic textColor usages in {filename}")

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

print("All dashboards fixed.")
