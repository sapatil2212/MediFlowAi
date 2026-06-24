import os
import re

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replaces the Consult button under {/* Consultation link */}
new_content, count = re.subn(
    r'\s*\{\/\*\s*Consultation link\s*\*\/\}[\s\S]*?<\/button>',
    '',
    content
)

if count > 0:
    content = new_content
    print(f"SUCCESS: Removed {count} Consultation link button(s)")
else:
    print("WARNING: Consultation link button not found")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)

print("Modification complete.")
