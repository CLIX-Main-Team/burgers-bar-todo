import { useLocale } from '../i18n/locale.js'
import { PolicyDocumentPage } from './policy-document.js'
import { privacyPolicy } from './privacy-content.js'

// The public privacy policy (docs/mobile/*-publishing.md). The page furniture lives in
// PolicyDocumentPage, which the account-deletion page shares.
export function PrivacyScreen() {
  const { locale } = useLocale()

  return <PolicyDocumentPage doc={privacyPolicy[locale]} />
}
