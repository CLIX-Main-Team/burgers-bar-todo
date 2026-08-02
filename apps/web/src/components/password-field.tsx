import { PASSWORD_MIN_LENGTH } from '@burgers/shared'
import type { UseFormRegisterReturn } from 'react-hook-form'
import { useTranslations } from 'use-intl'
import { Field } from './ui/field.js'
import { Input } from './ui/input.js'

// The new-password field shared by the two screens that set a password (accept and
// reset-consume). Both enforce the one shared minimum-length rule and show the same
// requirement text — as a hint normally, and in the error colour when the entry is below
// the minimum. Keeping it in one component means those two screens cannot drift.
export function PasswordField({
  register,
  invalid,
}: {
  register: UseFormRegisterReturn
  invalid: boolean
}) {
  const t = useTranslations('common')
  const requirement = t('passwordHint', { min: PASSWORD_MIN_LENGTH })
  return (
    <Field label={t('newPassword')} hint={requirement} error={invalid ? requirement : undefined}>
      {(props) => <Input type="password" autoComplete="new-password" {...props} {...register} />}
    </Field>
  )
}
