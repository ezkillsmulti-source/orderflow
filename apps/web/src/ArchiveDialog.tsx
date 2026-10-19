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
  close: (refresh?: boolean) => void;
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
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        // Keep focus on the action buttons before browser chrome enters the tab order.
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        );
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      aria-labelledby="archive-title"
      aria-describedby="archive-product archive-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close(Boolean(error?.uncertain));
      }}
    >
      <p className="eyebrow">Catalog action</p>
      <h2 id="archive-title">Archive product?</h2>
      <p className="archive-product" id="archive-product">
        {data.name}
      </p>
      <p className="warning" id="archive-description">
        The product will remain available to read. It cannot be edited or
        reactivated after archival.
      </p>
      <ErrorNotice error={error} />
      <div className="row actions">
        <button
          ref={cancel}
          onClick={() => close(Boolean(error?.uncertain))}
          disabled={busy}
        >
          {error?.uncertain ? 'Check product status' : 'Keep product active'}
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
