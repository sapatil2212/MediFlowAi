path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

target = '                            <button type="button"\n                              onClick={async () => { if (!confirm("Delete account for " + su.name + "?")) return; await deleteSubUserServerFn({ data: su.id }); setSubUsers(prev => prev.filter(s => s.id !== su.id)); }}\n                              className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[9px] font-bold text-red-500 hover:bg-red-100 cursor-pointer">\n                              <Trash2 className="h-2.5 w-2.5" /> Delete\n                            </button>'

# Let's search with regex or search by standard sub-string to be extremely precise
marker = 'onClick={async () => { if (!confirm("Delete account for " + su.name + "?")) return; await deleteSubUserServerFn({ data: su.id }); setSubUsers(prev => prev.filter(s => s.id !== su.id)); }}'

if marker in content:
    print("Found marker!")
    # Find the surrounding lines of the button block
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        if marker in line:
            print(f"Marker found at line {idx+1}")
            # Replace the block
            # line idx is onClick
            # line idx-1 is <button...
            # line idx+1 is className...
            # line idx+2 is <Trash...
            # line idx+3 is </button>
            # Let's verify and replace
            lines[idx-1] = '                             <button type="button"'
            lines[idx]   = '                               onClick={() => setSubUserToDelete(su)}'
            lines[idx+1] = '                               className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[9px] font-bold text-red-500 hover:bg-red-100 cursor-pointer">'
            lines[idx+2] = '                               <Trash2 className="h-2.5 w-2.5" /> Delete'
            lines[idx+3] = '                             </button>'
            
            new_content = "\n".join(lines) + "\n"
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_content)
            print("Successfully replaced delete button handler!")
            break
else:
    print("Marker NOT found!")
