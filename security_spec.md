# Security Specification — Digital Logbook Perawat Hemodialisa

## 1. Data Invariants
1. **Identity Integrity**: Every user document `/users/{userId}` and `/staff_directory/{userId}` is keyed by Firebase Auth UID. A non-admin user cannot assign themselves `Administrator`, `Managerial`, `Kepala Ruang`, or `PJ Shift` roles during self-registration, nor escalate their `role` or `isActive` flag on update.
2. **PII Isolation**: User email, phone, and NIP reside in `/users/{userId}` (readable only by owner or `Administrator`). Non-PII operational team lookups reside in `/staff_directory/{userId}`.
3. **Logbook Ownership & Referential Integrity**: A logbook entry `/logbook/{logbookId}` cannot be created unless `nurseId == request.auth.uid`, initial `verificationStatus == 'Pending'`, and referenced `patientId`, `machineId`, and `doctorId` documents exist.
4. **Terminal State Locking**: Once a logbook entry reaches `verificationStatus == 'Approved'`, the creating nurse can no longer edit it. Only `PJ Shift`, `Kepala Ruang`, or `Administrator` can transition verification status, and only `Administrator` can delete logbook entries.
5. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps must match server `request.time`. `createdAt` is immutable on update.

## 2. The "Dirty Dozen" Payloads (Expected `PERMISSION_DENIED`)
1. **Self-Privilege Escalation on Create**: Nurse creates `/users/{uid}` with `role: "Administrator"`.
2. **Self-Privilege Escalation on Update**: Nurse updates `/users/{uid}` changing `role` to `"Kepala Ruang"`.
3. **PII Read Leak**: Nurse A calls `get(/users/{nurseBUid})` to read Nurse B's email/phone/NIP.
4. **Ghost Field Injection**: User creates `/logbook/{id}` with extra field `isVerified: true` or `adminOverride: true`.
5. **Logbook Identity Spoofing**: Nurse A creates `/logbook/{id}` with `nurseId: "{nurseBUid}"`.
6. **Logbook Self-Approval on Create**: Nurse creates `/logbook/{id}` with `verificationStatus: "Approved"`.
7. **Logbook Self-Approval on Update**: Nurse updates own `Pending` logbook to `verificationStatus: "Approved"`.
8. **Post-Approval Tampering**: Nurse updates an `Approved` logbook entry's `ufAchieved` or `nursingNotes`.
9. **Unauthorized Logbook Deletion**: `Perawat Pelaksana` or `PJ Shift` attempts `delete(/logbook/{id})`.
10. **Email Spoofing Admin Bypass**: Attacker signs in with `email: "muhammadhaikalmalilang@gmail.com"` and `email_verified: false`.
11. **Resource Exhaustion / ID Poisoning**: Client writes `/patients/{200-char-invalid-id}` or 50KB string into `fullName`.
12. **Timestamp Forgery**: Client creates `/logbook/{id}` with backdated client `createdAt` instead of `request.time`.
