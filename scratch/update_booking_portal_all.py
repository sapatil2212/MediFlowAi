import os

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\book.$tenantId.tsx"

if not os.path.exists(filepath):
    print("Error: book.$tenantId.tsx not found")
    exit(1)

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update flags declaration
target_flags = """  const isGym = profession === "Fitness Gym etc" || (tenantId ? tenantId.startsWith("gym-") : false);
  const isEducation = profession === "Education institutions" || (tenantId ? tenantId.startsWith("edu-") : false);"""

replacement_flags = """  const isGym = profession === "Fitness Gym etc" || (tenantId ? tenantId.startsWith("gym-") : false);
  const isEducation = profession === "Education institutions" || (tenantId ? tenantId.startsWith("edu-") : false);
  const isBeauty = profession === "Beauty and wellness" || (tenantId ? tenantId.startsWith("beauty-") : false);
  const isProfessional = profession === "Professional services like law, consultant, real estate, CA" || (tenantId ? tenantId.startsWith("prof-") : false);"""

if target_flags in content:
    content = content.replace(target_flags, replacement_flags)
    print("Updated profession flags")
else:
    print("WARNING: Profession flags block not found")

# 2. Update name validation error
target_name_val = 'if (!name.trim()) newErrors.name = isGym ? "Client Name is required" : "Patient Name is required";'
replacement_name_val = 'if (!name.trim()) newErrors.name = (isGym || isBeauty || isProfessional) ? "Client Name is required" : isEducation ? "Student Name is required" : "Patient Name is required";'
content = content.replace(target_name_val, replacement_name_val)

# 3. Update date validation error
target_date_val = 'if (!selectedDate) newErrors.date = isGym ? "Session Date is required" : "Appointment Date is required";'
replacement_date_val = 'if (!selectedDate) newErrors.date = (isGym || isEducation) ? "Session Date is required" : isBeauty ? "Service Date is required" : isProfessional ? "Consultation Date is required" : "Appointment Date is required";'
content = content.replace(target_date_val, replacement_date_val)

# 4. Update time slot validation error
target_time_val = """    if (!isEducation && !isGym) {
      if (!selectedSlot) newErrors.timeSlot = "Appointment Time is required";
    }"""
replacement_time_val = """    if (!isEducation && !isGym) {
      if (!selectedSlot) newErrors.timeSlot = isBeauty ? "Service Time is required" : isProfessional ? "Consultation Time is required" : "Appointment Time is required";
    }"""
content = content.replace(target_time_val, replacement_time_val)

# 5. Update appointment type validation error
target_type_val = 'if (!appointmentType) newErrors.appointmentType = isGym ? "Session Type is required" : "Appointment Type is required";'
replacement_type_val = 'if (!appointmentType) newErrors.appointmentType = isGym ? "Session Type is required" : isBeauty ? "Service Type is required" : isProfessional ? "Consultation Type is required" : "Appointment Type is required";'
content = content.replace(target_type_val, replacement_type_val)

# 6. Update reason validation error
target_reason_val = 'if (!reason.trim()) newErrors.reason = isGym ? "Training goals are required" : isEducation ? "Purpose of visit is required" : "Reason for visit is required";'
replacement_reason_val = 'if (!reason.trim()) newErrors.reason = isGym ? "Training goals are required" : isEducation ? "Purpose of visit is required" : isBeauty ? "Service requests are required" : isProfessional ? "Consultation objectives are required" : "Reason for visit is required";'
content = content.replace(target_reason_val, replacement_reason_val)

# 7. Update loading text
target_loading = '{isGym ? "Loading gym workspace details..." : "Loading clinic workspace details..."}'
replacement_loading = '{isGym ? "Loading gym workspace details..." : isEducation ? "Loading academy workspace details..." : isBeauty ? "Loading salon workspace details..." : isProfessional ? "Loading firm workspace details..." : "Loading clinic workspace details..."}'
content = content.replace(target_loading, replacement_loading)

# 8. Update clinic error screen title and desc
target_error_title = '<h2 className="text-sm font-bold text-zinc-900">{isGym ? "Booking Portal Not Found" : "Clinic Portal Not Found"}</h2>'
replacement_error_title = '<h2 className="text-sm font-bold text-zinc-900">{isGym ? "Gym Portal Not Found" : isEducation ? "Academy Portal Not Found" : isBeauty ? "Salon Portal Not Found" : isProfessional ? "Firm Portal Not Found" : "Clinic Portal Not Found"}</h2>'
content = content.replace(target_error_title, replacement_error_title)

target_error_desc = '{isGym ? "The booking link you followed seems to be invalid or the gym does not exist. Please check the URL and try again." : "The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again."}'
replacement_error_desc = '{isGym ? "The booking link you followed seems to be invalid or the gym does not exist. Please check the URL and try again." : isEducation ? "The booking link you followed seems to be invalid or the academy does not exist. Please check the URL and try again." : isBeauty ? "The booking link you followed seems to be invalid or the salon/spa does not exist. Please check the URL and try again." : isProfessional ? "The booking link you followed seems to be invalid or the firm does not exist. Please check the URL and try again." : "The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again."}'
content = content.replace(target_error_desc, replacement_error_desc)

# 9. Success screen modifications
target_success_title = '<h2 className="text-lg font-bold text-zinc-900">{isGym ? "Training Session Scheduled!" : "Appointment Scheduled!"}</h2>'
replacement_success_title = '<h2 className="text-lg font-bold text-zinc-900">{isGym ? "Training Session Scheduled!" : isEducation ? "Session Booked!" : isBeauty ? "Service Scheduled!" : isProfessional ? "Consultation Scheduled!" : "Appointment Scheduled!"}</h2>'
content = content.replace(target_success_title, replacement_success_title)

target_success_desc = "Your {isGym ? \"session\" : \"appointment\"} at <strong className=\"text-zinc-700\">{clinicName}</strong> has been successfully booked."
replacement_success_desc = "Your {isGym ? \"session\" : isEducation ? \"class/session\" : isBeauty ? \"service\" : isProfessional ? \"consultation\" : \"appointment\"} at <strong className=\"text-zinc-700\">{clinicName}</strong> has been successfully booked."
content = content.replace(target_success_desc, replacement_success_desc)

target_patient_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Client Name" : "Patient Name"}</span>'
replacement_patient_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Client Name" : isEducation ? "Student Name" : (isBeauty || isProfessional) ? "Client Name" : "Patient Name"}</span>'
content = content.replace(target_patient_label, replacement_patient_label)

target_provider_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Coach / Trainer" : "Provider / Doctor"}</span>'
replacement_provider_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Coach / Trainer" : isEducation ? "Teacher / Instructor" : isBeauty ? "Stylist / Therapist" : isProfessional ? "Advisor / Consultant" : "Provider / Doctor"}</span>'
content = content.replace(target_provider_label, replacement_provider_label)

target_type_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Session Type" : "Appointment Type"}</span>'
replacement_type_label = '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Session Type" : isBeauty ? "Service Type" : isProfessional ? "Consultation Type" : "Appointment Type"}</span>'
content = content.replace(target_type_label, replacement_type_label)

target_arrival_note = 'A confirmation has been sent to your registered contact details. {isGym ? "Please arrive 10 minutes before your scheduled session." : "Please arrive 15 minutes before your scheduled slot."}'
replacement_arrival_note = 'A confirmation has been sent to your registered contact details. {isGym ? "Please arrive 10 minutes before your scheduled session." : isEducation ? "Please arrive 5 minutes before your class." : isBeauty ? "Please arrive 10 minutes before your scheduled service." : isProfessional ? "Please arrive 5 minutes before your consultation." : "Please arrive 15 minutes before your scheduled slot."}'
content = content.replace(target_arrival_note, replacement_arrival_note)

# 10. Form header modifications
target_form_title = '<h1 className="text-lg font-bold text-zinc-900">Book Appointment</h1>'
replacement_form_title = '<h1 className="text-lg font-bold text-zinc-900">{isGym ? "Book Session" : isEducation ? "Book Session" : isBeauty ? "Book Service" : isProfessional ? "Book Consultation" : "Book Appointment"}</h1>'
content = content.replace(target_form_title, replacement_form_title)

# Heart pulse container
target_pulse = """                {!isGym && !isEducation && (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light mx-auto">
                    <HeartPulse className="h-5 w-5 text-white" />
                  </div>
                )}"""
replacement_pulse = """                {!isGym && !isEducation && !isBeauty && !isProfessional && (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light mx-auto">
                    <HeartPulse className="h-5 w-5 text-white" />
                  </div>
                )}"""
content = content.replace(target_pulse, replacement_pulse)

# Portal description text
target_portal_desc = """                  {!isGym && !isEducation && (
                    <p className="text-xs text-zinc-400">
                      Scheduling online portal for <strong className="text-brand">{clinicName}</strong>
                    </p>
                  )}"""
replacement_portal_desc = """                  <p className="text-xs text-zinc-400">
                    {isGym ? "Booking portal for " : isEducation ? "Academy scheduling portal for " : isBeauty ? "Salon booking portal for " : isProfessional ? "Firm consultation portal for " : "Scheduling online portal for "}<strong className="text-brand">{clinicName}</strong>
                  </p>"""
content = content.replace(target_portal_desc, replacement_portal_desc)

# 11. Form input labels and dropdown modifications
target_fullname_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Full Name" : isEducation ? "Student / Visitor Full Name" : "Patient Full Name"}</label>'
replacement_fullname_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Full Name" : isEducation ? "Student / Visitor Full Name" : (isBeauty || isProfessional) ? "Client Full Name" : "Patient Full Name"}</label>'
content = content.replace(target_fullname_label, replacement_fullname_label)

target_type_label_form = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Session Type" : "Appointment Type"}</label>'
replacement_type_label_form = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Session Type" : isBeauty ? "Service Type" : isProfessional ? "Consultation Type" : "Appointment Type"}</label>'
content = content.replace(target_type_label_form, replacement_type_label_form)

target_select_type_val = '{appointmentType ? appointmentType : (isGym ? "Select Session Type" : "Select Type")}'
replacement_select_type_val = '{appointmentType ? appointmentType : (isGym ? "Select Session Type" : isBeauty ? "Select Service Type" : isProfessional ? "Select Consultation Type" : "Select Type")}'
content = content.replace(target_select_type_val, replacement_select_type_val)

target_options_arr = '(isGym ? ["Trial Session", "Regular Training"] : ["First Time", "Follow up"])'
replacement_options_arr = '(isGym ? ["Trial Session", "Regular Training"] : isBeauty ? ["Standard Service", "Premium Treatment"] : isProfessional ? ["Initial Consultation", "Follow-up Advisory"] : ["First Time", "Follow up"])'
content = content.replace(target_options_arr, replacement_options_arr)

# Select Department/Category
target_dept_label_beauty = 'Select Department'
content = content.replace('<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Department</label>', '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isBeauty ? "Select Service Category" : isProfessional ? "Select Practice Area" : "Select Department"}</label>')

target_select_dept_ph = '{selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.name : "Select Department"}'
replacement_select_dept_ph = '{selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.name : (isBeauty ? "Select Service Category" : isProfessional ? "Select Practice Area" : "Select Department")}'
content = content.replace(target_select_dept_ph, replacement_select_dept_ph)

# Select Doctor/Stylist/Advisor
content = content.replace('<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Select Doctor</label>', '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isBeauty ? "Select Stylist / Therapist" : isProfessional ? "Select Advisor / Consultant" : "Select Doctor"}</label>')

target_select_doc_ph = '{selectedDoctorId ? doctors.find(d => d.id === selectedDoctorId)?.name : "Select Doctor"}'
replacement_select_doc_ph = '{selectedDoctorId ? doctors.find(d => d.id === selectedDoctorId)?.name : (isBeauty ? "Select Stylist / Therapist" : isProfessional ? "Select Advisor / Consultant" : "Select Doctor")}'
content = content.replace(target_select_doc_ph, replacement_select_doc_ph)

target_doc_qual = '{isGym ? "Credentials: " : "Qualifications: "}<strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>'
replacement_doc_qual = '{isGym ? "Credentials: " : isBeauty ? "Specialty: " : isProfessional ? "Expertise: " : "Qualifications: "}<strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>'
content = content.replace(target_doc_qual, replacement_doc_qual)

# Select Date
target_date_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Select Session Date" : "Select Date"}</label>'
replacement_date_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Select Session Date" : isEducation ? "Select Date" : isBeauty ? "Select Service Date" : isProfessional ? "Select Consultation Date" : "Select Date"}</label>'
content = content.replace(target_date_label, replacement_date_label)

# Select Time Slot Placeholder
target_time_slot_ph = '{selectedSlot ? selectedSlot : "Select Time Slot"}'
replacement_time_slot_ph = '{selectedSlot ? selectedSlot : (isBeauty ? "Select Service Time" : isProfessional ? "Select Consultation Time" : "Select Time Slot")}'
content = content.replace(target_time_slot_ph, replacement_time_slot_ph)

# Reason field
target_reason_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Training Goals / Focus Area" : isEducation ? "Purpose of Visit" : "Reason for Visit / Chief Complaint"}</label>'
replacement_reason_label = '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Training Goals / Focus Area" : isEducation ? "Purpose of Visit" : isBeauty ? "Service Requests / Style Goals" : isProfessional ? "Consultation Objectives" : "Reason for Visit / Chief Complaint"}</label>'
content = content.replace(target_reason_label, replacement_reason_label)

target_reason_ph = 'placeholder={isGym ? "e.g. weight loss, build muscle, stamina" : isEducation ? "e.g. academic counselling, exam inquiry, subject query" : "Brief details of your symptoms"}'
replacement_reason_ph = 'placeholder={isGym ? "e.g. weight loss, build muscle, stamina" : isEducation ? "e.g. academic counselling, exam inquiry, subject query" : isBeauty ? "e.g. haircut, facial, hair coloring, massage" : isProfessional ? "e.g. tax advisory, business coaching, contract review" : "Brief details of your symptoms"}'
content = content.replace(target_reason_ph, replacement_reason_ph)

# Submit button text
target_submit_btn = '{isGym ? "Schedule Session" : isEducation ? "Book Appointment" : "Schedule Appointment"}'
replacement_submit_btn = '{isGym ? "Schedule Session" : isEducation ? "Book Appointment" : isBeauty ? "Book Service" : isProfessional ? "Schedule Consultation" : "Schedule Appointment"}'
content = content.replace(target_submit_btn, replacement_submit_btn)


with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished modifying book.$tenantId.tsx successfully!")
