def patch_empty_state(filepath, name, text_desc, header_title, reason_fallback):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    # We construct the search string based on text_desc
    search_str = f"""                  ) : filteredPatients.length === 0 ? (
                    <div className="p-8 text-center">
                      <Users className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
                      <p className="text-xs text-zinc-400 font-bold">{text_desc}</p>
                    </div>
                  ) : ("""
                  
    # Clean the spacing to avoid indentation mismatches
    # Let's search using a normalized version of search string
    search_normalized = search_str.replace(" ", "").replace("\n", "")
    
    # Let's perform a direct string replacement if matches exactly
    if search_str in content:
        replacement = f"""                  ) : filteredPatients.length === 0 ? (
                    <div className="space-y-6">
                      <div className="p-8 text-center bg-white rounded-2xl">
                        <Users className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
                        <p className="text-xs text-zinc-400 font-bold">{text_desc}</p>
                      </div>

                      {{(() => {{
                        const confirmedApts = appointments.filter(apt => apt.status === "Confirmed");
                        if (confirmedApts.length === 0) return null;
                        return (
                          <div className="border-t border-zinc-200 bg-zinc-50/50 p-6 space-y-4">
                            <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                              <ClipboardCheck className="h-4 w-4 text-emerald-500" />
                              {header_title}
                            </h4>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {{confirmedApts.map((apt) => (
                                <div key={{apt.id}} className="bg-white border border-zinc-200/80 rounded-xl p-4 flex flex-col justify-between hover:shadow-sm transition-all">
                                  <div className="flex justify-between items-start gap-2">
                                    <div>
                                      <h5 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
                                        {{apt.tokenNo && (
                                          <span className="inline-flex items-center justify-center px-1 rounded bg-brand/10 border border-brand/20 text-brand text-[8px] font-black">
                                            #{{apt.tokenNo}}
                                          </span>
                                        )}}
                                        {{apt.name}}
                                      </h5>
                                      <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">{{apt.phone}}</p>
                                    </div>
                                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[8px] font-bold border bg-brand/5 text-brand border-brand/10">
                                      Confirmed
                                    </span>
                                  </div>
                                  <div className="border-t border-zinc-100 mt-3 pt-2 flex items-center justify-between text-[10px] text-zinc-500">
                                    <span>
                                      {{new Date(apt.dateTime).toLocaleString("en-US", {{
                                        month: "short",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      }})}}
                                    </span>
                                    <span className="truncate max-w-[120px] font-semibold text-zinc-700">{{apt.reason || "{reason_fallback}"}}</span>
                                  </div>
                                </div>
                              ))}}
                            </div>
                          </div>
                        );
                      }})()}}
                    </div>
                  ) : ("""
        content = content.replace(search_str, replacement)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        print(f"SUCCESS: Patched empty state in {name} dashboard!")
    else:
        # If it doesn't match exactly due to line endings or spacing, let's do a more robust regex replacement
        import re
        regex_pattern = r'\):\s*filteredPatients\.length\s*===\s*0\s*\?\s*\(\s*<div\s*className="p-8\s*text-center">\s*<Users\s*className="mx-auto\s*h-8\s*w-8\s*text-zinc-300\s*mb-2"\s*/>\s*<p\s*className="text-xs\s*text-zinc-400\s*font-bold">' + re.escape(text_desc) + r'</p>\s*</div>\s*\)\s*:\s*\('
        
        match = re.search(regex_pattern, content)
        if match:
            print(f"SUCCESS (Regex match) in {name} dashboard!")
        else:
            print(f"ERROR: Could not find empty state pattern in {name} dashboard!")

def main():
    patch_empty_state(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx",
        "Gym",
        "No client profiles match your query.",
        "Confirmed Bookings",
        "General training session"
    )
    patch_empty_state(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
        "Education",
        "No student profiles match your query.",
        "Confirmed Student Bookings",
        "General academic session"
    )
    patch_empty_state(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
        "Beauty",
        "No client profiles match your query.",
        "Confirmed Appointments",
        "General beauty service"
    )
    patch_empty_state(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
        "Professional",
        "No client profiles match your query.",
        "Confirmed Consultations",
        "General consulting session"
    )

if __name__ == "__main__":
    main()
