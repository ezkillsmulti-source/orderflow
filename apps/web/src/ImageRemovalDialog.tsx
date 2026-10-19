import { useEffect, useRef, useState } from 'react';
import { ApiError, Cancelled, session } from './api';
import type { Product } from './catalog-data';
import { ErrorNotice, useCooldown } from './feedback';

export function ImageRemovalDialog({
  data,
  close,
  removed,
}: {
  data: Product;
  close: (refresh?: boolean) => void;
  removed: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const blocked = useCooldown(error);
  const checkState = Boolean(error?.uncertain || error?.status === 409);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    alive.current = true;
    modal?.showModal();
    cancel.current?.focus();
    return () => {
      alive.current = false;
      modal?.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    if (error && !busy) cancel.current?.focus();
  }, [error, busy]);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await session.request(`/products/${data.id}/image`, 'DELETE');
      if (alive.current) removed();
    } catch (error) {
      if (alive.current && !(error instanceof Cancelled))
        setError(
          error instanceof ApiError
            ? error.status === 409
              ? Object.assign(new ApiError(409), {
                  message:
                    'The product may have been archived. Check its status before changing the image.',
                })
              : error
            : new ApiError(0, true),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="remove-image-title"
      aria-describedby="remove-image-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close(checkState);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        );
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (!first || !last) event.preventDefault();
        else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <h2 id="remove-image-title">Remove product image?</h2>
      <p className="archive-product">{data.name}</p>
      <p id="remove-image-description">
        The current image will no longer appear in the catalog. Product
        information will stay unchanged.
      </p>
      <ErrorNotice error={error} />
      <div className="row actions">
        <button ref={cancel} disabled={busy} onClick={() => close(checkState)}>
          {checkState ? 'Check image status' : 'Keep image'}
        </button>
        <button
          className="danger"
          disabled={busy || blocked || checkState}
          onClick={() => {
            void submit();
          }}
        >
          {busy ? 'Removing…' : 'Remove image'}
        </button>
      </div>
    </dialog>
  );
}
