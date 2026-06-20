path = r"c:\Users\swapn\Downloads\HealthSync AI\src\lib\auth.ts"
with open(path, "r", encoding="utf-8") as f:
    content = f.readlines()

in_fn = False
for i, line in enumerate(content):
    if "export const getDashboardStats" in line or "export const getAnalytics" in line:
        in_fn = True
    if in_fn:
        print(f"{i+1}: {line.strip()}")
        if "});" in line and not "method:" in line and not "validator" in line:
            in_fn = False
