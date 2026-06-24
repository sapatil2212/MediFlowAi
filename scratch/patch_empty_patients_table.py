import re

def patch_empty_state_table(filepath, name, text_desc, header_title, reason_fallback, info_label, goal_label, profile_action_label, view_profile_err):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
    
    start_marker = ') : filteredPatients.length === 0 ? ('
    start_idx = content.find(start_marker)
    if start_idx == -1:
        print(f"ERROR: Could not find start marker in {name} dashboard!")
        return
        
    sub_content = content[start_idx:]
    
    match_end = re.search(r'\)\s*:\s*\(\s*<>\s*\{\s*/\*\s*Desktop Table', sub_content)
    if not match_end:
        print(f"ERROR: Could not find end pattern match in {name} dashboard!")
        return
        
    end_idx = start_idx + match_end.start()
    
    print(f"Found block in {name} from character {start_idx} to {end_idx}")
    
    # We open with: ? (() => {  (two open parentheses)
    # So we MUST close with: })()) (two close parentheses)
    replacement = f""") : filteredPatients.length === 0 ? (() => {{
                    const confirmedApts = appointments.filter(apt => apt.status === "Confirmed");
                    if (confirmedApts.length === 0) {{
                      return (
                        <div className="p-8 text-center bg-white rounded-2xl">
                          <Users className="mx-auto h-8 w-8 text-zinc-300 mb-2" />
                          <p className="text-xs text-zinc-400 font-bold">{text_desc}</p>
                        </div>
                      );
                    }}
                    
                    return (
                      <div className="space-y-4">
                        <div className="bg-zinc-50 border-b border-zinc-150 px-6 py-3 flex items-center justify-between">
                          <h4 className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                            <ClipboardCheck className="h-4 w-4 text-emerald-500" />
                            {header_title}
                          </h4>
                          <span className="text-[10px] font-bold text-zinc-400">
                            {{confirmedApts.length}} active
                          </span>
                        </div>
                        
                        {{/* Desktop Table View */}}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="min-w-full divide-y divide-zinc-200 text-left">
                            <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                              <tr>
                                <th className="px-6 py-3">{info_label}</th>
                                <th className="px-6 py-3">Date & Time</th>
                                <th className="px-6 py-3">{goal_label}</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-150 text-xs">
                              {{confirmedApts.map((apt) => (
                                <tr key={{apt.id}} className="hover:bg-zinc-50/40 transition-colors">
                                  {{/* Info */}}
                                  <td className="px-6 py-3.5">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {{apt.tokenNo && (
                                          <span className="inline-flex items-center justify-center px-1 rounded bg-brand/10 border border-brand/20 text-brand text-[8px] font-black shrink-0">
                                            #{{apt.tokenNo}}
                                          </span>
                                        )}}
                                        <span className="font-extrabold text-zinc-800 text-xs sm:text-[13px]">{{apt.name}}</span>
                                        {{apt.appointmentType && (
                                          <span className="inline-flex items-center justify-center px-1.5 py-0.2 rounded bg-brand/5 border border-brand/10 text-brand text-[8px] font-extrabold shrink-0">
                                            {{apt.appointmentType}}
                                          </span>
                                        )}}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 font-semibold mt-1">
                                        {{apt.phone && <span>{{apt.phone}}</span>}}
                                        {{apt.email && (
                                          <>
                                            <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                            <span className="truncate max-w-[120px]">{{apt.email}}</span>
                                          </>
                                        )}}
                                      </div>
                                    </div>
                                  </td>

                                  {{/* Date & Time */}}
                                  <td className="px-6 py-3.5 font-bold text-zinc-700 whitespace-nowrap">
                                    {{new Date(apt.dateTime).toLocaleString("en-US", {{
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }})}}
                                  </td>

                                  {{/* Goal / Focus */}}
                                  <td className="px-6 py-3.5 max-w-[200px] truncate text-zinc-550 font-medium">
                                    {{apt.reason || "{reason_fallback}"}}
                                  </td>

                                  {{/* Actions */}}
                                  <td className="px-6 py-3.5 text-right">
                                    <button
                                      type="button"
                                      onClick={{async () => {{
                                        const pid = resolvePatientForApt(apt);
                                        if (pid) {{
                                          const matched = patientsList.find(p => p.id === pid);
                                          if (matched) {{
                                            setSelectedPatient(matched);
                                          }} else {{
                                            setLoadingPatients(true);
                                            try {{
                                              const res = await getPatientChartServerFn({{ data: {{ patientId: pid }} }});
                                              if (res && res.patient) {{
                                                setSelectedPatient(res.patient);
                                              }}
                                            }} catch (e) {{
                                              console.error("Failed to load chart:", e);
                                              showToast("error", "{view_profile_err}");
                                            }} finally {{
                                              setLoadingPatients(false);
                                            }}
                                          }}
                                        }} else {{
                                          showToast("error", "No profile found for this booking.");
                                        }}
                                      }}}}
                                      className="inline-flex items-center gap-1 bg-brand text-white hover:opacity-90 transition-all font-bold px-3 py-1 rounded-full text-[10px] cursor-pointer shrink-0 shadow-none active:scale-[0.98]"
                                    >
                                      <User className="h-3 w-3" />
                                      {profile_action_label}
                                    </button>
                                  </td>
                                </tr>
                              ))}}
                            </tbody>
                          </table>
                        </div>

                        {{/* Mobile List View */}}
                        <div className="md:hidden divide-y divide-zinc-150">
                          {{confirmedApts.map((apt) => (
                            <div key={{apt.id}} className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-1.5">
                                    {{apt.tokenNo && (
                                      <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-md bg-brand/10 border border-brand/20 text-brand text-[9px] font-black">
                                        #{{apt.tokenNo}}
                                      </span>
                                    )}}
                                    <span>{{apt.name}}</span>
                                    {{apt.appointmentType && (
                                      <span className="text-[8px] font-extrabold text-brand bg-brand/5 border border-brand/10 rounded px-1.5 py-0.5">
                                        {{apt.appointmentType}}
                                      </span>
                                    )}}
                                  </h4>
                                  <div className="flex flex-col text-[10px] text-zinc-400 gap-0.5 mt-0.5">
                                    <span>Phone: {{apt.phone}}</span>
                                  </div>
                                </div>
                                <span className="inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold border bg-brand/5 text-brand border-brand/10">
                                  Confirmed
                                </span>
                              </div>

                              <div className="space-y-1 text-xs border-t border-b border-zinc-100/70 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Schedule:</span>
                                  <span className="text-zinc-700 font-bold">
                                    {{new Date(apt.dateTime).toLocaleString("en-US", {{
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }})}}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Goal:</span>
                                  <span className="text-zinc-550 truncate">{{apt.reason}}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-end gap-3 pt-1">
                                <button
                                  type="button"
                                  onClick={{async () => {{
                                    const pid = resolvePatientForApt(apt);
                                    if (pid) {{
                                      const matched = patientsList.find(p => p.id === pid);
                                      if (matched) {{
                                        setSelectedPatient(matched);
                                      }} else {{
                                        setLoadingPatients(true);
                                        try {{
                                          const res = await getPatientChartServerFn({{ data: {{ patientId: pid }} }});
                                          if (res && res.patient) {{
                                            setSelectedPatient(res.patient);
                                          }}
                                        }} catch (e) {{
                                          console.error("Failed to load chart:", e);
                                          showToast("error", "{view_profile_err}");
                                        }} finally {{
                                          setLoadingPatients(false);
                                        }}
                                      }}
                                    }} else {{
                                      showToast("error", "No profile found.");
                                    }}
                                  }}}}
                                  className="text-brand font-bold text-xs cursor-pointer mr-auto"
                                >
                                  {profile_action_label}
                                </button>
                              </div>
                            </div>
                          ))}}
                        </div>
                      </div>
                    );
                  }})())"""
                  
    new_content = content[:start_idx] + replacement + content[end_idx:]
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print(f"SUCCESS: Patched {name} dashboard empty-state to table format!")

def main():
    patch_empty_state_table(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx",
        "Gym",
        "No client profiles match your query.",
        "Confirmed Sessions / Bookings",
        "General training session",
        "Client Info",
        "Focus / Goal",
        "View Profile",
        "Failed to load client profile"
    )
    patch_empty_state_table(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
        "Education",
        "No student profiles match your query.",
        "Confirmed Classes / Bookings",
        "General academic session",
        "Student Info",
        "Focus / Goal",
        "View Profile",
        "Failed to load student profile"
    )
    patch_empty_state_table(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
        "Beauty",
        "No client profiles match your query.",
        "Confirmed Service Bookings",
        "General beauty service",
        "Client Info",
        "Service / Goal",
        "View Profile",
        "Failed to load client profile"
    )
    patch_empty_state_table(
        r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
        "Professional",
        "No client profiles match your query.",
        "Confirmed Consultations / Meetings",
        "General consulting session",
        "Client Info",
        "Consultation / Goal",
        "View Profile",
        "Failed to load client profile"
    )

if __name__ == "__main__":
    main()
