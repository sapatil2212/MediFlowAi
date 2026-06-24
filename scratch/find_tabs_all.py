import re

def find_in_file(filepath, name):
    with open(filepath, "r", encoding="utf-8") as f:
        lines = f.readlines()
    
    print(f"\n=== {name} ===")
    for idx, line in enumerate(lines):
        if 'activeTab ===' in line or 'activeTab ==' in line:
            if 'settings' in line or 'calendar' in line or 'patients' in line or 'appointments' in line or 'overview' in line:
                print(f"Line {idx+1}: {line.strip()}")

def main():
    find_in_file(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx", "Education")
    find_in_file(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx", "Beauty")
    find_in_file(r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx", "Professional")

if __name__ == "__main__":
    main()
