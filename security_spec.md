# Security Specification - Cascavel Fire

## Data Invariants
- A student must have non-negative scores.
- A log entry must correctly reference a student and have a timestamp.
- The global config (`/config/global`) contains the shared logo.

## The Dirty Dozen (Threat Vectors)
1. Unauthorized Data Wipe: A non-authenticated user tries to delete all students.
2. Negative Score Injection: Setting posScore to -500.
3. ID Poisoning: Injecting 1MB strings as student IDs.
4. Identity Spoofing: Creating a log entry as another user (though we use simplified rules for this unit).
5. Massive Data Injection: Creating a student with a name that is 1MB string.
6. Schema Violation: Adding a `isAdmin` field to a student record.
7. Future Timestamps: Setting `addedAt` to the year 2099.
8. Orphaned Logs: Creating a log entry for a non-existent student.
9. Configuration Hijacking: Non-admins changing the logo (In this first version, we'll allow authenticated users).
10. Rapid-Fire Writes: Denial of Wallet via massive student creation.
11. Reading PII: (No PII currently besides names).
12. Bulk List Scraping: Unauthorized listing of history.

## The Test Runner
`firestore.rules.test.ts` will verify these constraints.
