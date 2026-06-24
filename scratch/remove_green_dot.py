import re

def remove_green_dot(filepath, name):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Target 1: The green dot and the Session Live badge
    target_pattern = r'\s*<span className="h-1\.5 w-1\.5 rounded-full bg-emerald-500 animate-pulse" />\s*<span className="text-\[10px\] font-bold text-emerald-600 px-2\.5 py-0\.5 rounded-full bg-emerald-50 border border-emerald-100 hidden xs:inline-block">\s*Session Live\s*</span>'
    
    # Target 2: Only the green dot span if Target 1 is not formatted exactly that way
    single_dot_pattern = r'\s*<span className="h-1\.5 w-1\.5 rounded-full bg-emerald-500 animate-pulse" />'
    
    modified = False
    if re.search(target_pattern, content):
        content = re.sub(target_pattern, "", content)
        modified = True
        print(f"SUCCESS: Removed both green dot and Session Live badge in {name}!")
    elif re.search(single_dot_pattern, content):
        content = re.sub(single_dot_pattern, "", content)
        modified = True
        print(f"SUCCESS: Removed only the green dot span in {name}!")
    
    if modified:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
    else:
        print(f"ERROR: Could not find green dot pattern in {name}!")

def main():
    dashboards = [
        {"name": "Gym", "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx"},
        {"name": "Education", "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx"},
        {"name": "Beauty", "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx"},
        {"name": "Professional", "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx"},
        {"name": "Medical", "path": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\medical.tsx"}
    ]
    for db in dashboards:
        remove_green_dot(db["path"], db["name"])

if __name__ == "__main__":
    main()
