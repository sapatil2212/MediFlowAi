import os

files_to_fix = {
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\beauty.tsx": [
        ("getAll clientsServerFn", "getPatientsServerFn"),
        ("mockAll clients", "mockPatients"),
        ("setAll clientsList", "setPatientsList"),
        ("setAll clientsTotal", "setPatientsTotal"),
        ("setAll clientsPage", "setPatientsPage"),
        ("loadingAll clients", "loadingPatients"),
        ("setLoadingAll clients", "setLoadingPatients"),
        ("fetchAll clients", "fetchPatients"),
        ("filteredAll clients", "filteredPatients"),
        ("dashboardStats?.totalAll clients", "dashboardStats?.totalPatients"),
        ("totalAll clients", "totalPatients")
    ],
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\professional.tsx": [
        ("getAll clientsServerFn", "getPatientsServerFn"),
        ("mockAll clients", "mockPatients"),
        ("setAll clientsList", "setPatientsList"),
        ("setAll clientsTotal", "setPatientsTotal"),
        ("setAll clientsPage", "setPatientsPage"),
        ("loadingAll clients", "loadingPatients"),
        ("setLoadingAll clients", "setLoadingPatients"),
        ("fetchAll clients", "fetchPatients"),
        ("filteredAll clients", "filteredPatients"),
        ("dashboardStats?.totalAll clients", "dashboardStats?.totalPatients"),
        ("totalAll clients", "totalPatients")
    ],
    r"c:\Users\swapn\Downloads\HealthSync AI\src\routes\dashboards\education.tsx": [
        ("getStudentsServerFn", "getPatientsServerFn"),
        ("mockStudents", "mockPatients"),
        ("setStudentsList", "setPatientsList"),
        ("setStudentsTotal", "setPatientsTotal"),
        ("setStudentsPage", "setPatientsPage"),
        ("loadingStudents", "loadingPatients"),
        ("setLoadingStudents", "setLoadingPatients"),
        ("fetchStudents", "fetchPatients"),
        ("filteredStudents", "filteredPatients"),
        ("dashboardStats?.totalStudents", "dashboardStats?.totalPatients"),
        ("totalStudents", "totalPatients")
    ]
}

for filepath, replacements in files_to_fix.items():
    if not os.path.exists(filepath):
        print(f"File {filepath} not found!")
        continue
    
    print(f"Fixing variables in {filepath}...")
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
        
    original_len = len(content)
    for bad, good in replacements:
        content = content.replace(bad, good)
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Finished fixing {filepath}. Length: {original_len} -> {len(content)}")

print("All dashboard variable fixes applied!")
