def find_location(filepath, name):
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    found = False
    for idx, line in enumerate(lines):
        if "filteredPatients.length === 0" in line:
            print(f"\n=== {name} Line {idx+1} ===")
            for i in range(max(0, idx-2), min(len(lines), idx+10)):
                print(f"{i+1}: {lines[i].strip()}")
            found = True
    if not found:
        print(f"ERROR: Could not find in {name}")

def main():
    find_location(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx", "Gym")
    find_location(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx", "Education")
    find_location(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx", "Beauty")
    find_location(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx", "Professional")

if __name__ == "__main__":
    main()
