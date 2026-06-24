import os

plans_replacements = {
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx": [
        ("1 doctor dashboard", "1 trainer dashboard"),
        ("Up to 5 doctors", "Up to 5 trainers"),
        ("patient records", "client records"),
        ("AI prescriptions", "AI workout plans")
    ],
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx": [
        ("1 doctor dashboard", "1 stylist dashboard"),
        ("Up to 5 doctors", "Up to 5 stylists"),
        ("patient records", "client records"),
        ("AI prescriptions", "AI service plans")
    ],
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx": [
        ("1 doctor dashboard", "1 advisor dashboard"),
        ("Up to 5 doctors", "Up to 5 advisors"),
        ("patient records", "client records"),
        ("AI prescriptions", "AI action plans")
    ],
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx": [
        ("1 doctor dashboard", "1 teacher dashboard"),
        ("Up to 5 doctors", "Up to 5 teachers"),
        ("patient records", "student records"),
        ("AI prescriptions", "AI study plans")
    ]
}

for filepath, replacements in plans_replacements.items():
    if not os.path.exists(filepath):
        print(f"File {filepath} not found!")
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    for src, dest in replacements:
        # Replaces both exact case and lowercase variations
        content = content.replace(src, dest)
        content = content.replace(src.capitalize(), dest.capitalize())
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Customized pricing plans in {os.path.basename(filepath)}")

print("All pricing plans localized successfully!")
