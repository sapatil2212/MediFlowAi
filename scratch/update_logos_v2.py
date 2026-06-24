import os
import re

dashboards_dir = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards"
files = ["gym.tsx", "beauty.tsx", "professional.tsx", "education.tsx", "medical.tsx"]

# 1. Pattern to match mobile menu logo block
# Before:
#                   <div className="flex items-center gap-2.5">
#                     <img src={bmtLogo} alt="BookMyTime Logo" className="h-10 w-auto object-contain" />
#                   </div>
pattern_mobile = re.compile(
    r'<div className="flex items-center gap-2\.5">\s*'
    r'<img src=\{bmtLogo\} alt="BookMyTime Logo" className="h-10 w-auto object-contain" />\s*'
    r'</div>',
    re.MULTILINE
)

replacement_mobile = (
    '<div className="flex items-center px-4">\n'
    '                    <img src={bmtLogo} alt="BookMyTime Logo" className="h-14 w-auto object-contain" />\n'
    '                  </div>'
)

# 2. Pattern to match desktop sidebar logo block
# Before:
#           {/* Brand Logo Header */}
#           <div className="flex items-center gap-2.5 px-2">
#             <img src={bmtLogo} alt="BookMyTime Logo" className="h-10 w-auto object-contain" />
#           </div>
pattern_desktop = re.compile(
    r'{/\* Brand Logo Header \*/}\s*'
    r'<div className="flex items-center gap-2\.5 px-2">\s*'
    r'<img src=\{bmtLogo\} alt="BookMyTime Logo" className="h-10 w-auto object-contain" />\s*'
    r'</div>',
    re.MULTILINE
)

replacement_desktop = (
    '{/* Brand Logo Header */}\n'
    '          <div className="flex items-center px-4">\n'
    '            <img src={bmtLogo} alt="BookMyTime Logo" className="h-14 w-auto object-contain" />\n'
    '          </div>'
)

for filename in files:
    filepath = os.path.join(dashboards_dir, filename)
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    
    print(f"Processing {filename}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replace mobile matches
    content, count_m = pattern_mobile.subn(replacement_mobile, content)
    print(f"  Replaced {count_m} mobile instances")
    
    # Replace desktop matches
    content, count_d = pattern_desktop.subn(replacement_desktop, content)
    print(f"  Replaced {count_d} desktop instances")
    
    if count_m > 0 or count_d > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"  Successfully wrote {filename}")
    else:
        print(f"  No changes for {filename}")
