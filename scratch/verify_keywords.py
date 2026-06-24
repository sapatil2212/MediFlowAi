def check_file(filepath, name, forbidden, required):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    print(f"=== {name} ===")
    for word in forbidden:
        count = content.lower().count(word.lower())
        if count > 0:
            print(f"  WARNING: Found '{word}' {count} times")
    for word in required:
        count = content.lower().count(word.lower())
        if count == 0:
            print(f"  WARNING: Missing required word '{word}'")
        else:
            print(f"  Info: Found required word '{word}' {count} times")

def main():
    check_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
        "Education",
        ["gym", "client registry", "workout plans", "client chart"],
        ["student registry", "academic sessions", "study plans", "student chart"]
    )
    check_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
        "Beauty",
        ["gym sessions", "workout plans", "student registry"],
        ["salon appointments", "beauty preferences", "client registry"]
    )
    check_file(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
        "Professional",
        ["gym sessions", "workout plans", "student registry"],
        ["consulting sessions", "strategy plans", "client registry"]
    )

if __name__ == "__main__":
    main()
