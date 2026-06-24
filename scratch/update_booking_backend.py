import os

filepath = r"c:\Users\swapn\Downloads\HealthSync AI\src\lib\booking.ts"

with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace clinic resolution to fetch profession
target_resolution = """    // 1. Resolve clinic details
    let clinicName = "";
    const profile = await queryOne<any>("SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    if (profile) {
      clinicName = profile.clinicName;
    } else {
      const userClinic = await queryOne<any>("SELECT clinicName FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
      if (!userClinic) throw new Error("Clinic not found");
      clinicName = userClinic.clinicName;
    }"""

replacement_resolution = """    // 1. Resolve clinic details and business profession
    let clinicName = "";
    let profession = "Healthcare and medical";
    const profile = await queryOne<any>("SELECT clinicName FROM ClinicProfile WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    const userClinic = await queryOne<any>("SELECT clinicName, profession FROM User WHERE tenantId = ? LIMIT 1", [data.tenantId]);
    if (userClinic) {
      profession = userClinic.profession || "Healthcare and medical";
      clinicName = profile ? profile.clinicName : userClinic.clinicName;
    } else if (profile) {
      clinicName = profile.clinicName;
    } else {
      throw new Error("Clinic not found");
    }"""

if target_resolution in content:
    content = content.replace(target_resolution, replacement_resolution)
    print("Successfully replaced clinic resolution block")
else:
    # Fallback to loose check
    print("WARNING: Exact clinic resolution block not found")

# 2. Replace return block
target_return = """    return {
      clinicName: clinicName,
      departments,
      doctors,
      slots
    };"""

replacement_return = """    return {
      clinicName: clinicName,
      profession: profession,
      departments,
      doctors,
      slots
    };"""

if target_return in content:
    content = content.replace(target_return, replacement_return)
    print("Successfully replaced return block")
else:
    print("WARNING: Exact return block not found")

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Finished processing booking.ts")
