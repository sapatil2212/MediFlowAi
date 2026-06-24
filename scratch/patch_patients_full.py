import os
import re

dashboard_path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"
states_path = r"c:\Users\swapn\Downloads\HealthSync AI\scratch\patients_states.txt"
export_path = r"c:\Users\swapn\Downloads\HealthSync AI\scratch\patients_export_fn.txt"
patch_layout_path = r"c:\Users\swapn\Downloads\HealthSync AI\scratch\patch_patients.py"

print("Reading dashboard.tsx...")
with open(dashboard_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. State Variables Injection
print("Injecting state variables...")
with open(states_path, "r", encoding="utf-8") as f:
    states_content = f.read().strip()

state_target = "  const [selectedPatient, setSelectedPatient] = useState<any | null>(null);"
if state_target not in content:
    print("Error: Could not find state_target in dashboard.tsx")
    exit(1)

content = content.replace(state_target, states_content, 1)

# 2. Export Function Injection
print("Injecting handleExportPatients function...")
with open(export_path, "r", encoding="utf-8") as f:
    export_content = f.read().strip()

fn_target = "  const handleStartScribe = () => {"
if fn_target not in content:
    print("Error: Could not find handleStartScribe in dashboard.tsx")
    exit(1)

content = content.replace(fn_target, export_content + "\n\n  const handleStartScribe = () => {", 1)

# 3. Layout Rewrite (reusing the new_patients_block from patch_patients.py)
print("Extracting layout from patch_patients.py...")
with open(patch_layout_path, "r", encoding="utf-8") as f:
    patch_py = f.read()

# Parse the new_patients_block raw string from patch_patients.py
# It starts with new_patients_block = """ and ends with """
match = re.search(r'new_patients_block\s*=\s*"""(.*?)"""', patch_py, re.DOTALL)
if not match:
    print("Error: Could not extract new_patients_block from patch_patients.py")
    exit(1)

new_patients_block = match.group(1)

# Fix intermediate closing div to avoid tag mismatch
# Replace both CRLF and LF variations
new_patients_block = new_patients_block.replace('                  })()}\r\n                </div>', '                  })()}')
new_patients_block = new_patients_block.replace('                  })()}\n                </div>', '                  })()}')

# Locate activeTab === "patients" and the following block in the modified content
print("Replacing Patient Records Tab layout...")
start_str = '            {activeTab === "patients" && ('
end_str = '            {activeTab === "analytics" && ('

start_idx = content.find(start_str)
if start_idx == -1:
    print("Error: Start block not found in content")
    exit(1)

end_idx = content.find(end_str)
if end_idx == -1:
    print("Error: End block not found in content")
    exit(1)

search_block = content[start_idx:end_idx]
last_bracket_idx = search_block.rfind('            )}')
if last_bracket_idx == -1:
    print("Error: Last closing bracket not found")
    exit(1)

absolute_end_idx = start_idx + last_bracket_idx + 14

final_content = content[:start_idx] + new_patients_block + content[absolute_end_idx:]

with open(dashboard_path, "w", encoding="utf-8") as f:
    f.write(final_content)

print("Patient Records layout alignment patched successfully!")
