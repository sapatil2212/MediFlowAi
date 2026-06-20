path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"

with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Target select block segment to replace:
target_select = """                                <select
                                  value={docDeptId}
                                  onChange={(e) => setDocDeptId(e.target.value)}
                                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                                  ))}
                                </select>"""

correct_select = """                                <select
                                  value={docDeptId}
                                  onChange={(e) => setDocDeptId(e.target.value)}
                                  required
                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all cursor-pointer"
                                >
                                  <option value="">Select Department</option>
                                  {departments.map((dept) => (
                                    <option key={dept.id} value={dept.id}>{dept.name}</option>
                                  ))}
                                </select>"""

if target_select in content:
    content = content.replace(target_select, correct_select)
    print("Replaced select block successfully!")
else:
    # Let's search lines and replace by line matching
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        if 'onChange={(e) => setDocDeptId(e.target.value)}' in line and '<option key={dept.id}' in lines[idx+1]:
            print(f"Found select pattern at line {idx+1}")
            # Replace lines [idx+1] and [idx+2]
            # lines[idx] is onChange...
            # lines[idx+1] is <option...
            # lines[idx+2] is ))}
            # lines[idx+3] is </select>
            # Let's replace the whole select block
            lines[idx]   = '                                  value={docDeptId}'
            lines[idx+1] = '                                  onChange={(e) => setDocDeptId(e.target.value)}'
            lines[idx+2] = '                                  required'
            lines[idx+3] = '                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all cursor-pointer"'
            lines[idx+4] = '                                >'
            lines[idx+5] = '                                  <option value="">Select Department</option>'
            lines[idx+6] = '                                  {departments.map((dept) => ('
            lines[idx+7] = '                                    <option key={dept.id} value={dept.id}>{dept.name}</option>'
            lines[idx+8] = '                                  ))}'
            # wait, lines[idx+3] was </select> in original. So we inserted new lines. Let's rebuild lines list:
            lines_before = lines[:idx-1]
            lines_after = lines[idx+4:]
            lines = lines_before + [
                '                                <select',
                '                                  value={docDeptId}',
                '                                  onChange={(e) => setDocDeptId(e.target.value)}',
                '                                  required',
                '                                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs text-zinc-800 font-semibold focus:border-brand focus:outline-none transition-all cursor-pointer"',
                '                                >',
                '                                  <option value="">Select Department</option>',
                '                                  {departments.map((dept) => (',
                '                                    <option key={dept.id} value={dept.id}>{dept.name}</option>',
                '                                  ))}',
                '                                </select>'
            ] + lines_after
            content = "\n".join(lines) + "\n"
            print("Fixed select block lines array!")
            break

# Now search and replace the docError block:
target_error = """                            {docError && (
                              <div className="rounded-full bg-red-50 border border-red-100 p-2.5 text-center">
                                <p className="text-[10px] font-bold text-red-650 flex items-center justify-center gap-1 leading-none">
                                  <AlertCircle className="h-3.5 w-3.5 text-red-500" /> {docError}
                                </p>
                              </div>
                            )}"""

correct_error = """                            {docError && (
                              <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-[10px] font-bold text-red-650 text-left space-y-2 flex flex-col items-start w-full">
                                <div className="flex items-center gap-1.5 text-red-800">
                                  <AlertCircle className="h-4 w-4 shrink-0 text-red-650" />
                                  <span>Plan Restriction Alert</span>
                                </div>
                                <p className="text-[11px] leading-relaxed text-red-750 font-medium">{docError}</p>
                                {docError.toLowerCase().includes("upgrade") && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveTab("plans");
                                      setDocError("");
                                      setIsEditingDoc(false);
                                      setEditingDoc(null);
                                      clearDocForm();
                                    }}
                                    className="rounded-full bg-red-650 hover:bg-red-700 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                                  >
                                    Upgrade Plan Now
                                  </button>
                                )}
                              </div>
                            )}"""

if target_error in content:
    content = content.replace(target_error, correct_error)
    print("Replaced docError block by substring search!")
else:
    # Try line by line search
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        if 'AlertCircle' in line and 'docError' in line and 'rounded-full bg-red-50' in lines[idx-2]:
            print(f"Found docError at line {idx+1}")
            lines_before = lines[:idx-3]
            lines_after = lines[idx+4:]
            lines = lines_before + [
                '                            {docError && (',
                '                              <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-[10px] font-bold text-red-650 text-left space-y-2 flex flex-col items-start w-full">',
                '                                <div className="flex items-center gap-1.5 text-red-800">',
                '                                  <AlertCircle className="h-4 w-4 shrink-0 text-red-650" />',
                '                                  <span>Plan Restriction Alert</span>',
                '                                </div>',
                '                                <p className="text-[11px] leading-relaxed text-red-755 font-medium">{docError}</p>',
                '                                {docError.toLowerCase().includes("upgrade") && (',
                '                                  <button',
                '                                    type="button"',
                '                                    onClick={() => {',
                '                                      setActiveTab("plans");',
                '                                      setDocError("");',
                '                                      setIsEditingDoc(false);',
                '                                      setEditingDoc(null);',
                '                                      clearDocForm();',
                '                                    }}',
                '                                    className="rounded-full bg-red-650 hover:bg-red-700 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"',
                '                                  >',
                '                                    Upgrade Plan Now',
                '                                  </button>',
                '                                )}',
                '                              </div>',
                '                            )}'
            ] + lines_after
            content = "\n".join(lines) + "\n"
            print("Fixed docError block lines array!")
            break

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("Fix and replacement script run complete!")
