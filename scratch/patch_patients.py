import os

file_path = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboard.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# Locate activeTab === "patients" and the following block
start_str = '            {activeTab === "patients" && ('
end_str = '            {activeTab === "analytics" && ('

start_idx = content.find(start_str)
if start_idx == -1:
    print("Error: Start block not found")
    exit(1)

# Find the end of activeTab === "patients" block, which is right before analytics block
end_idx = content.find(end_str)
if end_idx == -1:
    print("Error: End block not found")
    exit(1)

# Find the last closing tag '            )}' before end_idx
search_block = content[start_idx:end_idx]
last_bracket_idx = search_block.rfind('            )}')
if last_bracket_idx == -1:
    print("Error: Last closing bracket not found")
    exit(1)

absolute_end_idx = start_idx + last_bracket_idx + 14 # Include the '            )}\n\n'

new_patients_block = """            {activeTab === "patients" && (
              <motion.div
                key="patients"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-6"
              >
                {/* 1. Header Toolbar with Add Patient trigger */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-zinc-900 leading-none">
                      Patient Registry
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
                      Manage registered patient profile files, basic demographics, and clinical history record files.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      clearPatientForm();
                      setIsAddingPatient(!isAddingPatient);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-bold text-white bg-brand hover:opacity-90 transition-all rounded-full shadow-sm cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Patient File
                  </button>
                </div>

                {/* 2. Statistics Bar */}
                {(() => {
                  const totalCount = patientsList.length;
                  const maleCount = patientsList.filter(p => p.gender === "Male").length;
                  const femaleCount = patientsList.filter(p => p.gender === "Female").length;
                  const otherCount = patientsList.filter(p => p.gender !== "Male" && p.gender !== "Female").length;
                  
                  // New Patients registered in the last 30 days
                  const thirtyDaysAgo = new Date();
                  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                  const newCount = patientsList.filter(p => new Date(p.createdAt) >= thirtyDaysAgo).length;
                  
                  return (
                    <div className="grid gap-4 grid-cols-2 sm:grid-cols-5">
                      {/* Total Patients */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-center justify-between shadow-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight block">
                            Total Patients
                          </span>
                          <h3 className="text-2xl font-extrabold text-zinc-900">
                            {totalCount}
                          </h3>
                        </div>
                        <div className="bg-sky-50 text-sky-500 rounded-xl p-2.5">
                          <Users className="h-5 w-5" />
                        </div>
                      </div>

                      {/* Male Patients */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-center justify-between shadow-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight block">Male</span>
                          <h3 className="text-2xl font-extrabold text-sky-600">
                            {maleCount}
                          </h3>
                        </div>
                        <div className="bg-sky-50/50 text-sky-500 rounded-xl p-2.5">
                          <User className="h-5 w-5" />
                        </div>
                      </div>

                      {/* Female Patients */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-center justify-between shadow-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight block">Female</span>
                          <h3 className="text-2xl font-extrabold text-rose-650">
                            {femaleCount}
                          </h3>
                        </div>
                        <div className="bg-rose-50 text-rose-500 rounded-xl p-2.5">
                          <User className="h-5 w-5" />
                        </div>
                      </div>

                      {/* New Profiles */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-center justify-between shadow-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight block">
                            New (30 Days)
                          </span>
                          <h3 className="text-2xl font-extrabold text-purple-650">
                            {newCount}
                          </h3>
                        </div>
                        <div className="bg-purple-50 text-purple-500 rounded-xl p-2.5">
                          <UserPlus className="h-5 w-5" />
                        </div>
                      </div>

                      {/* Other / Unspecified */}
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 flex items-center justify-between shadow-sm">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tight block">Others</span>
                          <h3 className="text-2xl font-extrabold text-zinc-650">
                            {otherCount}
                          </h3>
                        </div>
                        <div className="bg-zinc-50 text-zinc-500 rounded-xl p-2.5">
                          <Activity className="h-5 w-5" />
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Add Patient Card Form */}
                <AnimatePresence>
                  {isAddingPatient && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <form onSubmit={handleAddPatientSubmit} className="rounded-2xl border border-zinc-200 bg-white p-5 grid gap-4 sm:grid-cols-4 items-end">
                        <div className="sm:col-span-4 font-bold text-xs text-zinc-800 border-b border-zinc-100 pb-2 mb-2">
                          {editingPatient ? `Edit Patient Registry File (${editingPatient.patientNo})` : "Create New Patient Registry File"}
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Patient Name</label>
                          <input
                            type="text"
                            value={newPatientName}
                            onChange={(e) => setNewPatientName(e.target.value)}
                            placeholder="John Doe"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Age</label>
                          <input
                            type="number"
                            value={newPatientAge}
                            onChange={(e) => setNewPatientAge(e.target.value)}
                            placeholder="34"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Gender</label>
                          <select
                            value={newPatientGender}
                            onChange={(e) => setNewPatientGender(e.target.value)}
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand cursor-pointer"
                          >
                            <option>Female</option>
                            <option>Male</option>
                            <option>Other</option>
                          </select>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Phone Number</label>
                          <input
                            type="tel"
                            value={newPatientPhone}
                            onChange={(e) => setNewPatientPhone(e.target.value)}
                            placeholder="919876543210"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Email Address</label>
                          <input
                            type="email"
                            value={newPatientEmail}
                            onChange={(e) => setNewPatientEmail(e.target.value)}
                            placeholder="patient@example.com"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-3">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Residential Address</label>
                          <input
                            type="text"
                            value={newPatientAddress}
                            onChange={(e) => setNewPatientAddress(e.target.value)}
                            placeholder="123 Main St, Apartment 4B"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Chief Complaint</label>
                          <input
                            type="text"
                            value={newPatientReason}
                            onChange={(e) => setNewPatientReason(e.target.value)}
                            placeholder="Brief symptoms narrative (e.g. chronic cough, migraine)"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                            required
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-zinc-400 uppercase">Clinical Notes</label>
                          <input
                            type="text"
                            value={newPatientNotes}
                            onChange={(e) => setNewPatientNotes(e.target.value)}
                            placeholder="Additional background history, allergies, medications"
                            className="w-full rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs focus:outline-none focus:border-brand"
                          />
                        </div>
                        <div className="sm:col-span-4 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              clearPatientForm();
                              setIsAddingPatient(false);
                            }}
                            className="text-xs font-semibold text-zinc-400 hover:text-zinc-650 px-3 py-1 cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={savingPatient}
                            className="rounded-full bg-brand text-white text-xs font-semibold px-5 py-2.5 cursor-pointer shadow-md disabled:bg-zinc-150 disabled:text-zinc-400 flex items-center gap-1.5"
                          >
                            {savingPatient && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {editingPatient ? "Update Patient Profile" : "Create Patient Profile"}
                          </button>
                        </div>
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Main Filter & Table Card */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-brand" />
                      <h3 className="text-sm font-extrabold text-zinc-900">Patients Registry</h3>
                    </div>
                  </div>

                  {/* Filters control bar */}
                  <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
                    <div className="flex flex-1 flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                      {/* Search */}
                      <div className="relative flex-1 max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                        <input
                          type="text"
                          placeholder="Search patient, ID, phone..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-zinc-200 bg-zinc-50/30 placeholder-zinc-400 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand font-semibold text-zinc-700"
                        />
                      </div>
                    </div>

                    {/* Clear & Export Buttons */}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery("");
                          setSelectedPatientIds([]);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-bold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 rounded-lg cursor-pointer transition-all"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Clear
                      </button>
                      
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setShowPatientExportDropdown(!showPatientExportDropdown)}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-bold border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 rounded-lg cursor-pointer transition-all"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export {selectedPatientIds.length > 0 ? `(${selectedPatientIds.length})` : ""}
                          <ChevronDown className="h-3 w-3 text-zinc-400" />
                        </button>
                        {showPatientExportDropdown && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setShowPatientExportDropdown(false)} />
                            <div className="absolute right-0 mt-1.5 w-40 rounded-xl bg-white border border-zinc-150 shadow-lg py-1.5 z-20 animate-in fade-in slide-in-from-top-1 duration-100">
                              <button
                                type="button"
                                onClick={() => {
                                  handleExportPatients("pdf");
                                  setShowPatientExportDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                              >
                                <FileText className="h-4 w-4 text-red-500 shrink-0" />
                                <span>Export to PDF</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleExportPatients("word");
                                  setShowPatientExportDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                              >
                                <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                                <span>Export to Word</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleExportPatients("excel");
                                  setShowPatientExportDropdown(false);
                                }}
                                className="w-full text-left px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 flex items-center gap-2.5 cursor-pointer transition-colors"
                              >
                                <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                                <span>Export to Excel</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Table area */}
                  {loadingPatients ? (
                    <div className="py-12 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand mb-2" />
                      <p className="text-xs text-zinc-400 font-semibold">Loading registry profiles...</p>
                    </div>
                  ) : (() => {
                    const list = filteredPatients;
                    if (list.length === 0) {
                      return (
                        <div className="rounded-xl border border-zinc-100 bg-zinc-50/20 py-16 text-center">
                          <Users className="mx-auto h-10 w-10 text-zinc-300 mb-3" />
                          <h4 className="text-xs font-bold text-zinc-805">No patients found</h4>
                          <p className="text-[10px] text-zinc-400 mt-1 max-w-[280px] mx-auto">Try adjusting the search query to find patient profiles.</p>
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* Desktop Table View */}
                        <div className="hidden md:block overflow-x-auto border border-zinc-150 rounded-xl">
                          <table className="min-w-full divide-y divide-zinc-150 text-left">
                            <thead className="bg-zinc-50 text-[10px] font-bold text-zinc-400 uppercase">
                              {(() => {
                                const allSelected = list.length > 0 && list.every(p => selectedPatientIds.includes(p.id));
                                const toggleSelectAll = () => {
                                  if (allSelected) {
                                    const listIds = list.map(p => p.id);
                                    setSelectedPatientIds(prev => prev.filter(id => !listIds.includes(id)));
                                  } else {
                                    const listIds = list.map(p => p.id);
                                    setSelectedPatientIds(prev => {
                                      const newSelection = [...prev];
                                      listIds.forEach(id => {
                                        if (!newSelection.includes(id)) newSelection.push(id);
                                      });
                                      return newSelection;
                                    });
                                  }
                                };
                                return (
                                  <tr>
                                    <th className="px-4 py-3 w-10 text-center">
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleSelectAll}
                                        className="rounded border-zinc-300 text-brand focus:ring-brand h-3.5 w-3.5 cursor-pointer align-middle"
                                      />
                                    </th>
                                    <th className="px-5 py-3">Patient Info</th>
                                    <th className="px-5 py-3">Patient ID</th>
                                    <th className="px-5 py-3">Registry Date</th>
                                    <th className="px-5 py-3">Chief Complaint</th>
                                    <th className="px-5 py-3 text-right">Actions</th>
                                  </tr>
                                );
                              })()}
                            </thead>
                            <tbody className="divide-y divide-zinc-100 text-xs text-zinc-650 bg-white">
                              {list.map((p) => {
                                const formattedDate = new Date(p.createdAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric"
                                });

                                return (
                                  <tr key={p.id} className="hover:bg-zinc-50/40 transition-colors">
                                    <td className="px-4 py-3.5 w-10 text-center">
                                      <input
                                        type="checkbox"
                                        checked={selectedPatientIds.includes(p.id)}
                                        onChange={() => {
                                          setSelectedPatientIds(prev =>
                                            prev.includes(p.id)
                                              ? prev.filter(id => id !== p.id)
                                              : [...prev, p.id]
                                          );
                                        }}
                                        className="rounded border-zinc-300 text-brand focus:ring-brand h-3.5 w-3.5 cursor-pointer align-middle"
                                      />
                                    </td>
                                    {/* Patient Info */}
                                    <td className="px-5 py-3.5">
                                      <div className="flex flex-col">
                                        <span className="font-extrabold text-zinc-808 text-xs sm:text-[13px]">{p.name}</span>
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-zinc-400 font-semibold mt-1">
                                          {p.age && <span>{p.age} Yrs</span>}
                                          {p.gender && (
                                            <>
                                              <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                              <span>{p.gender}</span>
                                            </>
                                          )}
                                          {p.phone && (
                                            <>
                                              <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                              <span>{p.phone}</span>
                                            </>
                                          )}
                                          {p.email && (
                                            <>
                                              <span className="w-1 h-1 rounded-full bg-zinc-300"></span>
                                              <span className="truncate max-w-[120px]">{p.email}</span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </td>

                                    {/* Patient ID */}
                                    <td className="px-5 py-3.5 font-mono font-bold text-zinc-500">
                                      {p.patientNo}
                                    </td>

                                    {/* Registry Date */}
                                    <td className="px-5 py-3.5 font-bold text-zinc-700 whitespace-nowrap">
                                      {formattedDate}
                                    </td>

                                    {/* Chief Complaint */}
                                    <td className="px-5 py-3.5 max-w-[200px] truncate text-zinc-500 font-medium">
                                      {p.chiefComplaint || p.reason || "General visit"}
                                    </td>

                                    {/* Actions */}
                                    <td className="px-5 py-3.5 text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        <button
                                          type="button"
                                          title="View Patient EHR Profile"
                                          onClick={() => setSelectedPatient(p)}
                                          className="p-1.5 rounded-lg text-zinc-400 hover:text-brand hover:bg-brand/5 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          title="Edit Patient File"
                                          onClick={() => {
                                            setEditingPatient(p);
                                            setNewPatientName(p.name);
                                            setNewPatientAge(String(p.age));
                                            setNewPatientGender(p.gender);
                                            setNewPatientPhone(p.phone || "");
                                            setNewPatientEmail(p.email || "");
                                            setNewPatientAddress(p.address || "");
                                            setNewPatientReason(p.chiefComplaint || p.reason || "");
                                            setNewPatientNotes(p.notes || "");
                                            setIsAddingPatient(true);
                                          }}
                                          className="p-1.5 rounded-lg text-zinc-400 hover:text-indigo-650 hover:bg-indigo-50 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Edit3 className="h-3.5 w-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          title="Delete Patient File"
                                          onClick={() => {
                                            setConfirmDialog({
                                              open: true,
                                              title: "Delete Patient File?",
                                              message: `Are you sure you want to delete ${p.name}'s medical record? This will also purge all linked SOAP notes.`,
                                              onConfirm: async () => {
                                                try {
                                                  const res = await deletePatientServerFn({ data: { id: p.id } });
                                                  if (res.success) {
                                                    showToast("success", "Patient registry file deleted successfully.");
                                                    fetchPatients();
                                                  }
                                                } catch (err: any) {
                                                  showToast("error", err.message || "Failed to delete patient");
                                                } finally {
                                                  setConfirmDialog(null);
                                                }
                                              }
                                            });
                                          }}
                                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Mobile Card View */}
                        <div className="md:hidden divide-y divide-zinc-150 border border-zinc-150 rounded-xl overflow-hidden bg-white">
                          {list.map((p) => (
                            <div key={p.id} className="p-4 space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <span className="font-mono text-[9px] font-bold text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded-full">
                                    {p.patientNo}
                                  </span>
                                  <h4 className="text-sm font-bold text-zinc-850 mt-1.5">{p.name}</h4>
                                </div>
                                <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-50 border border-zinc-100 px-2 py-0.5 rounded-full">
                                  {p.age}y/o • {p.gender}
                                </span>
                              </div>

                              <div className="space-y-1 text-xs border-t border-b border-zinc-100/70 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Complaint:</span>
                                  <span className="text-zinc-700 truncate">{p.chiefComplaint || p.reason || "General visit"}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-zinc-400 font-semibold uppercase text-[9px] tracking-wide block w-20 shrink-0">Registered:</span>
                                  <span className="text-zinc-550">{new Date(p.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>

                              <div className="flex items-center justify-between pt-1">
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingPatient(p);
                                      setNewPatientName(p.name);
                                      setNewPatientAge(String(p.age));
                                      setNewPatientGender(p.gender);
                                      setNewPatientPhone(p.phone || "");
                                      setNewPatientEmail(p.email || "");
                                      setNewPatientAddress(p.address || "");
                                      setNewPatientReason(p.chiefComplaint || p.reason || "");
                                      setNewPatientNotes(p.notes || "");
                                      setIsAddingPatient(true);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="text-zinc-550 hover:text-zinc-800 font-bold text-xs cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConfirmDialog({
                                        open: true,
                                        title: "Delete Patient File?",
                                        message: `Are you sure you want to delete ${p.name}'s medical record?`,
                                        onConfirm: async () => {
                                          try {
                                            const res = await deletePatientServerFn({ data: { id: p.id } });
                                            if (res.success) {
                                              showToast("success", "Patient deleted.");
                                              fetchPatients();
                                            }
                                          } catch (e: any) {
                                            showToast("error", e.message || "Failed to delete");
                                          } finally {
                                            setConfirmDialog(null);
                                          }
                                        }
                                      });
                                    }}
                                    className="text-red-500 hover:text-red-700 font-bold text-xs cursor-pointer"
                                  >
                                    Delete
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setSelectedPatient(p)}
                                  className="inline-flex items-center gap-1 bg-brand/5 text-brand font-bold px-3 py-1 rounded-full text-[10px] cursor-pointer"
                                >
                                  <Eye className="h-3 w-3" /> View EHR
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                </div>
                  
                  {/* Patients Pagination Controls */}
                  {patientsTotal > 20 && (
                    <div className="flex items-center justify-between border-t border-zinc-100 bg-white px-6 py-4">
                      <div className="flex-1 flex justify-between sm:hidden">
                        <button
                          type="button"
                          onClick={() => setPatientsPage(prev => Math.max(prev - 1, 1))}
                          disabled={patientsPage === 1}
                          className="relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => setPatientsPage(prev => Math.min(prev + 1, Math.ceil(patientsTotal / 20)))}
                          disabled={patientsPage >= Math.ceil(patientsTotal / 20)}
                          className="ml-3 relative inline-flex items-center px-4 py-2 border border-zinc-200 text-xs font-semibold rounded-full text-zinc-500 bg-white hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Next
                        </button>
                      </div>
                      <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[11px] text-zinc-500 font-medium">
                            Showing <span className="font-bold text-zinc-800">{(patientsPage - 1) * 20 + 1}</span> to{" "}
                            <span className="font-bold text-zinc-800">{Math.min(patientsPage * 20, patientsTotal)}</span> of{" "}
                            <span className="font-bold text-zinc-800">{patientsTotal}</span> patients
                          </p>
                        </div>
                        <div>
                          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                            <button
                              type="button"
                              onClick={() => setPatientsPage(prev => Math.max(prev - 1, 1))}
                              disabled={patientsPage === 1}
                              className="relative inline-flex items-center px-2.5 py-1.5 rounded-l-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span className="sr-only">Previous</span>
                              <ChevronLeft className="h-3.5 w-3.5" />
                            </button>
                            {Array.from({ length: Math.ceil(patientsTotal / 20) }).map((_, idx) => {
                              const pageNum = idx + 1;
                              const isCurrent = pageNum === patientsPage;
                              return (
                                <button
                                  key={pageNum}
                                  type="button"
                                  onClick={() => setPatientsPage(pageNum)}
                                  className={`relative inline-flex items-center px-3 py-1.5 border text-[11px] font-bold cursor-pointer transition-all ${
                                    isCurrent
                                      ? "z-10 bg-zinc-950 border-zinc-950 text-white"
                                      : "bg-white border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                                  }`}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => setPatientsPage(prev => Math.min(prev + 1, Math.ceil(patientsTotal / 20)))}
                              disabled={patientsPage >= Math.ceil(patientsTotal / 20)}
                              className="relative inline-flex items-center px-2.5 py-1.5 rounded-r-lg border border-zinc-200 bg-white text-xs font-medium text-zinc-400 hover:bg-zinc-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <span className="sr-only">Next</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                          </nav>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}"""

new_content = content[:start_idx] + new_patients_block + content[absolute_end_idx:]

with open(file_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("✅ Patients layout successfully patched in dashboard.tsx")
