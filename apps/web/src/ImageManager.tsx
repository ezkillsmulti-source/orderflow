import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, Cancelled, session } from './api';
import { product, type Product } from './catalog-data';
import { ErrorNotice, useCooldown } from './feedback';
import { imageFileError, ImagePreview } from './image-selection';
import { ImageRemovalDialog } from './ImageRemovalDialog';

export function ImageManager({
  data,
  refresh,
}: {
  data: Product;
  refresh: (notice?: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const previewOwner = useRef(new ImagePreview());
  const alive = useRef(true);
  const check = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<{ file: File; url: string }>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [validation, setValidation] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState(false);
  const blocked = useCooldown(error);
  const uncertain = Boolean(error?.uncertain);
  const invalid =
    Boolean(validation) ||
    Boolean(error && [400, 413, 415, 422].includes(error.status));
  useEffect(() => {
    const owner = previewOwner.current;
    alive.current = true;
    return () => {
      alive.current = false;
      owner.clear();
    };
  }, []);
  useEffect(() => {
    if (error && !busy) {
      if (invalid) input.current?.focus();
      else check.current?.focus();
    }
  }, [error, busy, invalid]);
  function discard(resetInput = true) {
    previewOwner.current.clear();
    setSelection(undefined);
    setPreviewFailed(false);
    if (resetInput && input.current) input.current.value = '';
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!selection || busy || uncertain || blocked) return;
    const body = new FormData();
    body.append('image', selection.file);
    setBusy(true);
    setError(null);
    try {
      const response = await session.request<unknown>(
        `/products/${data.id}/image`,
        'PUT',
        body,
      );
      try {
        if (!product(response).image) throw new Error();
      } catch {
        throw new ApiError(502, true);
      }
      if (alive.current) {
        discard();
        refresh('Product image updated.');
      }
    } catch (error) {
      if (alive.current && !(error instanceof Cancelled))
        setError(
          error instanceof ApiError
            ? error.status === 409
              ? Object.assign(new ApiError(409), {
                  message:
                    'The product may have been archived. Refresh its status before changing the image.',
                })
              : error
            : new ApiError(0, true),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="image-management">
      <h3>{data.image ? 'Replace image' : 'Add an image'}</h3>
      <p id="image-file-help" className="help">
        JPEG, PNG or WebP · Maximum 5 MiB. Static images only, up to 8192 pixels
        per side and 24 million pixels. The server validates every upload.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          void upload(event);
        }}
        aria-busy={busy}
      >
        <div className="field">
          <label htmlFor="image-file">Choose product image</label>
          <input
            ref={input}
            id="image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy || uncertain}
            aria-invalid={invalid || undefined}
            aria-describedby={`image-file-help${invalid ? ' image-file-error' : ''}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              discard(false);
              setValidation('');
              setError(null);
              if (!file) return;
              const message = imageFileError(file);
              if (message) {
                setValidation(message);
                return;
              }
              setSelection({ file, url: previewOwner.current.replace(file) });
            }}
          />
        </div>
        {validation && (
          <p id="image-file-error" className="field-error" role="alert">
            {validation}
          </p>
        )}
        {error && (
          <div id={invalid ? 'image-file-error' : undefined}>
            <ErrorNotice error={error} />
          </div>
        )}
        {selection && (
          <div className="selection-preview">
            <p className="help">
              Selected image preview · Your current image stays unchanged until
              you upload.
            </p>
            {previewFailed ? (
              <p role="status">
                Preview unavailable. The server will validate this file.
              </p>
            ) : (
              <img
                key={selection.url}
                src={selection.url}
                alt="Selected product image preview"
                onError={() => setPreviewFailed(true)}
              />
            )}
          </div>
        )}
        <div className="row image-actions">
          <button
            className="primary"
            type="submit"
            disabled={!selection || busy || blocked || uncertain}
          >
            {busy ? 'Uploading…' : 'Upload selected image'}
          </button>
          {selection && (
            <button
              type="button"
              disabled={busy || uncertain}
              onClick={() => {
                discard();
                setError(null);
              }}
            >
              Discard selection
            </button>
          )}
        </div>
      </form>
      {error && (
        <button
          ref={check}
          className="image-check"
          disabled={busy}
          onClick={() => refresh()}
        >
          {uncertain ? 'Check image status' : 'Refresh product status'}
        </button>
      )}
      {data.image && (
        <button
          className="danger image-remove"
          disabled={busy || uncertain}
          onClick={() => setRemove(true)}
        >
          Remove image
        </button>
      )}
      {remove && (
        <ImageRemovalDialog
          data={data}
          close={(check) => {
            setRemove(false);
            if (check) refresh();
          }}
          removed={() => {
            setRemove(false);
            discard();
            refresh('Product image removed.');
          }}
        />
      )}
    </div>
  );
}
