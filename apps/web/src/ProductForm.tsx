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
import {
  BackLink,
  LoadingState,
  PageHeader,
  WorkspaceState,
} from './workspace';

export function EditProduct({ id }: { id: string }) {
  const [revision, setRevision] = useState(0);
  const state = useProduct(id, revision);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [state.data?.active]);
  if (state.error)
    return (
      <WorkspaceState
        title="Product unavailable"
        headingLevel={1}
        actions={
          <button onClick={() => setRevision((value) => value + 1)}>
            Try again
          </button>
        }
      >
        <ErrorNotice error={state.error} />
        <a href="#products">Back to products</a>
      </WorkspaceState>
    );
  if (!state.data) return <LoadingState>Loading product…</LoadingState>;
  if (!state.data.active)
    return (
      <>
        <PageHeader title="Product archived" headingRef={heading} />
        <WorkspaceState
          title="Available for reference"
          actions={
            <a className="button" href={`#products/${id}`}>
              View product
            </a>
          }
        >
          <p>
            This product can be read, but it cannot be edited or reactivated.
          </p>
        </WorkspaceState>
      </>
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
  const focusError = useRef(false);
  useEffect(() => {
    if (!focusError.current) return;
    focusError.current = false;
    const name = (['name', 'sku', 'description', 'price'] as const).find(
      (key) => errors[key],
    );
    if (name)
      form.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
  }, [errors]);
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
      focusError.current = true;
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
      required: name !== 'description',
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
      <BackLink href={back}>
        Back to {original ? 'product' : 'products'}
      </BackLink>
      <PageHeader
        title={original ? 'Edit product' : 'Create product'}
        headingRef={heading}
        description={
          original
            ? 'Keep product details clear and up to date.'
            : 'Add a product to your team’s catalog.'
        }
      />
      <form
        ref={form}
        noValidate
        className="product-form stack"
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-busy={busy}
      >
        <p className="help">All fields are required except description.</p>
        {Object.values(errors).some(Boolean) && (
          <p className="error" role="alert">
            Review the highlighted fields before saving.
          </p>
        )}
        <fieldset className="card form-section">
          <legend>Product identity</legend>
          <div className="form-section-body form-grid">
            {field(
              'name',
              'Product name',
              'Use a clear name, up to 200 characters.',
            )}
            {field(
              'sku',
              'SKU',
              '1–64 letters, numbers, dots, underscores or hyphens. Start with a letter or number. Case-sensitive; archived SKUs stay reserved.',
            )}
            {field(
              'description',
              'Description (optional)',
              'Add useful context for your team, up to 2,000 characters.',
              true,
            )}
          </div>
        </fieldset>
        <fieldset className="card form-section">
          <legend>Pricing</legend>
          <div className="form-section-body pricing-fields">
            {field(
              'price',
              'Price (ARS)',
              'Use a decimal point and up to two decimal places, e.g. 1250.50. No thousands separators. Zero is allowed.',
            )}
            <p className="help">Argentine pesos · Maximum 90071992547409.91</p>
          </div>
        </fieldset>
        <ErrorNotice error={error} />
        {error && (
          <p className="help">
            Your form values have been kept.{' '}
            <a href={back}>Check the current catalog</a> before another
            submission.
          </p>
        )}
        {unchanged && (
          <p className="help" role="status">
            No changes to save.
          </p>
        )}
        <div className="form-actions">
          <a className="button" href={back}>
            Cancel
          </a>
          <button
            className="primary"
            disabled={busy || blocked || Boolean(unchanged)}
          >
            {busy ? 'Saving…' : original ? 'Save changes' : 'Create product'}
          </button>
        </div>
      </form>
    </>
  );
}
