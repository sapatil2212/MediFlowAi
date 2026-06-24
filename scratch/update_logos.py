import os
import re

dashboards_dir = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards"
files = ["gym.tsx", "beauty.tsx", "professional.tsx", "education.tsx", "medical.tsx"]

# Regex pattern for the logo inner block
# It matches:
# 1) The HeartPulse icon container div (with optional animate-pulse)
# 2) The text wrapper div containing "MediFlow AI" and the OS version text
pattern_inner = re.compile(
    r'<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-brand-light shadow-sm">\s*'
    r'<HeartPulse className="h-4 w-4 text-white(?: animate-pulse)?" />\s*'
    r'</div>\s*'
    r'<div>\s*'
    r'<span className="text-sm font-bold tracking-tight block leading-none">\s*'
    r'MediFlow AI\s*'
    r'</span>\s*'
    r'<span className="text-\[9px\] font-semibold text-zinc-400">\s*'
    r'(?:CLINICAL|FITNESS|ACADEMY|BEAUTY) OS v1\.2\s*'
    r'</span>\s*'
    r'</div>',
    re.MULTILINE
)

replacement_img = '<img src={bmtLogo} alt="BookMyTime Logo" className="h-10 w-auto object-contain" />'

for filename in files:
    filepath = os.path.join(dashboards_dir, filename)
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    
    print(f"Processing {filename}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. Add the import statement if not already present
    if "import bmtLogo from" not in content:
        # Insert import bmtLogo from "../../assets/bmt-logo.png"; right after the tanstack route import
        import_line = 'import bmtLogo from "../../assets/bmt-logo.png";\n'
        
        # Find where to insert. Let's find createFileRoute
        match_import = re.search(r'import\s+\{[^}]*createFileRoute[^}]*\}\s+from\s+["\']@tanstack/react-router["\'];', content)
        if match_import:
            insert_pos = match_import.end()
            content = content[:insert_pos] + "\n" + import_line + content[insert_pos:]
            print(f"  Added import to {filename}")
        else:
            # Fallback to the top of the file
            content = import_line + content
            print(f"  Added import to top of {filename}")
            
    # 2. Replace the inner logo blocks
    matches = pattern_inner.findall(content)
    print(f"  Found {len(matches)} matches in {filename}")
    
    new_content, count = pattern_inner.subn(replacement_img, content)
    print(f"  Replaced {count} instances in {filename}")
    
    if count > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"  Successfully wrote {filename}")
    else:
        print(f"  No changes written for {filename}")
