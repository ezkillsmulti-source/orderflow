import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, Cancelled, session } from './api';
import { product, type Product } from './catalog-data';
import { ErrorNotice, useCooldown } from './feedback';
import { priceText } from './money';
import {
  changedFields,
  validateFields,
  type Fields,
  type FieldErrors,
} from './product-form';
import { useProduct } from './use-product';

export function EditProduct({ id }: { id: string }) {
  const [revision, setRevision] = useState(0);
  const state = useProduct(id, revision);
  if (state.error)
    return (
      <section className="card stack">
        <ErrorNotice error={state.error} />
        <button onClick={() => setRevision((value) => value + 1)}>
          Try again
        </button>
        <a href="#products">Back to products</a>
      </section>
    );
  if (!state.data) return <p role="status">Loading product…</p>;
  if (!state.data.active)
    return (
      <section className="card">
        <h1>Product archived</h1>
        <p>This product can be read, but it cannot be edited or reactivated.</p>
        <a href={`#products/${id}`}>View product</a>
      </section>
    );
  return <ProductForm original={state.data} />;
}
export function ProductForm({ original }: { original?: Product }) {
  const [fields, setFields] = useState<Fields>({
    sku: original?.sku ?? '',
    name: original?.name ?? '',
    description: original?.description ?? '',
    price: original ? priceText(original.priceMinor) : '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = useCooldown(error);
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    heading.current?.focus();
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const checked = validateFields(fields);
  const unchanged =
    original &&
    !Object.keys(checked.errors).length &&
    !Object.keys(changedFields(checked.data, original)).length;
  const back = original ? `#products/${original.id}` : '#products';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setErrors(checked.errors);
    setError(null);
    if (Object.keys(checked.errors).length) {
      const field = Object.keys(checked.errors)[0];
      form.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }
    const body = original
      ? changedFields(checked.data, original)
      : checked.data;
    if (!Object.keys(body).length) return;
    setBusy(true);
    try {
      const result = await session.request<unknown>(
        original ? `/products/${original.id}` : '/products',
        original ? 'PATCH' : 'POST',
        body,
      );
      let saved: Product;
      try {
        saved = product(result);
      } catch {
        throw new ApiError(502, true);
      }
      if (alive.current) window.location.hash = `#products/${saved.id}`;
    } catch (error) {
      if (alive.current && !(error instanceof Cancelled))
        setError(error instanceof ApiError ? error : new ApiError(0, true));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function field(
    name: keyof Fields,
    label: string,
    help?: string,
    multiline = false,
  ) {
    const props = {
      id: name,
      name,
      value: fields[name],
      disabled: busy,
      'aria-invalid': Boolean(errors[name]),
      'aria-describedby':
        [help ? `${name}-help` : '', errors[name] ? `${name}-error` : '']
          .filter(Boolean)
          .join(' ') || undefined,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => {
        const next = { ...fields, [name]: event.target.value };
        setFields(next);
        setErrors((current) => ({
          ...current,
          [name]: validateFields(next).errors[name],
        }));
      },
    };
    return (
      <div className={`field ${multiline ? 'full' : ''}`}>
        <label htmlFor={name}>{label}</label>
        {multiline ? (
          <textarea {...props} />
        ) : (
          <input
            {...props}
            type="text"
            inputMode={name === 'price' ? 'decimal' : undefined}
            autoComplete="off"
          />
        )}
        {help && (
          <p className="help" id={`${name}-help`}>
            {help}
          </p>
        )}
        {errors[name] && (
          <span className="field-error" id={`${name}-error`}>
            {errors[name]}
          </span>
        )}
      </div>
    );
  }
  return (
    <>
      <a href={back}>← Back to {original ? 'product' : 'products'}</a>
      <h1 ref={heading} tabIndex={-1} style={{ marginTop: '1.5rem' }}>
        {original ? 'Edit product' : 'Create product'}
      </h1>
      <p className="muted">
        {original
          ? 'Update the details your team relies on.'
          : 'Add a product to your business catalog.'}
      </p>
      <form
        ref={form}
        noValidate
        className="card form-card stack"
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-busy={busy}
      >
        <div className="form-grid">
          {field('name', 'Product name', '1–200 Unicode characters.')}
          {field(
            'sku',
            'SKU',
            'Case-sensitive. 1–64 ASCII characters; archived SKUs stay reserved.',
          )}
          {field(
            'price',
            'Price (ARS)',
            'Use a decimal point, e.g. 1250.50. No thousands separators. Zero is allowed.',
          )}
          {field(
            'description',
            'Description (optional)',
            'Up to 2,000 Unicode characters.',
            true,
          )}
        </div>
        <ErrorNotice error={error} />
        {error && (
          <p className="help">
            Your form values have been kept.{' '}
            <a href={back}>Check the current catalog</a> before another
            submission.
          </p>
        )}
        {original && (
          <p className="help">
            Concurrent edits use the last submitted value for each changed
            field.
          </p>
        )}
        <div className="row actions">
          <button
            className="primary"
            disabled={busy || blocked || Boolean(unchanged)}
          >
            {busy ? 'Saving…' : original ? 'Save changes' : 'Create product'}
          </button>
          <a className="button" href={back}>
            Cancel
          </a>
          {unchanged && <span className="help">No changes to save.</span>}
        </div>
      </form>
    </>
  );
}
