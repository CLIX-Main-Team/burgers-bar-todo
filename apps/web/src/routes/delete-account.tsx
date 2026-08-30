import { useLocale } from '../i18n/locale.js'
import { deleteAccountPolicy } from './delete-account-content.js'
import { PolicyDocumentPage } from './policy-document.js'

// The public account-deletion page Google Play's Data safety form links to. Same document
// furniture as the privacy policy; the reasoning behind what it promises is in
// delete-account-content.ts.
export function DeleteAccountScreen() {
  const { locale } = useLocale()

  return <PolicyDocumentPage doc={deleteAccountPolicy[locale]} />
}
