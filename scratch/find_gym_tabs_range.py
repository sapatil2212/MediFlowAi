with open(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx", "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "TAB: CLIENT RECORDS (PATIENTS)" in line:
        print(f"Start patients: Line {idx+1}")
    if "TAB: BOOKINGS LIST (APPOINTMENTS)" in line:
        print(f"Start appointments: Line {idx+1}")
    if "TAB: SETTINGS" in line:
        # Show all occurrences
        print(f"TAB: SETTINGS: Line {idx+1}")
