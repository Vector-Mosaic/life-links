import { useId } from "react";
import { LIFE_LINKS_SMS_VERIFICATION_CONSENT } from "@life-links/core";

// The live sign-in flow and public carrier-review view use the same entry and
// disclosure. Omitting the send action cannot initiate verification or consent
// recording; it leaves the form inspectable while SMS delivery is unavailable.
export function PhoneNumberEntry({ phoneNumber, smsConsent, disabled = false, busy = false,
  onPhoneNumberChange, onSmsConsentChange, onSendCode }: {
    phoneNumber: string;
    smsConsent: boolean;
    disabled?: boolean;
    busy?: boolean;
    onPhoneNumberChange: (value: string) => void;
    onSmsConsentChange: (value: boolean) => void;
    onSendCode?: () => void;
  }) {
  const id = useId();
  return <>
    <label htmlFor={`${id}-phone`}><span>Phone number</span><input id={`${id}-phone`} name="phoneNumber" type="tel"
      autoComplete="tel" placeholder="+1 555 123 4567" value={phoneNumber} disabled={disabled}
      onChange={event => { onPhoneNumberChange(event.target.value); onSmsConsentChange(false); }}
      onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label>
    <p className="account-entry-help">Include your country code. We'll send a six-digit verification code.</p>
    <div className="ll-form"><label className="ll-checkbox-label" htmlFor={`${id}-sms-consent`} style={{ alignItems: "flex-start" }}>
      <input id={`${id}-sms-consent`} name="smsConsent" type="checkbox" checked={smsConsent} disabled={disabled}
        onChange={event => onSmsConsentChange(event.target.checked)}
        onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} />
      <span>{LIFE_LINKS_SMS_VERIFICATION_CONSENT.permission}
        {" "}{LIFE_LINKS_SMS_VERIFICATION_CONSENT.frequency}
        {" "}{LIFE_LINKS_SMS_VERIFICATION_CONSENT.keywords} Support: <a href={`mailto:${LIFE_LINKS_SMS_VERIFICATION_CONSENT.supportEmail}`}>{LIFE_LINKS_SMS_VERIFICATION_CONSENT.supportEmail}</a>.
        {" "}{LIFE_LINKS_SMS_VERIFICATION_CONSENT.retentionNotice}
        {" "}<a href="/terms">Terms</a> and <a href="/privacy">Privacy</a>.</span>
    </label></div>
    <button type="button" className="primary-button" disabled={disabled || !smsConsent || !onSendCode}
      onClick={onSendCode}>{busy ? "Sending code…" : "Send code"}</button>
  </>;
}
