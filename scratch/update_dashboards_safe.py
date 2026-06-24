import os
import re

dashboards = {
    "education": {
        "file": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx",
        "specialty": "Academic Advisory",
        "states": """
  // Education: Add Advisory Note modal state
  const [showAddMeetingModal, setShowAddMeetingModal] = useState(false);
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingStudentFeedback, setMeetingStudentFeedback] = useState("");
  const [meetingTeacherObservations, setMeetingTeacherObservations] = useState("");
  const [meetingPerformanceAssessment, setMeetingPerformanceAssessment] = useState("");
  const [meetingNextTarget, setMeetingNextTarget] = useState("");
  const [isSavingMeeting, setIsSavingMeeting] = useState(false);

  // Education: Add Study Plan modal state
  const [showAddStudyPlanModal, setShowAddStudyPlanModal] = useState(false);
  const [studyPlanSubjects, setStudyPlanSubjects] = useState<Array<{ name: string; sets: string; reps: string; duration: string }>>([
    { name: "", sets: "", reps: "", duration: "" }
  ]);
  const [studyPlanNotes, setStudyPlanNotes] = useState("");
  const [isSavingStudyPlan, setIsSavingStudyPlan] = useState(false);
""",
        "handlers": """
  // Education: Save Advisory/Meeting Note (reuses saveSoapNoteServerFn)
  const handleSaveMeetingEntry = async () => {
    if (!selectedPatient?.id) return;
    if (!meetingStudentFeedback.trim() && !meetingTeacherObservations.trim()) {
      showToast("error", "Please fill in at least one field.");
      return;
    }
    setIsSavingMeeting(true);
    try {
      const res = await saveSoapNoteServerFn({
        data: {
          patientId: selectedPatient.id,
          specialty: "Academic Advisory",
          subjective: meetingStudentFeedback,
          objective: meetingTeacherObservations,
          assessment: meetingPerformanceAssessment,
          plan: meetingNextTarget,
          rawTranscript: meetingDate ? `Session Date: ${meetingDate}` : ""
        }
      });
      if (res.success) {
        showToast("success", "Advisory session note saved successfully!");
        setMeetingStudentFeedback("");
        setMeetingTeacherObservations("");
        setMeetingPerformanceAssessment("");
        setMeetingNextTarget("");
        setMeetingDate("");
        setShowAddMeetingModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save meeting note.");
    } finally {
      setIsSavingMeeting(false);
    }
  };

  // Education: Save Study Plan Entry (reuses savePrescriptionServerFn)
  const handleSaveStudyPlan = async () => {
    if (!selectedPatient?.id) return;
    const validSubjects = studyPlanSubjects.filter(sub => sub.name.trim());
    if (validSubjects.length === 0) {
      showToast("error", "Please add at least one subject/topic.");
      return;
    }
    setIsSavingStudyPlan(true);
    try {
      const res = await savePrescriptionServerFn({
        data: {
          patientId: selectedPatient.id,
          medications: validSubjects.map(sub => ({
            name: sub.name,
            dosage: sub.sets ? `${sub.sets} tasks/chapters` : "",
            frequency: sub.reps ? `${sub.reps} hours/week` : "",
            route: "",
            duration: sub.duration,
            instructions: ""
          })),
          notes: studyPlanNotes
        }
      });
      if (res.success) {
        showToast("success", "Study plan saved successfully!");
        setStudyPlanSubjects([{ name: "", sets: "", reps: "", duration: "" }]);
        setStudyPlanNotes("");
        setShowAddStudyPlanModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save study plan.");
    } finally {
      setIsSavingStudyPlan(false);
    }
  };
""",
        "nav_tabs": """                      {[
                        { id: "consultations", label: "Advisory History" },
                        { id: "prescriptions", label: "Study Plans" }
                      ].map((t) => (""",
        "consultations_tab": """                      {/* CONSULTATION HISTORY */}
                      {patientProfileTab === "consultations" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Past Advisory &amp; Progress Notes
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddMeetingModal(!showAddMeetingModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Advisory Note
                            </button>
                          </div>

                          {/* Inline Add Advisory Entry Form */}
                          {showAddMeetingModal && (
                            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 space-y-3 text-xs">
                              <h5 className="text-[10px] font-black text-brand uppercase tracking-wider">New Advisory/Meeting Note</h5>
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Meeting Date</label>
                                  <input
                                    type="date"
                                    value={meetingDate}
                                    onChange={e => setMeetingDate(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:border-brand transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Student / Parent Feedback</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Needs help with algebra, motivated to study for upcoming exams"
                                    value={meetingStudentFeedback}
                                    onChange={e => setMeetingStudentFeedback(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Teacher Observations</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Good attention span, struggles with quadratic equations"
                                    value={meetingTeacherObservations}
                                    onChange={e => setMeetingTeacherObservations(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Academic Focus &amp; Performance</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Mathematics, improved logical reasoning"
                                      value={meetingPerformanceAssessment}
                                      onChange={e => setMeetingPerformanceAssessment(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Next Learning Target</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Solve 20 practice questions, revise formulas"
                                      value={meetingNextTarget}
                                      onChange={e => setMeetingNextTarget(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveMeetingEntry}
                                  disabled={isSavingMeeting}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingMeeting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingMeeting ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddMeetingModal(false); setMeetingStudentFeedback(""); setMeetingTeacherObservations(""); setMeetingPerformanceAssessment(""); setMeetingNextTarget(""); setMeetingDate(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.soapNotes || patientChartData.soapNotes.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No advising or meeting notes logged yet. Click "Add Advisory Note" to get started.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {patientChartData.soapNotes.map((note: any, idx: number) => (
                                <div key={note.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 text-xs shadow-sm text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-black text-brand uppercase tracking-wider text-[10px] px-2 py-0.5 bg-brand/5 border border-brand/10 rounded-full">
                                      {note.specialty || "Academic Advisory"}
                                    </span>
                                  </div>
                                  <div className="grid gap-3 leading-relaxed">
                                    {note.subjective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Student / Parent Feedback</strong>
                                        <p className="text-zinc-700">{note.subjective}</p>
                                      </div>
                                    )}
                                    {note.objective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Teacher Observations</strong>
                                        <p className="text-zinc-700">{note.objective}</p>
                                      </div>
                                    )}
                                    {note.assessment && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Academic Focus &amp; Performance</strong>
                                        <p className="text-zinc-700">{note.assessment}</p>
                                      </div>
                                    )}
                                    {note.plan && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Next Learning Target</strong>
                                        <p className="text-zinc-700">{note.plan}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "prescriptions_tab": """                      {/* PRESCRIPTIONS */}
                      {patientProfileTab === "prescriptions" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Study &amp; Syllabus Plans
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddStudyPlanModal(!showAddStudyPlanModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Study Plan
                            </button>
                          </div>

                          {/* Inline Add Study Plan Form */}
                          {showAddStudyPlanModal && (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 text-xs">
                              <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">New Study Plan</h5>

                              {/* Subject Rows */}
                              <div className="space-y-2">
                                <div className="grid grid-cols-12 gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-wider">
                                  <div className="col-span-5">Subject / Topic</div>
                                  <div className="col-span-2">Tasks / Chapters</div>
                                  <div className="col-span-2">Hours / Week</div>
                                  <div className="col-span-2">Duration</div>
                                  <div className="col-span-1"></div>
                                </div>
                                {studyPlanSubjects.map((sub, subIdx) => (
                                  <div key={subIdx} className="grid grid-cols-12 gap-1.5">
                                    <input
                                      type="text"
                                      placeholder="e.g. Mathematics"
                                      value={sub.name}
                                      onChange={e => {
                                        const updated = [...studyPlanSubjects];
                                        updated[subIdx] = { ...updated[subIdx], name: e.target.value };
                                        setStudyPlanSubjects(updated);
                                      }}
                                      className="col-span-5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Chapter 4 &amp; 5"
                                      value={sub.sets}
                                      onChange={e => {
                                        const updated = [...studyPlanSubjects];
                                        updated[subIdx] = { ...updated[subIdx], sets: e.target.value };
                                        setStudyPlanSubjects(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="4 hours"
                                      value={sub.reps}
                                      onChange={e => {
                                        const updated = [...studyPlanSubjects];
                                        updated[subIdx] = { ...updated[subIdx], reps: e.target.value };
                                        setStudyPlanSubjects(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="2 weeks"
                                      value={sub.duration}
                                      onChange={e => {
                                        const updated = [...studyPlanSubjects];
                                        updated[subIdx] = { ...updated[subIdx], duration: e.target.value };
                                        setStudyPlanSubjects(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <div className="col-span-1 flex items-center justify-center">
                                      {studyPlanSubjects.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => setStudyPlanSubjects(studyPlanSubjects.filter((_, i) => i !== subIdx))}
                                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setStudyPlanSubjects([...studyPlanSubjects, { name: "", sets: "", reps: "", duration: "" }])}
                                  className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold hover:text-emerald-700 transition-colors cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" /> Add Subject
                                </button>
                              </div>

                              {/* Notes */}
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Teacher Notes / Directions</label>
                                <textarea
                                  rows={2}
                                  placeholder="e.g. Focus on revision exercises. Do regular self-tests."
                                  value={studyPlanNotes}
                                  onChange={e => setStudyPlanNotes(e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all resize-none"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveStudyPlan}
                                  disabled={isSavingStudyPlan}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingStudyPlan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingStudyPlan ? "Saving..." : "Save Plan"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddStudyPlanModal(false); setStudyPlanSubjects([{ name: "", sets: "", reps: "", duration: "" }]); setStudyPlanNotes(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.prescriptions || patientChartData.prescriptions.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No study plans mapped to this student profile. Click "Add Study Plan" to create one.
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {patientChartData.prescriptions.map((rx: any, idx: number) => (
                                <div key={rx.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 shadow-sm text-xs text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(rx.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-wide">
                                      Study Plan
                                    </span>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left border-collapse text-[11px]">
                                        <thead>
                                          <tr className="border-b border-zinc-150 text-zinc-400 font-extrabold uppercase">
                                            <th className="py-1.5">Subject / Topic</th>
                                            <th className="py-1.5">Tasks / Chapters</th>
                                            <th className="py-1.5">Hours / Week</th>
                                            <th className="py-1.5">Duration</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 text-zinc-700 font-medium">
                                          {rx.medications.map((m: any, mIdx: number) => (
                                            <tr key={mIdx}>
                                              <td className="py-1.5 font-bold text-zinc-800">{m.name}</td>
                                              <td className="py-1.5">{m.dosage}</td>
                                              <td className="py-1.5">{m.frequency}</td>
                                              <td className="py-1.5">{m.duration}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {rx.notes && (
                                      <p className="text-[11px] text-zinc-650 border-t border-zinc-100 pt-2 leading-relaxed">
                                        <strong className="text-[9px] font-bold uppercase text-zinc-400 block mb-0.5">Teacher Notes</strong>
                                        {rx.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "replacements": [
            ("Patient Records", "Students Record"),
            ("Patients", "Students"),
            ("Clinic Departments", "Academic Departments"),
            ("Configure clinic profiles", "Configure school/academy profiles"),
            ("Clinic Profile", "School Profile"),
            ("Clinic Name", "Academy Name"),
            ("Practice Size", "Student Capacity"),
            ("Brief symptoms narrative (e.g. chronic cough, migraine)", "e.g. calculus help, counseling, course inquiry"),
            ("Additional background history, allergies, medications", "e.g. prior courses taken, learning needs"),
            ("EHR Enrolled Date", "Admitted Date"),
            ("Patient Information", "Student Information"),
            ("EHR Profile", "Student Profile"),
            ("Chart ID:", "Student ID:"),
            ("Workspace & Practice Management", "Workspace & Academy Management"),
            ("Clinician Dashboard — MediFlow AI", "Academy Portal — MediFlow AI"),
            ("Clinician Dashboard", "Academy Portal"),
            ("Clinician", "Teacher"),
            ("Clinicians", "Teachers"),
            ("Clinic Booking QR Code", "Academy Booking QR Code"),
            ("Display or print this QR code in your clinic.", "Display or print this QR code in your academy."),
            ("Patients can scan it", "Students can scan it"),
            ("in your clinic", "in your academy"),
            ("Search patient registry", "Search student registry"),
            ("Loading registry profiles...", "Loading student registry..."),
            ("Patient Name", "Student Name"),
            ("View Patient Member Profile", "View Student Profile"),
            ("Edit Patient File", "Edit Student Profile"),
            ("Delete Patient File", "Delete Student Profile"),
            ("Create New Patient Registry File", "Add New Student Registry"),
            ("Edit Patient Registry File", "Edit Student Registry"),
            ("Add Patient File", "Add Student File"),
            ("Assigned Doctor", "Assigned Teacher"),
            ("Chief Complaint", "Purpose of Visit"),
        ]
    },
    "beauty": {
        "file": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx",
        "specialty": "Salon & Spa Service",
        "states": """
  // Beauty: Add Service Record modal state
  const [showAddServiceModal, setShowAddServiceModal] = useState(false);
  const [serviceDate, setServiceDate] = useState("");
  const [serviceClientFeedback, setServiceClientFeedback] = useState("");
  const [serviceStylistObservations, setServiceStylistObservations] = useState("");
  const [serviceTreatmentFocus, setServiceTreatmentFocus] = useState("");
  const [serviceNextTarget, setServiceNextTarget] = useState("");
  const [isSavingService, setIsSavingService] = useState(false);

  // Beauty: Add Service Plan modal state
  const [showAddServicePlanModal, setShowAddServicePlanModal] = useState(false);
  const [servicePlanTreatments, setServicePlanTreatments] = useState<Array<{ name: string; sets: string; reps: string; duration: string }>>([
    { name: "", sets: "", reps: "", duration: "" }
  ]);
  const [servicePlanNotes, setServicePlanNotes] = useState("");
  const [isSavingServicePlan, setIsSavingServicePlan] = useState(false);
""",
        "handlers": """
  // Beauty: Save Service Note (reuses saveSoapNoteServerFn)
  const handleSaveServiceEntry = async () => {
    if (!selectedPatient?.id) return;
    if (!serviceClientFeedback.trim() && !serviceStylistObservations.trim()) {
      showToast("error", "Please fill in at least one field.");
      return;
    }
    setIsSavingService(true);
    try {
      const res = await saveSoapNoteServerFn({
        data: {
          patientId: selectedPatient.id,
          specialty: "Salon & Spa Service",
          subjective: serviceClientFeedback,
          objective: serviceStylistObservations,
          assessment: serviceTreatmentFocus,
          plan: serviceNextTarget,
          rawTranscript: serviceDate ? `Session Date: ${serviceDate}` : ""
        }
      });
      if (res.success) {
        showToast("success", "Service session note saved successfully!");
        setServiceClientFeedback("");
        setServiceStylistObservations("");
        setServiceTreatmentFocus("");
        setServiceNextTarget("");
        setServiceDate("");
        setShowAddServiceModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save service note.");
    } finally {
      setIsSavingService(false);
    }
  };

  // Beauty: Save Service Plan Entry (reuses savePrescriptionServerFn)
  const handleSaveServicePlan = async () => {
    if (!selectedPatient?.id) return;
    const validTreatments = servicePlanTreatments.filter(t => t.name.trim());
    if (validTreatments.length === 0) {
      showToast("error", "Please add at least one service/treatment.");
      return;
    }
    setIsSavingServicePlan(true);
    try {
      const res = await savePrescriptionServerFn({
        data: {
          patientId: selectedPatient.id,
          medications: validTreatments.map(t => ({
            name: t.name,
            dosage: t.sets ? `${t.sets} session(s)` : "",
            frequency: t.reps ? `${t.reps} style notes` : "",
            route: "",
            duration: t.duration,
            instructions: ""
          })),
          notes: servicePlanNotes
        }
      });
      if (res.success) {
        showToast("success", "Service plan saved successfully!");
        setServicePlanTreatments([{ name: "", sets: "", reps: "", duration: "" }]);
        setServicePlanNotes("");
        setShowAddServicePlanModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save service plan.");
    } finally {
      setIsSavingServicePlan(false);
    }
  };
""",
        "nav_tabs": """                      {[
                        { id: "consultations", label: "Service History" },
                        { id: "prescriptions", label: "Service Plans" }
                      ].map((t) => (""",
        "consultations_tab": """                      {/* CONSULTATION HISTORY */}
                      {patientProfileTab === "consultations" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Past Service &amp; Treatment Notes
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddServiceModal(!showAddServiceModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Service Record
                            </button>
                          </div>

                          {/* Inline Add Service Entry Form */}
                          {showAddServiceModal && (
                            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 space-y-3 text-xs">
                              <h5 className="text-[10px] font-black text-brand uppercase tracking-wider">New Service/Treatment Note</h5>
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Service Date</label>
                                  <input
                                    type="date"
                                    value={serviceDate}
                                    onChange={e => setServiceDate(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:border-brand transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Client Requests / Feedback</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Wants warm blonde highlights, prefers organic shampoo"
                                    value={serviceClientFeedback}
                                    onChange={e => setServiceClientFeedback(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Stylist/Therapist Observations</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Hair is slightly dry at ends, skin shows minor sensitivity to AHA peels"
                                    value={serviceStylistObservations}
                                    onChange={e => setServiceStylistObservations(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Treatment Focus &amp; Analysis</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Deep hydration conditioning, balayage technique"
                                      value={serviceTreatmentFocus}
                                      onChange={e => setServiceTreatmentFocus(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Next Treatment Target</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Keratin treatment in 6 weeks, use color-safe mask at home"
                                      value={serviceNextTarget}
                                      onChange={e => setServiceNextTarget(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveServiceEntry}
                                  disabled={isSavingService}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingService ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingService ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddServiceModal(false); setServiceClientFeedback(""); setServiceStylistObservations(""); setServiceTreatmentFocus(""); setServiceNextTarget(""); setServiceDate(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.soapNotes || patientChartData.soapNotes.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No service or styling notes logged yet. Click "Add Service Record" to get started.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {patientChartData.soapNotes.map((note: any, idx: number) => (
                                <div key={note.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 text-xs shadow-sm text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-black text-brand uppercase tracking-wider text-[10px] px-2 py-0.5 bg-brand/5 border border-brand/10 rounded-full">
                                      {note.specialty || "Salon & Spa Service"}
                                    </span>
                                  </div>
                                  <div className="grid gap-3 leading-relaxed">
                                    {note.subjective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Client Preferences</strong>
                                        <p className="text-zinc-700">{note.subjective}</p>
                                      </div>
                                    )}
                                    {note.objective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Hair/Skin Condition &amp; Analysis</strong>
                                        <p className="text-zinc-700">{note.objective}</p>
                                      </div>
                                    )}
                                    {note.assessment && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Recommended Service</strong>
                                        <p className="text-zinc-700">{note.assessment}</p>
                                      </div>
                                    )}
                                    {note.plan && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Next Service Target</strong>
                                        <p className="text-zinc-700">{note.plan}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "prescriptions_tab": """                      {/* PRESCRIPTIONS */}
                      {patientProfileTab === "prescriptions" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Service &amp; Styling Plans
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddServicePlanModal(!showAddServicePlanModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Service Plan
                            </button>
                          </div>

                          {/* Inline Add Service Plan Form */}
                          {showAddServicePlanModal && (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 text-xs">
                              <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">New Service Plan</h5>

                              {/* Treatment Rows */}
                              <div className="space-y-2">
                                <div className="grid grid-cols-12 gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-wider">
                                  <div className="col-span-5">Service / Treatment</div>
                                  <div className="col-span-2">Quantity</div>
                                  <div className="col-span-2">Style Notes</div>
                                  <div className="col-span-2">Duration</div>
                                  <div className="col-span-1"></div>
                                </div>
                                {servicePlanTreatments.map((t, tIdx) => (
                                  <div key={tIdx} className="grid grid-cols-12 gap-1.5">
                                    <input
                                      type="text"
                                      placeholder="e.g. Hair Coloring"
                                      value={t.name}
                                      onChange={e => {
                                        const updated = [...servicePlanTreatments];
                                        updated[tIdx] = { ...updated[tIdx], name: e.target.value };
                                        setServicePlanTreatments(updated);
                                      }}
                                      className="col-span-5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="1 session"
                                      value={t.sets}
                                      onChange={e => {
                                        const updated = [...servicePlanTreatments];
                                        updated[tIdx] = { ...updated[tIdx], sets: e.target.value };
                                        setServicePlanTreatments(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Warm Blonde"
                                      value={t.reps}
                                      onChange={e => {
                                        const updated = [...servicePlanTreatments];
                                        updated[tIdx] = { ...updated[tIdx], reps: e.target.value };
                                        setServicePlanTreatments(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="120 mins"
                                      value={t.duration}
                                      onChange={e => {
                                        const updated = [...servicePlanTreatments];
                                        updated[tIdx] = { ...updated[tIdx], duration: e.target.value };
                                        setServicePlanTreatments(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <div className="col-span-1 flex items-center justify-center">
                                      {servicePlanTreatments.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => setServicePlanTreatments(servicePlanTreatments.filter((_, i) => i !== tIdx))}
                                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setServicePlanTreatments([...servicePlanTreatments, { name: "", sets: "", reps: "", duration: "" }])}
                                  className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold hover:text-emerald-700 transition-colors cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" /> Add Service
                                </button>
                              </div>

                              {/* Notes */}
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Stylist Notes / Instructions</label>
                                <textarea
                                  rows={2}
                                  placeholder="e.g. Do not wash hair for 24 hours. Use purple shampoo weekly."
                                  value={servicePlanNotes}
                                  onChange={e => setServicePlanNotes(e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all resize-none"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveServicePlan}
                                  disabled={isSavingServicePlan}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingServicePlan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingServicePlan ? "Saving..." : "Save Plan"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddServicePlanModal(false); setServicePlanTreatments([{ name: "", sets: "", reps: "", duration: "" }]); setServicePlanNotes(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.prescriptions || patientChartData.prescriptions.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No service or styling plans mapped to this client profile. Click "Add Service Plan" to create one.
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {patientChartData.prescriptions.map((rx: any, idx: number) => (
                                <div key={rx.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 shadow-sm text-xs text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(rx.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-wide">
                                      Service Plan
                                    </span>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left border-collapse text-[11px]">
                                        <thead>
                                          <tr className="border-b border-zinc-150 text-zinc-400 font-extrabold uppercase">
                                            <th className="py-1.5">Service / Treatment</th>
                                            <th className="py-1.5">Quantity</th>
                                            <th className="py-1.5">Style Notes</th>
                                            <th className="py-1.5">Duration</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 text-zinc-700 font-medium">
                                          {rx.medications.map((m: any, mIdx: number) => (
                                            <tr key={mIdx}>
                                              <td className="py-1.5 font-bold text-zinc-800">{m.name}</td>
                                              <td className="py-1.5">{m.dosage}</td>
                                              <td className="py-1.5">{m.frequency}</td>
                                              <td className="py-1.5">{m.duration}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {rx.notes && (
                                      <p className="text-[11px] text-zinc-650 border-t border-zinc-100 pt-2 leading-relaxed">
                                        <strong className="text-[9px] font-bold uppercase text-zinc-400 block mb-0.5">Stylist Notes</strong>
                                        {rx.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "replacements": [
            ("Patient Records", "Client Records"),
            ("Patients", "All clients"),
            ("Clinic Departments", "Service Categories"),
            ("Configure clinic profiles", "Configure salon/spa profiles"),
            ("Clinic Profile", "Salon/Spa Profile"),
            ("Clinic Name", "Salon/Spa Name"),
            ("Practice Size", "Salon Capacity"),
            ("Brief symptoms narrative (e.g. chronic cough, migraine)", "e.g. haircut, facial, hair coloring, massage"),
            ("Additional background history, allergies, medications", "e.g. skin allergies, sensitive scalp, style history"),
            ("EHR Enrolled Date", "First Visit Date"),
            ("Patient Information", "Client Information"),
            ("EHR Profile", "Client Profile"),
            ("Chart ID:", "Client ID:"),
            ("Workspace & Practice Management", "Workspace & Salon/Spa Management"),
            ("Clinician Dashboard — MediFlow AI", "Salon/Spa Portal — MediFlow AI"),
            ("Clinician Dashboard", "Salon/Spa Portal"),
            ("Clinician", "Stylist/Therapist"),
            ("Clinicians", "Stylists & Therapists"),
            ("Clinic Booking QR Code", "Salon Booking QR Code"),
            ("Display or print this QR code in your clinic.", "Display or print this QR code in your salon/spa."),
            ("Patients can scan it", "Clients can scan it"),
            ("in your clinic", "in your salon/spa"),
            ("Search patient registry", "Search client registry"),
            ("Loading registry profiles...", "Loading client registry..."),
            ("Patient Name", "Client Name"),
            ("View Patient Member Profile", "View Client Profile"),
            ("Edit Patient File", "Edit Client Profile"),
            ("Delete Patient File", "Delete Client Profile"),
            ("Create New Patient Registry File", "Add New Client Profile"),
            ("Edit Patient Registry File", "Edit Client Profile"),
            ("Add Patient File", "Add Client File"),
            ("Assigned Doctor", "Assigned Stylist"),
            ("Chief Complaint", "Client Requests"),
        ]
    },
    "professional": {
        "file": r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx",
        "specialty": "Professional Consulting",
        "states": """
  // Professional: Add Advisory Note modal state
  const [showAddAdvisoryModal, setShowAddAdvisoryModal] = useState(false);
  const [advisoryDate, setAdvisoryDate] = useState("");
  const [advisoryClientInput, setAdvisoryClientInput] = useState("");
  const [advisoryObservations, setAdvisoryObservations] = useState("");
  const [advisoryAssessment, setAdvisoryAssessment] = useState("");
  const [advisoryNextSteps, setAdvisoryNextSteps] = useState("");
  const [isSavingAdvisory, setIsSavingAdvisory] = useState(false);

  // Professional: Add Action Plan modal state
  const [showAddActionPlanModal, setShowAddActionPlanModal] = useState(false);
  const [actionPlanDeliverables, setActionPlanDeliverables] = useState<Array<{ name: string; sets: string; reps: string; duration: string }>>([
    { name: "", sets: "", reps: "", duration: "" }
  ]);
  const [actionPlanNotes, setActionPlanNotes] = useState("");
  const [isSavingActionPlan, setIsSavingActionPlan] = useState(false);
""",
        "handlers": """
  // Professional: Save Advisory/Session Note (uses saveSoapNoteServerFn)
  const handleSaveAdvisoryEntry = async () => {
    if (!selectedPatient?.id) return;
    if (!advisoryClientInput.trim() && !advisoryObservations.trim()) {
      showToast("error", "Please fill in at least one field.");
      return;
    }
    setIsSavingAdvisory(true);
    try {
      const res = await saveSoapNoteServerFn({
        data: {
          patientId: selectedPatient.id,
          specialty: "Professional Consulting",
          subjective: advisoryClientInput,
          objective: advisoryObservations,
          assessment: advisoryAssessment,
          plan: advisoryNextSteps,
          rawTranscript: advisoryDate ? `Session Date: ${advisoryDate}` : ""
        }
      });
      if (res.success) {
        showToast("success", "Advisory session note saved successfully!");
        setAdvisoryClientInput("");
        setAdvisoryObservations("");
        setAdvisoryAssessment("");
        setAdvisoryNextSteps("");
        setAdvisoryDate("");
        setShowAddAdvisoryModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save advisory note.");
    } finally {
      setIsSavingAdvisory(false);
    }
  };

  // Professional: Save Action Plan Entry (reuses savePrescriptionServerFn)
  const handleSaveActionPlan = async () => {
    if (!selectedPatient?.id) return;
    const validDeliverables = actionPlanDeliverables.filter(d => d.name.trim());
    if (validDeliverables.length === 0) {
      showToast("error", "Please add at least one deliverable.");
      return;
    }
    setIsSavingActionPlan(true);
    try {
      const res = await savePrescriptionServerFn({
        data: {
          patientId: selectedPatient.id,
          medications: validDeliverables.map(d => ({
            name: d.name,
            dosage: d.sets ? `${d.sets} scope` : "",
            frequency: d.reps ? `${d.reps} notes` : "",
            route: "",
            duration: d.duration,
            instructions: ""
          })),
          notes: actionPlanNotes
        }
      });
      if (res.success) {
        showToast("success", "Action plan saved successfully!");
        setActionPlanDeliverables([{ name: "", sets: "", reps: "", duration: "" }]);
        setActionPlanNotes("");
        setShowAddActionPlanModal(false);
        // Refresh chart
        const chartRes = await getPatientChartServerFn({ data: { patientId: selectedPatient.id } });
        setPatientChartData(chartRes);
      }
    } catch (e: any) {
      showToast("error", e.message || "Failed to save action plan.");
    } finally {
      setIsSavingActionPlan(false);
    }
  };
""",
        "nav_tabs": """                      {[
                        { id: "consultations", label: "Consultation History" },
                        { id: "prescriptions", label: "Action Plans" }
                      ].map((t) => (""",
        "consultations_tab": """                      {/* CONSULTATION HISTORY */}
                      {patientProfileTab === "consultations" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Past Consultation &amp; Advisory Notes
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddAdvisoryModal(!showAddAdvisoryModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Advisory Note
                            </button>
                          </div>

                          {/* Inline Add Advisory Entry Form */}
                          {showAddAdvisoryModal && (
                            <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4 space-y-3 text-xs">
                              <h5 className="text-[10px] font-black text-brand uppercase tracking-wider">New Consultation/Advisory Note</h5>
                              <div className="grid grid-cols-1 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Session Date</label>
                                  <input
                                    type="date"
                                    value={advisoryDate}
                                    onChange={e => setAdvisoryDate(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 focus:outline-none focus:border-brand transition-all"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Client Input / Objectives</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Wants to design tax structure, optimize business operations"
                                    value={advisoryClientInput}
                                    onChange={e => setAdvisoryClientInput(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Consultant Findings &amp; Observations</label>
                                  <textarea
                                    rows={2}
                                    placeholder="e.g. Tax liability is high, overhead operations need standardization"
                                    value={advisoryObservations}
                                    onChange={e => setAdvisoryObservations(e.target.value)}
                                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Advisory Assessment &amp; Focus</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Corporate structuring, financial compliance"
                                      value={advisoryAssessment}
                                      onChange={e => setAdvisoryAssessment(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Next Steps / Deliverables</label>
                                    <textarea
                                      rows={2}
                                      placeholder="e.g. Prepare LLC operating agreement, submit Q3 tax filings"
                                      value={advisoryNextSteps}
                                      onChange={e => setAdvisoryNextSteps(e.target.value)}
                                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand transition-all resize-none"
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveAdvisoryEntry}
                                  disabled={isSavingAdvisory}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-[10px] font-bold hover:bg-brand/90 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingAdvisory ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingAdvisory ? "Saving..." : "Save Note"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddAdvisoryModal(false); setAdvisoryClientInput(""); setAdvisoryObservations(""); setAdvisoryAssessment(""); setAdvisoryNextSteps(""); setAdvisoryDate(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.soapNotes || patientChartData.soapNotes.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No consultation or advisory notes logged yet. Click "Add Advisory Note" to get started.
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {patientChartData.soapNotes.map((note: any, idx: number) => (
                                <div key={note.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 text-xs shadow-sm text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(note.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-black text-brand uppercase tracking-wider text-[10px] px-2 py-0.5 bg-brand/5 border border-brand/10 rounded-full">
                                      {note.specialty || "Professional Consulting"}
                                    </span>
                                  </div>
                                  <div className="grid gap-3 leading-relaxed">
                                    {note.subjective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Client Objectives</strong>
                                        <p className="text-zinc-700">{note.subjective}</p>
                                      </div>
                                    )}
                                    {note.objective && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Consultant Findings &amp; Observations</strong>
                                        <p className="text-zinc-700">{note.objective}</p>
                                      </div>
                                    )}
                                    {note.assessment && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Advisory Assessment</strong>
                                        <p className="text-zinc-700">{note.assessment}</p>
                                      </div>
                                    )}
                                    {note.plan && (
                                      <div>
                                        <strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Next Steps / Deliverables</strong>
                                        <p className="text-zinc-700">{note.plan}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "prescriptions_tab": """                      {/* PRESCRIPTIONS */}
                      {patientProfileTab === "prescriptions" && (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                            <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                              Action &amp; Advisory Plans
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowAddActionPlanModal(!showAddActionPlanModal)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all active:scale-[0.98] cursor-pointer shadow-sm"
                            >
                              <Plus className="h-3 w-3" />
                              Add Action Plan
                            </button>
                          </div>

                          {/* Inline Add Action Plan Form */}
                          {showAddActionPlanModal && (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-4 text-xs">
                              <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-wider">New Action Plan</h5>

                              {/* Deliverable Rows */}
                              <div className="space-y-2">
                                <div className="grid grid-cols-12 gap-1.5 text-[9px] font-black text-zinc-400 uppercase tracking-wider">
                                  <div className="col-span-5">Deliverable</div>
                                  <div className="col-span-2">Scope / Detail</div>
                                  <div className="col-span-2">Notes</div>
                                  <div className="col-span-2">Target Date</div>
                                  <div className="col-span-1"></div>
                                </div>
                                {actionPlanDeliverables.map((d, dIdx) => (
                                  <div key={dIdx} className="grid grid-cols-12 gap-1.5">
                                    <input
                                      type="text"
                                      placeholder="e.g. Operating Agreement"
                                      value={d.name}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], name: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Full draft"
                                      value={d.sets}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], sets: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Review with board"
                                      value={d.reps}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], reps: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <input
                                      type="text"
                                      placeholder="Oct 15"
                                      value={d.duration}
                                      onChange={e => {
                                        const updated = [...actionPlanDeliverables];
                                        updated[dIdx] = { ...updated[dIdx], duration: e.target.value };
                                        setActionPlanDeliverables(updated);
                                      }}
                                      className="col-span-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all"
                                    />
                                    <div className="col-span-1 flex items-center justify-center">
                                      {actionPlanDeliverables.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => setActionPlanDeliverables(actionPlanDeliverables.filter((_, i) => i !== dIdx))}
                                          className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                        >
                                          <X className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => setActionPlanDeliverables([...actionPlanDeliverables, { name: "", sets: "", reps: "", duration: "" }])}
                                  className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold hover:text-emerald-700 transition-colors cursor-pointer"
                                >
                                  <Plus className="h-3 w-3" /> Add Deliverable
                                </button>
                              </div>

                              {/* Notes */}
                              <div className="space-y-1">
                                <label className="text-[9px] font-bold uppercase text-zinc-400 tracking-wider block">Consultant Notes / Directions</label>
                                <textarea
                                  rows={2}
                                  placeholder="e.g. Align stakeholders before the draft submission. Review local compliance rules."
                                  value={actionPlanNotes}
                                  onChange={e => setActionPlanNotes(e.target.value)}
                                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-emerald-400 transition-all resize-none"
                                />
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={handleSaveActionPlan}
                                  disabled={isSavingActionPlan}
                                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all disabled:opacity-50 cursor-pointer"
                                >
                                  {isSavingActionPlan ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                  {isSavingActionPlan ? "Saving..." : "Save Plan"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setShowAddActionPlanModal(false); setActionPlanDeliverables([{ name: "", sets: "", reps: "", duration: "" }]); setActionPlanNotes(""); }}
                                  className="px-4 py-2 rounded-full border border-zinc-200 text-zinc-500 text-[10px] font-bold hover:bg-zinc-50 transition-all cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {patientChartData === null ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="h-6 w-6 animate-spin text-brand" />
                            </div>
                          ) : !patientChartData.prescriptions || patientChartData.prescriptions.length === 0 ? (
                            <div className="py-12 text-center text-zinc-400 italic text-xs">
                              No action plans mapped to this client profile. Click "Add Action Plan" to create one.
                            </div>
                          ) : (
                            <div className="space-y-6">
                              {patientChartData.prescriptions.map((rx: any, idx: number) => (
                                <div key={rx.id || idx} className="rounded-xl border border-zinc-150 bg-zinc-50/20 p-4 space-y-3 shadow-sm text-xs text-left">
                                  <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                                    <span className="font-extrabold text-zinc-700">
                                      {new Date(rx.createdAt).toLocaleDateString("en-US", {
                                        year: "numeric",
                                        month: "long",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                      })}
                                    </span>
                                    <span className="font-extrabold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5 text-[9px] uppercase tracking-wide">
                                      Action Plan
                                    </span>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full text-left border-collapse text-[11px]">
                                        <thead>
                                          <tr className="border-b border-zinc-150 text-zinc-400 font-extrabold uppercase">
                                            <th className="py-1.5">Deliverable</th>
                                            <th className="py-1.5">Scope / Detail</th>
                                            <th className="py-1.5">Notes</th>
                                            <th className="py-1.5">Target Date</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 text-zinc-700 font-medium">
                                          {rx.medications.map((m: any, mIdx: number) => (
                                            <tr key={mIdx}>
                                              <td className="py-1.5 font-bold text-zinc-800">{m.name}</td>
                                              <td className="py-1.5">{m.dosage}</td>
                                              <td className="py-1.5">{m.frequency}</td>
                                              <td className="py-1.5">{m.duration}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                    {rx.notes && (
                                      <p className="text-[11px] text-zinc-650 border-t border-zinc-100 pt-2 leading-relaxed">
                                        <strong className="text-[9px] font-bold uppercase text-zinc-400 block mb-0.5">Consultant Notes</strong>
                                        {rx.notes}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
""",
        "replacements": [
            ("Patient Records", "Client Records"),
            ("Patients", "All clients"),
            ("Clinic Departments", "Practice Areas"),
            ("Configure clinic profiles", "Configure firm profiles"),
            ("Clinic Profile", "Firm Profile"),
            ("Clinic Name", "Firm Name"),
            ("Practice Size", "Firm Size"),
            ("Brief symptoms narrative (e.g. chronic cough, migraine)", "e.g. tax advisory, business coaching, contract review"),
            ("Additional background history, allergies, medications", "e.g. financial history, previous legal audits"),
            ("EHR Enrolled Date", "Onboarding Date"),
            ("Patient Information", "Client Information"),
            ("EHR Profile", "Client Profile"),
            ("Chart ID:", "Client ID:"),
            ("Workspace & Practice Management", "Workspace & Firm Management"),
            ("Clinician Dashboard — MediFlow AI", "Firm Dashboard — MediFlow AI"),
            ("Clinician Dashboard", "Firm Dashboard"),
            ("Clinician", "Advisor"),
            ("Clinicians", "Advisors & Consultants"),
            ("Clinic Booking QR Code", "Firm Booking QR Code"),
            ("Display or print this QR code in your clinic.", "Display or print this QR code in your office/firm."),
            ("Patients can scan it", "Clients can scan it"),
            ("in your clinic", "in your office/firm"),
            ("Search patient registry", "Search client registry"),
            ("Loading registry profiles...", "Loading client registry..."),
            ("Patient Name", "Client Name"),
            ("View Patient Member Profile", "View Client Profile"),
            ("Edit Patient File", "Edit Client Profile"),
            ("Delete Patient File", "Delete Client Profile"),
            ("Create New Patient Registry File", "Add New Client Profile"),
            ("Edit Patient Registry File", "Edit Client Profile"),
            ("Add Patient File", "Add Client File"),
            ("Assigned Doctor", "Assigned Advisor"),
            ("Chief Complaint", "Business Goals"),
        ]
    }
}

for dash_name, config in dashboards.items():
    filepath = config["file"]
    print(f"Processing {dash_name} dashboard file: {filepath}")
    
    if not os.path.exists(filepath):
        print(f"ERROR: File {filepath} does not exist!")
        continue
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. State hooks insertion
    states_target = "  const [patientsList, setPatientsList] = useState<any[]>([]);"
    if states_target in content:
        content = content.replace(states_target, config["states"] + "\n" + states_target)
        print("-> Inserted state hooks")
    else:
        print("WARNING: State hooks target line not found!")

    # 2. Handlers insertion
    handlers_target = "  const handleSaveConsultationAndPrescription = async () => {"
    if handlers_target in content:
        content = content.replace(handlers_target, config["handlers"] + "\n" + handlers_target)
        print("-> Inserted save handlers")
    else:
        print("WARNING: Handlers target line not found!")

    # 3. Sub-tabs array replacements
    tabs_target = """                      {[
                        { id: "consultations", label: "Consultation History" },
                        { id: "prescriptions", label: "Prescriptions" }
                      ].map((t) => ("""
    if tabs_target in content:
        content = content.replace(tabs_target, config["nav_tabs"])
        print("-> Customized navigation sub-tabs labels")
    else:
        # try search matching with single quote too
        tabs_target_sq = """                      {[
                        { id: 'consultations', label: 'Consultation History' },
                        { id: 'prescriptions', label: 'Prescriptions' }
                      ].map((t) => ("""
        if tabs_target_sq in content:
            content = content.replace(tabs_target_sq, config["nav_tabs"])
            print("-> Customized navigation sub-tabs labels (single-quote matched)")
        else:
            print("WARNING: Navigation sub-tabs target block not found!")

    # 4. Replace the consultations tab content block
    consultation_block_pattern = r"\{\/\*\s*CONSULTATION HISTORY\s*\*\/.*?{/\*\s*PRESCRIPTIONS\s*\*\/}"
    
    # We find the consultations tab content using simple string markers for safety
    con_start_idx = content.find('{/* CONSULTATION HISTORY */}')
    if con_start_idx != -1:
        rx_start_idx = content.find('{/* PRESCRIPTIONS */}')
        if rx_start_idx != -1:
            # Replaced the content between con_start_idx and rx_start_idx
            old_consultations_block = content[con_start_idx:rx_start_idx]
            content = content.replace(old_consultations_block, config["consultations_tab"] + "\n                      ")
            print("-> Replaced consultations tab HTML")
        else:
            print("WARNING: Prescriptions start marker not found during consultations replacement!")
    else:
        print("WARNING: Consultations start marker not found!")

    # 5. Replace the prescriptions tab content block
    # Note: we need to find the prescriptions tab block. It starts at {/* PRESCRIPTIONS */} and ends with first instance of "</div>\n                      )}\n\n                    </div>\n                  </div>\n                </div>\n              </motion.div>"
    # Let's locate is using find
    rx_start_idx = content.find('{/* PRESCRIPTIONS */}')
    if rx_start_idx != -1:
        end_marker = "</div>\n                      )}\n\n                    </div>"
        rx_end_offset = content.find(end_marker, rx_start_idx)
        if rx_end_offset != -1:
            # Replaced the content
            old_prescriptions_block = content[rx_start_idx:rx_end_offset + len("</div>\n                      )}")]
            content = content.replace(old_prescriptions_block, config["prescriptions_tab"])
            print("-> Replaced prescriptions tab HTML")
        else:
            print("WARNING: Prescriptions end marker not found!")
    else:
        print("WARNING: Prescriptions start marker not found!")

    # 6. Apply simple text replacements for general customization
    for src, dest in config["replacements"]:
        content = content.replace(src, dest)
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Finished {dash_name} dashboard successfully!\n")

print("All updates completed successfully!")
