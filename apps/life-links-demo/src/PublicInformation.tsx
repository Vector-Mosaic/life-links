import { LifeLinksGlyph } from "./owner/FieldLedgerPrimitives";
import type { PublicInformationPage } from "./workspace/routes";

// Owner-approved public notices. Keep the wording aligned with the approved
// notice source; these are policy commitments, not a compliance certification.
export const privacyParagraphs = [
  "LifeLinks helps you organize the information you choose to record about your possessions, projects, routines and calendar, and make it available to agents you authorize.",
  "We store your display name, account email when provided, and a password hash if you choose password sign-in, plus the content you save: records, notes, files, Collections, Routines, history and Calendar information. Session cookies keep you signed in. Operational metadata is used to run, troubleshoot and protect the service. LifeLinks is hosted on Railway.",
  "New email/password accounts require an email verification code before account creation. Phone signup, sign-in and linking verify that you can receive a code at the number you supply. Verification messages pass through our configured email or text-message provider, which receives the destination and message needed to send the code. SMS verification is for the codes you request, not marketing messages. We do not sell or share mobile verification information with third parties for marketing or promotional purposes. Phone sign-in stores a stable sign-in identifier and a masked number for your account settings. Verification destinations, codes and SMS consent time/version are protected in encrypted verification attempts; expiry ends their use for verification, and later cleanup removes expired attempts rather than deleting them immediately at expiry. A phone-only account does not require an email address. Verification or linking a sign-in method does not grant access to your workspace to the delivery provider.",
  "If you choose provider sign-in, LifeLinks uses the account identity and profile information you authorize the provider to share for account creation, sign-in or linking a sign-in method. We store the provider name and stable account identifier, along with the shared display name and available email. Identity-only sign-in consent does not grant calendar access or access for connected agents. Calendar connections and agent permissions are separate choices.",
  "Your workspace is private by default. If you explicitly make a QR-linked record public, its selected public information can be viewed through that link. Attachments remain access-controlled. Anyone using the shared demonstration account can access that account's data. Use a separate private account and test data when evaluating your own connections.",
  "Google and Microsoft calendar connections are optional. With your permission, LifeLinks reads account identity and available calendars, synchronizes calendars you select, and performs event changes you request or authorize within the provider's permissions. Calendar authorization credentials are stored encrypted on the server and are not given to connected agents. Disconnecting removes the saved credentials; it does not delete your original events at Google or Microsoft. Removing a LifeLinks calendar connection removes its local calendar projection. Provider-side consent may need to be revoked separately in your provider account settings.",
  "You separately control access for connected agents and each calendar. An authorized agent client can receive content and perform actions within those permissions. The agent service's own privacy and retention policies apply to information it receives. Revoking access stops future authorized access; it does not erase information already received by that client. Browser and remote agent connections have separate revocation controls.",
  "LifeLinks uses Google user data for account creation, sign-in and linking a sign-in method, and for the connected-calendar features you separately authorize. It does not use that data for advertising, sell it, or use it to train generalized AI models. LifeLinks' use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including its Limited Use requirements.",
  "You can edit or remove content through available application controls. Undo, history and backups may retain copies; removal is not a promise of immediate erasure from every copy. Contact justin@vmosaic.com for privacy questions or an account/data-deletion request. Do not send passwords or calendar credentials."
] as const;

export const termsParagraphs = [
  "LifeLinks is an evaluation service operated by Vector Mosaic. Anyone can create a private account through an available verified signup method. Use an account you control, keep its credentials private, and connect only provider accounts and information you are authorized to use. Do not connect your own calendar to the shared demonstration account.",
  "You retain ownership of the content you provide. You authorize LifeLinks to store and process it to provide the features and agent connections you choose. Connected third-party services remain subject to their own terms and policies.",
  "If you choose SMS verification, LifeLinks sends one-time codes for the phone signup, sign-in or linking you request. Message frequency depends on your requests. Standard message and data rates may apply. Reply STOP to a LifeLinks text to stop SMS verification messages; use another available sign-in method if texts are blocked. Messages can be delayed or fail to arrive. Reply HELP or contact justin@vmosaic.com for help.",
  "This evaluation may contain errors or change over time. Keep your own copies of important information and review agent-created changes. Do not rely on it for emergency or safety-critical tasks. Access may be limited or suspended to protect the service or address misuse. Contact justin@vmosaic.com for support."
] as const;

export function PublicInformationLinks() {
  return <nav className="public-information-links" aria-label="About LifeLinks">
    <a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
  </nav>;
}

export function PublicInformation({ page }: { page: PublicInformationPage }) {
  const title = page === "privacy" ? "Privacy notice" : page === "terms" ? "Evaluation terms" : "About LifeLinks";
  return <main className="public-information-shell">
    <header className="public-information-header">
      <a className="ll-brand" href="/" aria-label="LifeLinks home">LifeLinks <LifeLinksGlyph /></a>
      <PublicInformationLinks />
    </header>
    <article className="public-information-content" aria-labelledby="public-information-title">
      <h1 id="public-information-title">{title}</h1>
      {page === "about" ? <>
        <p>LifeLinks is a private-by-default context layer for everyday life. Save the information you want to remember, organize it in ways that make sense to you, and give your chosen AI agent permission to help maintain it.</p>
        <h2>One place for the pieces of your life</h2>
        <ul>
          <li><strong>My Life Links:</strong> organize nested places, containers and items, with notes, photos and documents. Optional printable QR labels make physical items easy to open or find.</li>
          <li><strong>My Collections:</strong> group items by purpose and section, independently of where they are stored. A camping kit can include gear from several rooms or totes.</li>
          <li><strong>My Routines:</strong> plan unordered activities or ordered steps, schedule them, and keep completion history without rewriting past sessions.</li>
          <li><strong>My Calendar:</strong> view native events and selected Google or Outlook calendars together, with separate visibility and agent-permission controls.</li>
        </ul>
        <p>Search records across the app and keep relevant files alongside them. Use LifeLinks for camping gear, workshop tools, a 3D-printer filament inventory, makeup preferences, or other context you choose to record.</p>
        <h2>Work with your agent</h2>
        <p>Connected agents can read, create, edit, move and remove supported records within their permissions and required confirmation controls. Browser WebMCP works through an open LifeLinks page. A separately authorized remote MCP connection can work with that page closed. Available tools depend on the connected client and granted access.</p>
        <h2>Explore or try your own account</h2>
        <p>The populated shared demo is for exploring examples. Use the credentials in your private evaluation instructions to sign in. To use your own information, agent or eligible calendar account, create a separate private account through an available signup method. New private accounts do not copy demo content.</p>
        <p>LifeLinks is operated by Vector Mosaic. Contact <a href="mailto:justin@vmosaic.com">justin@vmosaic.com</a> for support.</p>
      </> : (page === "privacy" ? privacyParagraphs : termsParagraphs).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <div className="public-information-actions">
        <a className="primary-button" href="/life-links">Open LifeLinks / sign in</a>
        <a href="/register">Create a private account</a>
      </div>
    </article>
    <footer className="public-information-footer"><span>Vector Mosaic · LifeLinks</span><PublicInformationLinks /></footer>
  </main>;
}
