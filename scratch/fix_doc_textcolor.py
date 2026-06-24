import os
import re

path = r"src/routes/dashboard.tsx"
print("Reading dashboard.tsx...")
content = open(path, encoding="utf-8").read()

# 1. Replace the first 3
print("Replacing array assignment patterns...")
content = content.replace("doc.textColor = [12, 114, 114];", "doc.setTextColor(12, 114, 114);")
content = content.replace("doc.textColor = [74, 85, 104];", "doc.setTextColor(74, 85, 104);")
content = content.replace("doc.textColor = [113, 128, 150];", "doc.setTextColor(113, 128, 150);")

# 2. Replace the remaining comma operator patterns
print("Replacing comma operator patterns...")
pattern = r"doc\.textColor\s*=\s*([a-zA-Z_0-9]+)\[0\],\s*\1\[1\],\s*\1\[2\];"
replacement = r"doc.setTextColor(\1[0], \1[1], \1[2]);"
content = re.sub(pattern, replacement, content)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Pre-existing doc.textColor errors fixed successfully!")
