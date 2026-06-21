import os

files = [
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx",
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
]

for filepath in files:
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
        
    original_start = "filteredPatients.length === 0 ? (() => {"
    target_start = "filteredPatients.length === 0 ? ( (() => {"
    
    original_end = "})())) : ("
    target_end = "})() ) : ("
    
    if original_start in content and original_end in content:
        content = content.replace(original_start, target_start, 1)
        content = content.replace(original_end, target_end, 1)
        
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"Successfully fixed braces in {os.path.basename(filepath)}")
    else:
        print(f"Skipping {os.path.basename(filepath)} - matches not found or already fixed.")
