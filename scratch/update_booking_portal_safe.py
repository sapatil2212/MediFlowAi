import os

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\book.$tenantId.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add profession state and isGym constant
target_states = """  // Clinic states
  const [clinicName, setClinicName] = useState("");
  const [fetchingClinic, setFetchingClinic] = useState(true);"""

replacement_states = """  // Clinic states
  const [clinicName, setClinicName] = useState("");
  const [profession, setProfession] = useState("Healthcare and medical");
  const [fetchingClinic, setFetchingClinic] = useState(true);
  const isGym = profession === "Fitness Gym etc";"""

if target_states in content:
    content = content.replace(target_states, replacement_states)
    print("Replaced clinic states block")
else:
    print("WARNING: Clinic states block not found")

# 2. Update clinic info fetch
target_fetch = """    getClinicInfoAndSlotsServerFn({
      data: { tenantId }
    })
      .then((res) => {
        setClinicName(res.clinicName);
        setDepartments(res.departments || []);
        setDoctors(res.doctors || []);
      })"""

replacement_fetch = """    getClinicInfoAndSlotsServerFn({
      data: { tenantId }
    })
      .then((res) => {
        setClinicName(res.clinicName);
        setProfession(res.profession || "Healthcare and medical");
        setDepartments(res.departments || []);
        setDoctors(res.doctors || []);
      })"""

if target_fetch in content:
    content = content.replace(target_fetch, replacement_fetch)
    print("Replaced clinic info fetch block")
else:
    print("WARNING: Clinic info fetch block not found")

# 3. Update validation rules in handleBookingSubmit
target_validation = """    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Patient Name is required";
    
    if (!email.trim()) {
      newErrors.email = "Email Address is required";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }
    
    if (!phone.trim()) {
      newErrors.phone = "Phone Number is required";
    } else if (!/^\+?[\d\s-]{10,15}$/.test(phone)) {
      newErrors.phone = "Please enter a valid contact number (10-15 digits)";
    }
    
    if (!selectedDeptId) newErrors.department = "Department is required";
    if (!selectedDoctorId) newErrors.doctor = "Doctor is required";
    if (!selectedDate) newErrors.date = "Appointment Date is required";
    if (!selectedSlot) newErrors.timeSlot = "Appointment Time is required";
    if (!appointmentType) newErrors.appointmentType = "Appointment Type is required";
    if (!reason.trim()) newErrors.reason = "Reason for visit is required";"""

replacement_validation = """    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = isGym ? "Client Name is required" : "Patient Name is required";
    
    if (!email.trim()) {
      newErrors.email = "Email Address is required";
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = "Please enter a valid email address";
    }
    
    if (!phone.trim()) {
      newErrors.phone = "Phone Number is required";
    } else if (!/^\+?[\d\s-]{10,15}$/.test(phone)) {
      newErrors.phone = "Please enter a valid contact number (10-15 digits)";
    }
    
    if (!selectedDeptId) newErrors.department = isGym ? "Program category is required" : "Department is required";
    if (!selectedDoctorId) newErrors.doctor = isGym ? "Trainer is required" : "Doctor is required";
    if (!selectedDate) newErrors.date = isGym ? "Session Date is required" : "Appointment Date is required";
    if (!selectedSlot) newErrors.timeSlot = isGym ? "Session Time is required" : "Appointment Time is required";
    if (!appointmentType) newErrors.appointmentType = isGym ? "Session Type is required" : "Appointment Type is required";
    if (!reason.trim()) newErrors.reason = isGym ? "Training goals are required" : "Reason for visit is required";"""

if target_validation in content:
    content = content.replace(target_validation, replacement_validation)
    print("Replaced validation logic")
else:
    print("WARNING: Validation logic block not found")

# 4. Modify loading screen text
content = content.replace('Loading clinic workspace details...', '{isGym ? "Loading gym workspace details..." : "Loading clinic workspace details..."}')

# 5. Modify clinic error screen
content = content.replace('<h2 className="text-sm font-bold text-zinc-900">Clinic Portal Not Found</h2>', '<h2 className="text-sm font-bold text-zinc-900">{isGym ? "Booking Portal Not Found" : "Clinic Portal Not Found"}</h2>')
content = content.replace('The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again.', '{isGym ? "The booking link you followed seems to be invalid or the gym does not exist. Please check the URL and try again." : "The booking link you followed seems to be invalid or the clinic does not exist. Please check the URL and try again."}')

# 6. Success Screen text replacements
content = content.replace('Appointment Scheduled!', '{isGym ? "Training Session Scheduled!" : "Appointment Scheduled!"}')
content = content.replace('Your appointment at <strong className="text-zinc-700">{clinicName}</strong> has been successfully booked.', 'Your {isGym ? "session" : "appointment"} at <strong className="text-zinc-700">{clinicName}</strong> has been successfully booked.')
content = content.replace('<span className="text-zinc-400 font-bold uppercase text-[9px]">Patient Name</span>', '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Client Name" : "Patient Name"}</span>')
content = content.replace('<span className="text-zinc-400 font-bold uppercase text-[9px]">Provider / Doctor</span>', '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Coach / Trainer" : "Provider / Doctor"}</span>')
content = content.replace('<span className="text-zinc-400 font-bold uppercase text-[9px]">Appointment Type</span>', '<span className="text-zinc-400 font-bold uppercase text-[9px]">{isGym ? "Session Type" : "Appointment Type"}</span>')
content = content.replace('Please arrive 15 minutes before your scheduled slot.', '{isGym ? "Please arrive 10 minutes before your scheduled session." : "Please arrive 15 minutes before your scheduled slot."}')

# 7. Form Screen text replacements
content = content.replace('Book an Appointment', '{isGym ? "Book a Session" : "Book an Appointment"}')
content = content.replace('Scheduling online portal for <strong className="text-brand">{clinicName}</strong>', '{isGym ? "Booking portal for " : "Scheduling online portal for "}<strong className="text-brand">{clinicName}</strong>')
content = content.replace('<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Patient Full Name</label>', '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Client Full Name" : "Patient Full Name"}</label>')

# Appointment Type label
content = content.replace('<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Appointment Type</label>', '<label className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{isGym ? "Session Type" : "Appointment Type"}</label>')
content = content.replace('{appointmentType ? appointmentType : "Select Type"}', '{appointmentType ? appointmentType : (isGym ? "Select Session Type" : "Select Type")}')

# Options array mapping
target_options = '["First Time", "Follow up"]'
replacement_options = '(isGym ? ["Trial Session", "Regular Training"] : ["First Time", "Follow up"])'
content = content.replace(target_options, replacement_options)

# Departments & Doctors select fields
content = content.replace('Select Department', '{isGym ? "Select Program Category" : "Select Department"}')
content = content.replace('{selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.name : "Select Department"}', '{selectedDeptId ? departments.find(d => d.id === selectedDeptId)?.name : (isGym ? "Select Program" : "Select Department")}')

content = content.replace('Select Doctor', '{isGym ? "Select Trainer / Coach" : "Select Doctor"}')
content = content.replace('{selectedDoctorId ? doctors.find(d => d.id === selectedDoctorId)?.name : "Select Doctor"}', '{selectedDoctorId ? doctors.find(d => d.id === selectedDoctorId)?.name : (isGym ? "Select Trainer" : "Select Doctor")}')

# Qualifications & Appointment Date
content = content.replace('Qualifications: <strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>', '{isGym ? "Credentials: " : "Qualifications: "}<strong className="text-zinc-650">{selectedDoctor.qualifications}</strong>')
content = content.replace('Select Appointment Date', '{isGym ? "Select Session Date" : "Select Appointment Date"}')

# Reason for visit / Chief complaint
content = content.replace('Reason for Visit / Chief Complaint', '{isGym ? "Training Goals / Focus Area" : "Reason for Visit / Chief Complaint"}')
content = content.replace('placeholder="Brief details of your symptoms"', 'placeholder={isGym ? "e.g. weight loss, build muscle, stamina" : "Brief details of your symptoms"}')

# Submit button text
content = content.replace('Schedule Appointment', '{isGym ? "Schedule Session" : "Schedule Appointment"}')

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished processing book.$tenantId.tsx")
