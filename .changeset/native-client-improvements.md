---
"@effect-kit/redis": patch
---

Add typed values-only batches and reusable compiled command plans. Improve native command, pipeline and transaction performance with fewer allocations, direct batch decoding, bounded reply draining and more efficient RESP buffering.

Enable combined queue/EXEC submission for explicit standalone Redis and Valkey profiles after MULTI succeeds. Preserve typed errors, binary ownership, interruption, scoped cleanup and indexed delivery evidence. Prevent immediate reacquisition from starving queued session and blocking leases.
