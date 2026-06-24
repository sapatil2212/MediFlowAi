import os

replacements = [
    ("MediFlow AI", "BookMyTime"),
    ("MediFlowAI", "BookMyTime"),
    ("mediflowai", "bookmytime"),
    ("Mediflow AI", "BookMyTime"),
    ("MediflowAI", "BookMyTime"),
    ("mediflow", "bookmytime"),
    ("Mediflow", "Bookmytime"),
    ("MediFlow", "BookMyTime"),
    ("MEDIFLOW", "BOOKMYTIME")
]

# We will scan src/ and root level javascript/json/configuration files, ignoring standard folders.
ignored_dirs = {".git", "node_modules", "dist", ".vinxi", ".output", ".nitro", "scratch"}
valid_extensions = {".tsx", ".ts", ".js", ".jsx", ".cjs", ".mjs", ".css", ".html", ".json", ".md"}

root_dir = r"c:\Users\swapn\Downloads\HealthSync AI"

modified_count = 0

for root, dirs, files in os.walk(root_dir):
    # Prune ignored directories in-place
    dirs[:] = [d for d in dirs if d not in ignored_dirs]
    
    for file in files:
        ext = os.path.splitext(file)[1].lower()
        if ext not in valid_extensions:
            continue
            
        filepath = os.path.join(root, file)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception:
            # Skip files that can't be decoded (e.g. binaries)
            continue
            
        original_content = content
        for src, dest in replacements:
            content = content.replace(src, dest)
            
        if content != original_content:
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
            modified_count += 1
            print(f"Replaced terms in: {os.path.relpath(filepath, root_dir)}")

print(f"\nCompleted! Replaced terms in {modified_count} files.")
