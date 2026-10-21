# ADR 0005: Private product image lifecycle

Status: accepted for milestone 4A backend.

Follow-up note: the image frontend is included in the documented main baseline.
Its availability and inventory acceptance are tracked in
[project status](../project-status.md); the storage lifecycle decision is unchanged.

One optional primary image belongs to a product. PostgreSQL stores ownership,
version, variant dimensions, and lifecycle state. Bytes reside in a private local
directory outside Git and web sources. Authenticated current-role checks protect
reads; no public static directory exists. Descriptor URLs are backend paths; a
frontend adds `/api` exactly once. The backend increment deferred image UI to the
following frontend task; galleries remain deferred.

Candidates are registered PENDING before any files are written. Both variants must
be durable before publication. A short transaction locks the product, checks its
active state, retires the previous version, and publishes the candidate. Removal
and archive decisions use the same row lock; last successful publication wins.
The database and filesystem are not one atomic transaction. Registered candidates
and retirement state allow recovery without deleting the previous published image.

RETIRED candidates await cleanup. DELETING claims and DELETED tombstones make
cleanup retryable, including late files from previously paused requests. Tombstones
are retained; a future policy can compact them only after proving writers cannot
resume. Missing current files cause sanitized 503 errors and require recovery;
cleanup never removes a currently referenced image. Database and file backups must
be coordinated. Local disk requires persistent storage, shared by API replicas.
Object storage is deferred behind a focused product-image storage boundary.

The maintained Nest Express/Multer integration and sharp support this increment:
[Nest uploads](https://docs.nestjs.com/techniques/file-upload),
[Multer releases](https://github.com/expressjs/multer/releases),
[sharp installation](https://sharp.pixelplumbing.com/install/), and
[sharp processing timeout](https://sharp.pixelplumbing.com/api-output/#timeout).

Multer 2.4.0 (through Nest's FileInterceptor) handles multipart parsing. A small
byte-counting Transform uses Multer's supported streamHandler extension, preserving
JSON parser limits and avoiding a second multipart parser. Two in-flight upload
slots per process bound reception and native work. Rejected body drains also have a
receive deadline. sharp 0.35.5 supports the pinned Node 24 toolchain and native
processing timeouts; timeout errors are sanitized, not implemented as Promise.race.
APNG animation control chunks are rejected explicitly because image libraries can
otherwise return only the default PNG frame. No client-controlled path is used.

The CLI's default dry run is bounded; apply uses transactional claims, a 24-hour
safety age and retry lease, and reference exclusion. Publication checks candidate
state/expiry while updating it under the product lock, so cleanup cannot publish a
deleted candidate. Cleanup is not scheduled automatically. Host clocks must remain
synchronized. Database metadata tombstones currently grow; disk errors, missing
current files, and operational cleanup failures need operator attention. Native
processing budgets do not bound filesystem stalls or libuv queue waiting. Local
filesystem durability still depends on the host filesystem, persistent volume,
backup policy, and deployment topology.
