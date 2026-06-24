import os

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\gym.tsx"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update Mobile Drawer Navigation links to hide Consultation and rename Patient Records to All clients
target_mobile_nav = """                <nav className="space-y-1">
                  {[
                    { id: "overview", label: "Overview", icon: LayoutDashboard },
                    { id: "scribe", label: "Consultation", icon: ClipboardCheck },
                    { id: "calendar", label: "Calendar", icon: Calendar },
                    { id: "appointments", label: "Appointments List", icon: ClipboardList },
                    { id: "patients", label: "Patient Records", icon: Users },
                    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
                    { id: "settings", label: "Settings", icon: Settings },
                    { id: "plans", label: "Manage Plans", icon: CreditCard },
                  ].filter"""

replacement_mobile_nav = """                <nav className="space-y-1">
                  {[
                    { id: "overview", label: "Overview", icon: LayoutDashboard },
                    { id: "calendar", label: "Calendar", icon: Calendar },
                    { id: "appointments", label: "Appointments List", icon: ClipboardList },
                    { id: "patients", label: "All clients", icon: Users },
                    { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
                    { id: "settings", label: "Settings", icon: Settings },
                    { id: "plans", label: "Manage Plans", icon: CreditCard },
                  ].filter"""

if target_mobile_nav in content:
    content = content.replace(target_mobile_nav, replacement_mobile_nav)
    print("Updated mobile nav drawer")
else:
    print("WARNING: Mobile nav drawer block not found")

# 2. Update Desktop Navigation links to hide Consultation and rename Patient Records to All clients
target_desktop_nav = """          {/* Navigation Links */}
          <nav className="space-y-1">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "scribe", label: "Consultation", icon: ClipboardCheck },
              { id: "calendar", label: "Calendar", icon: Calendar },
              { id: "appointments", label: "Appointments List", icon: ClipboardList },
              { id: "patients", label: "Patient Records", icon: Users },
              { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { id: "settings", label: "Settings", icon: Settings },
              { id: "plans", label: "Manage Plans", icon: CreditCard },
            ].filter"""

replacement_desktop_nav = """          {/* Navigation Links */}
          <nav className="space-y-1">
            {[
              { id: "overview", label: "Overview", icon: LayoutDashboard },
              { id: "calendar", label: "Calendar", icon: Calendar },
              { id: "appointments", label: "Appointments List", icon: ClipboardList },
              { id: "patients", label: "All clients", icon: Users },
              { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
              { id: "settings", label: "Settings", icon: Settings },
              { id: "plans", label: "Manage Plans", icon: CreditCard },
            ].filter"""

if target_desktop_nav in content:
    content = content.replace(target_desktop_nav, replacement_desktop_nav)
    print("Updated desktop nav sidebar")
else:
    print("WARNING: Desktop nav sidebar block not found")

# 3. Simple text replacements for Patient tab content and Detailed Profile
replacements = [
    # General terms in settings & dashboard headers
    ('Patient Appointment Portal', 'Gym Session Booking Portal'),
    ('Clinic Departments', 'Program Categories'),
    ('Department Name', 'Program Category Name'),
    ('Search patient registry by name, ID, or symptoms...', 'Search client registry by name, ID, or goals...'),
    ('Add Patient File', 'Add Client File'),
    ('Edit Patient Registry File', 'Edit Client Profile'),
    ('Create New Patient Registry File', 'Create New Client Profile'),
    ('Patient Name', 'Client Name'),
    ('patient@example.com', 'client@example.com'),
    ('Patient ID', 'Client ID'),
    ('View Patient Member Profile', 'View Client Profile'),
    ('Edit Patient File', 'Edit Client File'),
    ('Delete Patient File', 'Delete Client File'),
    ('No patient profiles match your query.', 'No client profiles match your query.'),
    ('Loading registry profiles...', 'Loading client profiles...'),
    ('EHR Profile', 'Member Profile'),
    ('Chart ID:', 'Member ID:'),
    ('Patient Information', 'Client Information'),
    ('EHR Enrolled Date', 'Registration Date'),
    ('Consultation History', 'Training History'),
    ('Past SOAP Consultation Notes', 'Past Training Session Notes'),
    ('No clinical SOAP notes logged yet for this patient profile.', 'No training notes logged yet for this client profile.'),
    ('Prescriptions', 'Workout Plans'),
    ('Prescription Records', 'Workout & Progress Plans'),
    ('No clinical prescriptions mapped to this patient profile.', 'No workout plans mapped to this client profile.'),
    ('No prescriptions logged yet for this patient.', 'No workout plans logged yet for this client.'),
    ('Assigned Doctor', 'Assigned Trainer'),
    ('Chief Complaint', 'Training Goals'),
    ('Clinical Notes', 'Trainer Notes / Physical History'),
    
    # SOAP labels in training notes detailed cards
    ('<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Subjective</strong>',
     '<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Client Feedback</strong>'),
    ('<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Objective</strong>',
     '<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Trainer Observations</strong>'),
    ('<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Assessment</strong>',
     '<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Focus & Performance</strong>'),
    ('<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Plan</strong>',
     '<strong className="text-[9px] font-black uppercase text-zinc-400 tracking-wider block mb-0.5">Next Workout Target</strong>'),

    ('<h5 className="font-bold text-zinc-800">Subjective</h5>',
     '<h5 className="font-bold text-zinc-800">Client Feedback</h5>'),
    ('<h5 className="font-bold text-zinc-800">Objective</h5>',
     '<h5 className="font-bold text-zinc-800">Trainer Observations</h5>'),
    ('<h5 className="font-bold text-zinc-800">Assessment</h5>',
     '<h5 className="font-bold text-zinc-800">Focus & Performance</h5>'),
    ('<h5 className="font-bold text-zinc-800">Plan</h5>',
     '<h5 className="font-bold text-zinc-800">Next Workout Target</h5>'),

    # Settings: Doctors tab
    ('Add Doctor File', 'Add Trainer File'),
    ('No doctors registered. Register a provider profile above.', 'No coaches or trainers registered. Register a trainer profile above.'),
    ('Register New Doctor', 'Register New Trainer'),
    ('Edit Doctor Profile', 'Edit Trainer Profile'),
    ("Doctor's Full Name", "Trainer's Full Name"),
    ('Update Doctor', 'Update Trainer'),
    ('Register Doctor', 'Register Trainer'),
    ('watson@mediflowai.com', 'trainer@example.com'),
    ('MD, FACP - Family Medicine Specialist', 'Certified Personal Trainer, CrossFit Coach'),
    ('Clinic Booking QR Code', 'Gym Booking QR Code'),
    ('Display or print this QR code in your clinic.', 'Display or print this QR code in your gym.'),
    ('Patients can scan it', 'Members can scan it'),
    ('in your clinic', 'in your gym'),
    ('Brief symptoms narrative (e.g. chronic cough, migraine)', 'e.g. weight loss, build muscle, stamina'),
    ('Additional background history, allergies, medications', 'e.g. prior knee injury, active sports'),
    ('Department Assignment', 'Program Category Assignment'),
    ('Select Department', 'Select Category'),
    
    # Other workspace headers
    ('Workspace & Practice Management', 'Workspace & Gym Management'),
    ('Configure clinic profiles', 'Configure gym profiles'),
    ('Clinic Profile', 'Gym Profile'),
    ('Clinic Name', 'Gym Name'),
    ('Practice Size', 'Gym Size'),
    ('Clinician Name', 'Trainer Name'),
    ('Clinician Profile details', 'Trainer Profile details'),
    ('Clinician Dashboard — MediFlow AI', 'Gym Trainer Dashboard — MediFlow AI'),
    ('Verifying clinician session...', 'Verifying trainer session...'),
]

for src, dest in replacements:
    content = content.replace(src, dest)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished processing gym.tsx")
