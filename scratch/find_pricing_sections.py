path = r"c:\Users\swapn\Downloads\HealthSync AI\src\components\site\sections.tsx"
try:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # search for plan names or prices
    import re
    matches = re.findall(r"(?:name|price|title|cost|plan):\s*['\"].*?['\"]", content, re.IGNORECASE)
    print("Matches:")
    for m in matches[:30]:
        print(m)
        
    # print lines containing "999" or "Solo" or "plan"
    lines = content.splitlines()
    for i, line in enumerate(lines):
        if "999" in line or "Solo" in line or "price" in line.lower() or "plan" in line.lower():
            if any(term in line.lower() for term in ["reception", "doctor", "month", "limit", "$"]):
                print(f"{i+1}: {line.strip()}")
except Exception as e:
    print("Error:", e)
