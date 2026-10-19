# ADR 0005: Private product image lifecycle

Status: accepted for milestone 4A backend.

One optional primary image belongs to a product. PostgreSQL stores ownership,
version, variant dimensions, and lifecycle state. Bytes reside in a private local
directory outside Git and web sources. Authenticated current-role checks protect
reads; no public static directory exists. Descriptor URLs are backend paths; a
future frontend adds `/api` exactly once. Image UI and galleries are deferred.

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
