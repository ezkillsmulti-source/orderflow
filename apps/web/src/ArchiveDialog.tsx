import { useEffect, useRef, useState } from 'react';
import { ApiError, Cancelled, session } from './api';
import { product, type Product } from './catalog-data';
import { ErrorNotice, useCooldown } from './feedback';

export function ArchiveDialog({
  data,
  close,
  archived,
}: {
  data: Product;
  close: () => void;
  archived: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const blocked = useCooldown(error);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    alive.current = true;
    dialog.current?.showModal();
    cancel.current?.focus();
    return () => {
      alive.current = false;
      dialog.current?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await session.request<unknown>(
        `/products/${data.id}/archive`,
        'POST',
      );
      try {
        if (product(result).active) throw new Error();
      } catch {
        throw new ApiError(502, true);
      }
      if (alive.current) archived();
    } catch (error) {
      if (alive.current && !(error instanceof Cancelled))
        setError(error instanceof ApiError ? error : new ApiError(0, true));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="archive-title"
      aria-describedby="archive-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 id="archive-title">Archive {data.name}?</h2>
      <p id="archive-description">
        The product will remain available to read. It cannot be edited or
        reactivated after archival.
      </p>
      <ErrorNotice error={error} />
      <div className="row actions">
        <button ref={cancel} onClick={close} disabled={busy}>
          Keep product active
        </button>
        <button
          className="danger"
          onClick={() => {
            void submit();
          }}
          disabled={busy || blocked}
        >
          {busy ? 'Archiving…' : 'Archive product'}
        </button>
      </div>
    </dialog>
  );
}
