import type { InputHTMLAttributes } from "react";

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label: string; error?: string; onChange: (value: string) => void; hint?: string;
}
export default function Field({ label, error, onChange, required, hint, ...rest }: Props) {
  return (
    <label className={error ? "form-field has-error" : "form-field"}>
      <span>{label}{required && <i> *</i>}</span>
      <input aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} required={required} {...rest} />
      {error ? <em className="field-error" role="alert">{error}</em> : hint ? <em className="field-hint">{hint}</em> : null}
    </label>
  );
}
