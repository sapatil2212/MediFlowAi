text = open("scratch/patients_export_fn.txt", encoding="utf-8").read()

stack = []
for idx, char in enumerate(text):
    if char == '{':
        line = text[:idx].count('\n') + 1
        col = idx - text[:idx].rfind('\n')
        stack.append(('{', line, col))
    elif char == '}':
        if not stack:
            line = text[:idx].count('\n') + 1
            col = idx - text[:idx].rfind('\n')
            print(f"Extra closing brace '}}' at line {line}, col {col}")
        else:
            stack.pop()

if stack:
    print(f"There are {len(stack)} unclosed opening braces:")
    for brace, line, col in stack:
        print(f"Opening brace '{{' at line {line}, col {col} remains unclosed")
