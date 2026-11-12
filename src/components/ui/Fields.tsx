import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react'

interface TextFieldProps extends ComponentPropsWithoutRef<'input'> {
  label: string
  description?: string
  error?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { id, label, description, error, ...props },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const descriptionId = description ? `${fieldId}-description` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const describedBy = [props['aria-describedby'], descriptionId, errorId].filter(Boolean).join(' ')

  return (
    <div className="filter-field">
      <label htmlFor={fieldId}>{label}</label>
      <input
        {...props}
        ref={ref}
        id={fieldId}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : props['aria-invalid']}
      />
      {description && <small id={descriptionId}>{description}</small>}
      {error && <small id={errorId}>{error}</small>}
    </div>
  )
})

interface SelectFieldProps<Value extends string> extends Omit<ComponentPropsWithoutRef<'select'>, 'children' | 'onChange'> {
  label: string
  emptyLabel: string
  options: readonly { value: Value; label: string }[]
  onValueChange: (value: Value | undefined) => void
}

export function SelectField<Value extends string>({
  id, label, emptyLabel, options, onValueChange, ...props
}: SelectFieldProps<Value>) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  return (
    <div className="filter-field">
      <label htmlFor={fieldId}>{label}</label>
      <select
        {...props}
        id={fieldId}
        onChange={(event) => {
          const option = options.find(({ value }) => value === event.currentTarget.value)
          onValueChange(option?.value)
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map(({ value, label: optionLabel }) => (
          <option value={value} key={value}>{optionLabel}</option>
        ))}
      </select>
    </div>
  )
}

interface CheckboxFieldProps extends Omit<ComponentPropsWithoutRef<'input'>, 'type'> {
  label: string
  labelClassName?: string
}

export function CheckboxField({ label, labelClassName, ...props }: CheckboxFieldProps) {
  return (
    <label className={labelClassName}>
      <input {...props} type="checkbox" />
      {label}
    </label>
  )
}
