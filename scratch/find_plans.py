path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\pricing.tsx"
try:
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    print(content[:1500])
except Exception as e:
    print("Error:", e)
