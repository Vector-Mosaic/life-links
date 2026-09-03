import { LifeLinksGlyph } from "./owner/FieldLedgerPrimitives";
import type { PublicInformationPage } from "./workspace/routes";

// Owner-approved public notices. Keep the wording aligned with the approved
// notice source; these are policy commitments, not a compliance certification.
export const privacyParagraphs = [
  "LifeLinks helps you organize the information you choose to record about your possessions, projects, routines and calendar, and make it available to agents you authorize.",
  "We store your account email, display name and password hash, plus the content you save: records, notes, files, Collections, Routines, history and Calendar information. Session cookies keep you signed in. Operational metadata is used to run, troubleshoot and protect the service. LifeLinks is hosted on Railway.",
  "Your workspace is private by default. If you explicitly make a QR-linked record public, its selected public information can be viewed through that link. Attachments remain access-controlled. Anyone using the shared demonstration account can access that account's data. Use a separate private account and test data when evaluating your own connections.",
  "Google and Microsoft calendar connections are optional. With your permission, LifeLinks reads account identity and available calendars, synchronizes calendars you select, and performs event changes you request or authorize within the provider's permissions. Calendar authorization credentials are stored encrypted on the server and are not given to connected agents. Disconnecting removes the saved credentials; it does not delete your original events at Google or Microsoft. Removing a LifeLinks calendar connection removes its local calendar projection. Provider-side consent may need to be revoked separately in your provider account settings.",
  "You separately control access for connected agents and each calendar. An authorized agent client can receive content and perform actions within those permissions. The agent service's own privacy and retention policies apply to information it receives. Revoking access stops future authorized access; it does not erase information already received by that client. Browser and remote agent connections have separate revocation controls.",
  "LifeLinks uses Google user data to provide the connected-calendar features you authorize. It does not use that data for advertising, sell it, or use it to train generalized AI models. LifeLinks' use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including its Limited Use requirements.",
  "You can edit or remove content through available application controls. Undo, history and backups may retain copies; removal is not a promise of immediate erasure from every copy. Contact justin@vmosaic.com for privacy questions or an account/data-deletion request. Do not send passwords or calendar credentials."
] as const;

export const termsParagraphs = [
  "LifeLinks is an invitation-only evaluation service operated by Vector Mosaic. Use an account you control, keep its credentials private, and connect only provider accounts and information you are authorized to use. Do not connect your own calendar to the shared demonstration account.",
  "You retain ownership of the content you provide. You authorize LifeLinks to store and process it to provide the features and agent connections you choose. Connected third-party services remain subject to their own terms and policies.",
  "This evaluation may contain errors or change over time. Keep your own copies of important information and review agent-created changes. Do not rely on it for emergency or safety-critical tasks. Access may be limited or suspended to protect the service or address misuse. Contact justin@vmosaic.com for support."
] as const;

export function PublicInformationLinks() {
  return <nav className="public-information-links" aria-label="About LifeLinks">
    <a href="/about">About</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a>
  </nav>;
}

export function LifeLinksIntroduction() {
  return <section className="life-links-introduction" aria-labelledby="life-links-introduction-title">
    <h2 id="life-links-introduction-title">Your everyday context, connected.</h2>
    <p>Organize places and possessions, Collections, Routines and calendars. Keep useful notes and files in one place, and let an agent you authorize help you read and update them.</p>
    <p>QR labels are optional. Your information stays useful between conversations.</p>
    <PublicInformationLinks />
  </section>;
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
        <p>The populated shared demo is for exploring examples. Use the credentials in your private evaluation instructions to sign in. To test your own information, agent or eligible calendar account, create a separate private account with the invitation in those instructions. New private accounts do not copy demo content.</p>
        <p>LifeLinks is operated by Vector Mosaic. Contact <a href="mailto:justin@vmosaic.com">justin@vmosaic.com</a> for support.</p>
      </> : (page === "privacy" ? privacyParagraphs : termsParagraphs).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <div className="public-information-actions">
        <a className="primary-button" href="/life-links">Open LifeLinks / sign in</a>
        <a href="/register">Create a private test account</a>
      </div>
    </article>
    <footer className="public-information-footer"><span>Vector Mosaic · LifeLinks</span><PublicInformationLinks /></footer>
  </main>;
}
