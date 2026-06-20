import os
import mariadb
import bcrypt

db_host = "gateway01.ap-southeast-1.prod.aws.tidbcloud.com"
db_port = 4000
db_user = "Q2KCvyDGKFFGWYC.root"
db_password = "Vti3a3KAnPc9C4Cm"
db_name = "mediflowai"

try:
    conn = mariadb.connect(
        host=db_host,
        port=db_port,
        user=db_user,
        password=db_password,
        database=db_name,
        ssl_verify_cert=False
    )
    cursor = conn.cursor(dictionary=True)
    print("Successfully connected to DB!")

    # Check users
    cursor.execute("SELECT id, name, email, phone, tenantId FROM User LIMIT 5")
    users = cursor.fetchall()
    print("\nMain Users (Tenants):")
    for u in users:
        print(u)

    # Check sub-users
    cursor.execute("SELECT id, name, email, phone, role, tenantId, isActive FROM SubUser LIMIT 10")
    sub_users = cursor.fetchall()
    print("\nSubUsers:")
    for su in sub_users:
        print(su)

    cursor.close()
    conn.close()
except Exception as e:
    print("Error:", e)
