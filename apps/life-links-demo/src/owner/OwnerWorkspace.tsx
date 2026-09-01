import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Boxes, Box, Search, ScanLine, Pin, PinOff, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus, ChevronRight, ChevronDown, FolderPlus, PackagePlus, Settings, HelpCircle, LogOut, Folder, Package, Pencil, Rows3, ListPlus, ChevronLeft, Menu, Download, QrCode, Trash2, Move, Undo2 } from "lucide-react";
import { ATTACHMENT_FILE_ACCEPT, MAX_BATCH_COUNT, deriveLifeLinkPhysicalLocator, formatRecordedLifeLinkPath, type LifeLinkRecord, type LifeLinkSummary } from "@life-links/core";
import { LifeLinksWorkspaceController } from "../workspace/controller";
import type { LifeLinksWorkspaceSnapshot } from "../workspace/types";
import { LifeLinkDetail } from "./LifeLinkDetail";
import { PathBreadcrumbs } from "./PathBreadcrumbs";
import { ActionMenu, Dialog, LifeLinksGlyph, type MenuItem } from "./FieldLedgerPrimitives";
import { CHANGE_HISTORY_WARNING, ChangePreviewDialog, FormDialog, LifeLinkChangeDialog, QrDialog, SectionAssignmentDialog, type WorkspaceDialog } from "./FieldLedgerDialogs";

// Keep this aligned with the phone-layout media query in styles.css.
const PHONE_LAYOUT_QUERY = "(max-width: 700px) and (hover: none), (max-width: 700px) and (pointer: coarse)";

export function OwnerWorkspace({ controller, snapshot, agentPanel, scannerPanel, findScannerPanel, onLogout, headingRef }: {
  controller: LifeLinksWorkspaceController; snapshot: LifeLinksWorkspaceSnapshot; agentPanel?: ReactNode; onLogout?(): void;
  scannerPanel?: ReactNode; findScannerPanel?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const { currentUser, busy, workspaceMode, selectedCollection, selectedLifeLinkDetail, hierarchyParentDetail, detailsOpen } = snapshot;
  const [dialog, setDialog] = useState<WorkspaceDialog>(null);
  const [pinned, setPinned] = useState(() => { try { const value = localStorage.getItem("life-links-navigation-pinned"); return value === null ? window.innerWidth >= 1280 : value === "true"; } catch { return false; } });
  const [hovered, setHovered] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [middleCollapsed, setMiddleCollapsed] = useState(false);
  const [collectionView, setCollectionView] = useState<"sections" | "locations" | "all">("sections");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [editingHierarchy, setEditingHierarchy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [scanInput, setScanInput] = useState("");
  const [findInput, setFindInput] = useState("");
  const mediaInput = useRef<HTMLInputElement>(null);
  const mediaTarget = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const close = () => setDialog(null);
  const searchMode = snapshot.activeView === "search";
  const scanMode = snapshot.activeView === "scan" || snapshot.activeView === "factory";
  const dataMode = !searchMode && !scanMode;
  const collectionsMode = workspaceMode === "collections";
  const parent = hierarchyParentDetail?.lifeLink;
  const branch = snapshot.hierarchyParentId ? snapshot.lifeLinkChildren[snapshot.hierarchyParentId] : snapshot.rootLifeLinks;
  const title = searchMode ? "Search" : scanMode ? "Scan a QR" : collectionsMode ? selectedCollection?.title ?? "My Collections" : parent?.title ?? "My Life Links";
  const panelName = searchMode ? "Search" : scanMode ? "Scan" : collectionsMode ? "Collections" : "Hierarchies";
  const sectionGroupIds = [...snapshot.collectionSections.map((section) => section.id), "__unsectioned"];
  const allSectionsCollapsed = sectionGroupIds.every((id) => collapsedGroups.includes(id));
  const navOpen = pinned || hovered || mobileNavigation || accountMenuOpen;
  const canHover = typeof window !== "undefined" && window.matchMedia("(hover: hover)").matches;
  useEffect(() => { try { localStorage.setItem("life-links-navigation-pinned", String(pinned)); } catch { /* Cosmetic preference only. */ } }, [pinned]);
  useEffect(() => { scrollRef.current?.scrollTo(0, 0); setMiddleCollapsed(false); }, [snapshot.hierarchyParentId, selectedCollection?.id, snapshot.activeView]);
  useEffect(() => { setCollapsedGroups([]); setCollectionView("sections"); }, [selectedCollection?.id]);
  useEffect(() => { setEditingHierarchy(false); setSelectedIds([]); setChangeError(""); }, [currentUser?.id, snapshot.hierarchyParentId, snapshot.workspaceMode, snapshot.activeView]);
  useEffect(() => {
    // An agent must not obscure or discard a human form that is already open.
    if (dialog && snapshot.agentChangeConfirmation) controller.confirmAgentChange(false);
  }, [controller, dialog, snapshot.agentChangeConfirmation]);
  useEffect(() => {
    const phoneLayout = window.matchMedia(PHONE_LAYOUT_QUERY);
    const restoreMiddleOnPhone = () => { if (phoneLayout.matches) setMiddleCollapsed(false); };
    phoneLayout.addEventListener("change", restoreMiddleOnPhone);
    return () => phoneLayout.removeEventListener("change", restoreMiddleOnPhone);
  }, []);
  useEffect(() => { if (!mobileNavigation) return; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileNavigation(false); }; document.addEventListener("keydown", closeOnEscape); return () => document.removeEventListener("keydown", closeOnEscape); }, [mobileNavigation]);
  function navigate(action: () => void) { setMobileNavigation(false); action(); }
  function openCreate(parentId: string | null, role: "container" | "item" = "item") { setDialog({ kind: "create", parentId, role }); }
  function groupToggle(id: string) { setCollapsedGroups((groups) => groups.includes(id) ? groups.filter((key) => key !== id) : [...groups, id]); }
  function selectForChange(id: string) { setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); }
  function finishEditing() { setEditingHierarchy(false); setSelectedIds([]); }
  async function undo() {
    if (undoing || !snapshot.changeHistory.entries.length) return;
    setUndoing(true); setChangeError("");
    try { await controller.undoLastChange(); finishEditing(); }
    catch (issue) { setChangeError(issue instanceof Error ? issue.message : "The last saved change could not be undone."); }
    finally { setUndoing(false); }
  }
  function undoControl() {
    const latest = snapshot.changeHistory.entries[0];
    const tooltip = `${latest ? `Undo ${latest.label}.` : "No saved changes to undo."} ${CHANGE_HISTORY_WARNING}`;
    return <span className="ll-undo-control" title={tooltip}><button className="ll-text-button" aria-label="Undo last saved change" title={tooltip} disabled={busy || undoing || !latest || Boolean(snapshot.agentChangeConfirmation)} onClick={() => void undo()}><Undo2 size={17} /><span>Undo</span></button></span>;
  }
  function toggleAllSections() {
    setCollapsedGroups((groups) => sectionGroupIds.every((id) => groups.includes(id))
      ? groups.filter((id) => !sectionGroupIds.includes(id))
      : [...new Set([...groups, ...sectionGroupIds])]);
  }
  async function manageMemberships(id: string) {
    // The picker loads the current owner library through its existing controller.
    if (!snapshot.collectionsComplete) await controller.loadCollections();
    setDialog({ kind: "assign", lifeLinkId: id });
  }
  async function openMembership(collectionId: string, lifeLinkId: string, sectionId?: string) {
    await controller.openCollection(collectionId, lifeLinkId);
    if (!sectionId || controller.getSnapshot().error) return;
    setCollectionView("sections");
    setCollapsedGroups((groups) => groups.filter((id) => id !== sectionId));
    if (window.matchMedia(PHONE_LAYOUT_QUERY).matches) controller.setDetailsOpen(false);
    requestAnimationFrame(() => document.getElementById(`collection-section-${sectionId}`)?.scrollIntoView({ block: "start" }));
  }
  const createActions: MenuItem[] = collectionsMode ? selectedCollection ? [
    { label: "Add Life Links", icon: <ListPlus size={17} />, onClick: () => setDialog({ kind: "members", lifeLinkId: "" }), disabled: busy },
    { label: "New section", icon: <Rows3 size={17} />, onClick: () => setDialog({ kind: "section" }), disabled: busy },
    { label: "Edit Collection", icon: <Pencil size={17} />, onClick: () => setDialog({ kind: "collection", edit: true }), disabled: busy }
  ] : [{ label: "New Collection", icon: <Boxes size={17} />, onClick: () => setDialog({ kind: "collection" }), disabled: busy }] : [
    { label: "New folder", icon: <FolderPlus size={17} />, onClick: () => openCreate(snapshot.hierarchyParentId, "container"), disabled: busy || editingHierarchy },
    { label: "New item", icon: <PackagePlus size={17} />, onClick: () => openCreate(snapshot.hierarchyParentId, "item"), disabled: busy || editingHierarchy },
    { label: "Edit", icon: <Pencil size={17} />, onClick: () => { setEditingHierarchy(true); setSelectedIds([]); }, disabled: busy || editingHierarchy }
  ];
  function renderMember(member: LifeLinkRecord) {
    const detail = snapshot.collectionMemberDetails[member.id];
    const locator = detail ? deriveLifeLinkPhysicalLocator(detail.ancestry) : null;
    const path = detail ? detail.ancestry.items.filter((item) => item.id !== member.id).map((item) => item.title).join(" / ") : "";
    return <div className={`ll-member-row ${snapshot.selectedLifeLinkId === member.id ? "selected" : ""}`} key={member.id}>
      <button className="ll-row-main" onClick={() => void controller.selectCollectionMember(member.id)} data-life-link-id={member.id} aria-current={snapshot.selectedLifeLinkId === member.id ? "true" : undefined}>
        {member.browsingRole === "container" ? <Folder size={18} /> : <Package size={18} />}<span className="ll-row-copy"><strong>{member.title}</strong><small>{path || "No recorded physical location"}{locator ? ` · ${locator.qrId}` : ""}</small></span>
      </button>
      <ActionMenu key={snapshot.routePathname} label={`Membership for ${member.title}`} className="ll-icon-button ll-row-action" items={[
        { label: "Sections", icon: <Rows3 size={16} />, onClick: () => setDialog({ kind: "assign", lifeLinkId: member.id }) },
        { label: "Show in hierarchy", icon: <Folder size={16} />, onClick: () => void controller.activateLifeLink(member.id) },
        { label: "Remove from Collection", icon: <Trash2 size={16} />, onClick: () => void controller.removeCollectionMember(member.id), disabled: busy, danger: true }
      ]}><Plus size={17} /></ActionMenu>
    </div>;
  }
  function renderGroup(id: string, heading: string, members: LifeLinkRecord[], sectionId?: string) {
    const collapsed = collapsedGroups.includes(id);
    return <section className="ll-collection-group" key={id} id={`collection-section-${id}`}>
      <div className="ll-group-heading"><button onClick={() => groupToggle(id)} aria-expanded={!collapsed}>{collapsed ? <ChevronRight size={17} /> : <ChevronDown size={17} />}<strong>{heading}</strong><small>{members.length} members</small></button>
        {sectionId && <ActionMenu key={snapshot.routePathname} label={`Section actions for ${heading}`} className="ll-icon-button ll-row-action" items={[
          { label: "Edit section", icon: <Pencil size={16} />, onClick: () => setDialog({ kind: "section", id: sectionId, title: heading }) },
          { label: "Remove section", icon: <Trash2 size={16} />, onClick: () => void controller.removeCollectionSection(sectionId), disabled: busy, danger: true }
        ]}><Plus size={16} /></ActionMenu>}
      </div>
      {!collapsed && <div className="ll-group-members">{members.map(renderMember)}{!members.length && <p className="ll-empty-small">No items in this section.</p>}</div>}
    </section>;
  }
  function renderHierarchyRow(item: LifeLinkSummary) {
    const memberships = snapshot.lifeLinkMemberships[item.id] ?? [];
    const expanded = editingHierarchy && snapshot.expandedLifeLinkIds.includes(item.id);
    const children = snapshot.lifeLinkChildren[item.id];
    return <div className="ll-hierarchy-node" key={item.id}><div className={`ll-hierarchy-row ${editingHierarchy ? selectedIds.includes(item.id) ? "selected" : "" : item.id === snapshot.selectedLifeLinkId ? "selected" : ""}`}>
      {editingHierarchy && <input type="checkbox" className="ll-selection-dot" aria-label={`Select ${item.title}`} checked={selectedIds.includes(item.id)} disabled={busy} onChange={() => selectForChange(item.id)} />}
      {editingHierarchy && item.browsingRole === "container" && <button className="ll-icon-button ll-tree-disclosure" aria-label={`${expanded ? "Collapse" : "Expand"} folder ${item.title}`} aria-expanded={expanded} disabled={busy} onClick={() => void controller.toggleLifeLinkExpanded(item.id)}>{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</button>}
      <button className="ll-row-main" data-life-link-id={item.id} disabled={editingHierarchy && busy} onClick={() => editingHierarchy ? selectForChange(item.id) : void controller.activateLifeLink(item.id)} aria-current={!editingHierarchy && item.id === snapshot.selectedLifeLinkId ? "true" : undefined}>
        {item.browsingRole === "container" ? editingHierarchy ? <Folder size={18} /> : <ChevronRight size={18} /> : <Package size={18} />}
        <span className="ll-row-copy"><strong>{item.title}</strong><small>{item.browsingRole === "container" ? item.childCount ? `${item.childCount} direct Life Link${item.childCount === 1 ? "" : "s"}` : "No Life Links inside yet" : item.qrId ?? "Item"}</small></span>
      </button>
      {memberships[0] && <button className="ll-chip ll-blue" disabled={editingHierarchy} onClick={() => void controller.openCollection(memberships[0].collection.id, item.id)} title={memberships.map((entry) => entry.collection.title).join(", ")}>{memberships[0].collection.title}{memberships.length > 1 ? ` +${memberships.length - 1}` : ""}</button>}
      {!snapshot.lifeLinkMembershipsComplete[item.id] && <small className="ll-membership-loading" title="Collection memberships are not fully loaded">Collections pending</small>}
      {item.qrId && <QrCode size={17} className="ll-qr-indicator" aria-label="QR attached" />}
    </div>{expanded && <div className="ll-edit-children">
      {children?.items.map(renderHierarchyRow)}
      {children?.loading && <p className="ll-muted" role="status">Loading folder…</p>}
      {children?.loaded && !children.items.length && <p className="ll-muted">This folder is empty.</p>}
      {!children?.loaded && !children?.loading && <button className="ll-text-button" onClick={() => void controller.loadMoreLifeLinks(item.id)}>Retry loading folder</button>}
      {children?.nextCursor && <button className="ll-text-button" onClick={() => void controller.loadMoreLifeLinks(item.id)}>Load more Life Links</button>}
      {children?.truncated && !children.nextCursor && <p className="ll-inline-warning">This folder could not be fully loaded.</p>}
    </div>}</div>;
  }
  const locationGroups = new Map<string, { title: string; members: LifeLinkRecord[] }>();
  for (const member of snapshot.collectionMembers) {
    const detail = snapshot.collectionMemberDetails[member.id];
    const locator = detail ? deriveLifeLinkPhysicalLocator(detail.ancestry) : null;
    const key = locator?.lifeLinkId ?? member.parentId ?? "__none";
    const label = locator?.title ?? detail?.ancestry.items.filter((item) => item.id !== member.id).at(-1)?.title ?? "No recorded physical location";
    const group = locationGroups.get(key) ?? { title: label, members: [] }; group.members.push(member); locationGroups.set(key, group);
  }
  const initials = currentUser?.displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "LL";
  return <div className="ll-shell">
    <header className="ll-topbar"><button className="ll-icon-button ll-mobile-nav-toggle" aria-label="Open navigation" onClick={() => setMobileNavigation(!mobileNavigation)}><Menu size={20} /></button><span className="ll-brand">LifeLinks <LifeLinksGlyph /></span>
      <button className={`ll-agent-status ${snapshot.agentConnection.connected ? "connected" : ""}`} onClick={() => setDialog({ kind: "agent" })}><span />{snapshot.agentConnection.connected ? "Agent connected" : "Connect agent"}</button>
    </header>
    <div className={`ll-layout ${pinned ? "ll-nav-pinned" : ""} ${navOpen ? "ll-nav-open" : ""} ${mobileNavigation ? "ll-mobile-navigation-open" : ""} ${middleCollapsed ? "ll-middle-collapsed" : ""} ${!detailsOpen ? "ll-details-collapsed" : "ll-details-open"}`}>
      {mobileNavigation && <button className="ll-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavigation(false)} />}
      <aside className="ll-sidebar" aria-label="Life Links navigation" onMouseEnter={() => { if (canHover) setHovered(true); }} onMouseLeave={() => setHovered(false)} onFocusCapture={() => setHovered(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setHovered(false); }}>
        <div className="ll-sidebar-top"><button className="ll-icon-button ll-pin" onClick={() => setPinned(!pinned)} title={pinned ? "Unpin navigation" : "Pin navigation"} aria-label={pinned ? "Unpin navigation" : "Pin navigation"} aria-pressed={pinned}>{pinned ? <PinOff size={18} /> : <Pin size={18} />}</button></div>
        <nav className="ll-nav-scroll">
          <button className={`ll-nav-item ${dataMode && !collectionsMode ? "active" : ""}`} title={!navOpen ? "My Life Links" : undefined} onClick={() => navigate(() => void controller.openHierarchy())}><LifeLinksGlyph double /><span>My Life Links</span></button>
          <button className={`ll-nav-item ${dataMode && collectionsMode ? "active" : ""}`} title={!navOpen ? "My Collections" : undefined} onClick={() => navigate(() => void controller.openCollections())}><Boxes size={23} /><span>My Collections</span></button>
          <button className={`ll-nav-item ${searchMode ? "active" : ""}`} title={!navOpen ? "Search records" : undefined} onClick={() => navigate(() => { controller.setDetailsOpen(false); controller.setActiveView("search"); })}><Search size={22} /><span>Search records</span></button>
          <button className={`ll-nav-item ${scanMode ? "active" : ""}`} title={!navOpen ? "Scan a QR" : undefined} onClick={() => navigate(() => { controller.setDetailsOpen(false); controller.setActiveView("scan"); })}><ScanLine size={22} /><span>Scan a QR</span></button>
        </nav>
        <div className="ll-account"><ActionMenu key={snapshot.routePathname} label="Account" className="ll-account-button" above onOpenChange={setAccountMenuOpen} heading={<><strong>{currentUser?.displayName}</strong><span>{currentUser?.email}</span></>} items={[
          { separator: true }, { label: "Settings", icon: <Settings size={18} />, onClick: () => setDialog({ kind: "settings" }) }, { separator: true },
          { label: "Help", icon: <HelpCircle size={18} />, onClick: () => setDialog({ kind: "help" }) },
          { label: "Logout", icon: <LogOut size={18} />, onClick: () => { if (onLogout) onLogout(); else void controller.logout(); } }
        ]}><span className="ll-avatar">{initials}</span><span className="ll-account-name">{currentUser?.displayName}</span></ActionMenu><div className="ll-rail-bottom-line" /></div>
      </aside>
      <main className="ll-middle" aria-label={panelName}>
        <div className="ll-panel-heading ll-panel-heading-left"><button className="ll-icon-button" title={`${middleCollapsed ? "Expand" : "Collapse"} ${panelName}`} aria-label={`${middleCollapsed ? "Expand" : "Collapse"} ${panelName}`} onClick={() => setMiddleCollapsed(!middleCollapsed)}>{middleCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>{!middleCollapsed && <><span>{panelName}</span>{dataMode && !collectionsMode && undoControl()}</>}</div>
        {!middleCollapsed && <div className="ll-panel-scroll" ref={scrollRef}>
          {snapshot.error && <div className="ll-error" role="alert">{snapshot.error}<button className="ll-text-button" onClick={() => void controller.refreshOwnerLibrary()}>Retry</button></div>}
          {changeError && <p className="ll-inline-warning" role="alert">{changeError}</p>}
          <PathBreadcrumbs label="Current layer" truncated={!collectionsMode && hierarchyParentDetail?.ancestry.truncated} items={!dataMode ? [] : collectionsMode ? selectedCollection ? [
            { id: "__collections", title: "My Collections", onSelect: () => void controller.openCollections() }
          ] : [] : parent ? [
            { id: "__root", title: "My Life Links", onSelect: () => void controller.openHierarchy() },
            ...(hierarchyParentDetail?.ancestry.items ?? []).map((item) => ({ id: item.id, title: item.title, current: item.id === parent.id, onSelect: () => void controller.openHierarchy(item.id) }))
          ] : []} />
          {editingHierarchy && dataMode && !collectionsMode && <section className="ll-edit-toolbar">
            <div role="toolbar" aria-label="Edit hierarchy"><strong aria-live="polite">{selectedIds.length} selected</strong>
              <button className="ll-button" disabled={busy || !selectedIds.length} onClick={() => setDialog({ kind: "move", lifeLinkIds: [...selectedIds] })}><Move size={16} />Move</button>
              <button className="ll-button ll-danger-text" disabled={busy || !selectedIds.length} onClick={() => setDialog({ kind: "delete", lifeLinkIds: [...selectedIds] })}><Trash2 size={16} />Delete</button>
              <button className="ll-text-button" disabled={busy} onClick={finishEditing}>Done</button>
            </div><p className="ll-history-warning">{CHANGE_HISTORY_WARNING}</p>
          </section>}
          <div className="ll-title-row"><div><h1 ref={headingRef} tabIndex={-1}>{title}</h1><p className="ll-subtitle">{dataMode ? collectionsMode ? selectedCollection ? `${snapshot.collectionMembers.length} unique members · ${snapshot.collectionSections.length} sections` : `${snapshot.collections.length} Collections` : `${branch?.items.length ?? 0}${branch?.nextCursor ? "+" : ""} direct Life Links` : searchMode ? "Life Links, Collections, and sections" : "Open a QR from its code or URL"}</p></div>
            {dataMode && <ActionMenu key={snapshot.routePathname} label={`Add to ${title}`} className="ll-icon-button ll-primary ll-main-plus" items={createActions}><Plus size={24} /></ActionMenu>}
          </div>
          {dataMode && !collectionsMode && <div className="ll-record-list">{branch?.items.map(renderHierarchyRow)}{branch?.loading && <p className="ll-muted">Loading Life Links…</p>}{branch?.loaded && !branch.items.length && <p className="ll-empty">No Life Links here yet. Use + to create a folder or item.</p>}{branch?.nextCursor && <button className="ll-text-button ll-load-more" onClick={() => void controller.loadMoreLifeLinks(snapshot.hierarchyParentId)}>Load more Life Links</button>}{branch?.truncated && !branch.nextCursor && <p className="ll-inline-warning">This layer could not be fully loaded.</p>}</div>}
          {dataMode && collectionsMode && !selectedCollection && <div className="ll-record-list">{!snapshot.collectionLoading && snapshot.collections.map((collection) => <button className="ll-collection-index-row" key={collection.id} onClick={() => void controller.openCollection(collection.id)}><Boxes size={24} /><span><strong>{collection.title}</strong><small>{collection.purpose}</small></span><ChevronRight size={18} /></button>)}{snapshot.collectionsLoading || snapshot.collectionLoading ? <p className="ll-muted">Loading Collection…</p> : !snapshot.collections.length && <p className="ll-empty">No Collections yet. Use + to create one.</p>}{!snapshot.collectionsComplete && !snapshot.collectionsLoading && !snapshot.collectionLoading && <p className="ll-inline-warning">The Collections list is incomplete.</p>}</div>}
          {dataMode && collectionsMode && selectedCollection && <>
            {selectedCollection.purpose && <p className="ll-collection-purpose">{selectedCollection.purpose}</p>}
            <div className="ll-collection-toolbar">
              <div className="ll-view-switch" aria-label="Collection view">{(["sections", "locations", "all"] as const).map((view) => <button key={view} aria-pressed={collectionView === view} onClick={() => setCollectionView(view)}>{view === "all" ? "All items" : view === "sections" ? "Sections" : "Locations"}</button>)}</div>
              {collectionView === "sections" && <button className="ll-text-button ll-section-toggle-all" onClick={toggleAllSections}>{allSectionsCollapsed ? "Expand all" : "Collapse all"}</button>}
            </div>
            {!snapshot.collectionComplete && <p className="ll-inline-warning">{snapshot.collectionLoading ? "Loading Collection…" : "This Collection could not be fully loaded."}</p>}
            {collectionView === "sections" && <>
              {snapshot.collectionSections.map((section) => renderGroup(section.id, section.title, snapshot.collectionMembers.filter((member) => snapshot.collectionMemberMemberships[member.id]?.find((membership) => membership.collection.id === selectedCollection.id)?.sections.some((entry) => entry.id === section.id)), section.id))}
              {renderGroup("__unsectioned", "Unsectioned", snapshot.collectionMembers.filter((member) => !snapshot.collectionMemberMemberships[member.id]?.find((membership) => membership.collection.id === selectedCollection.id)?.sections.length))}
            </>}
            {collectionView === "locations" && [...locationGroups.entries()].map(([id, group]) => renderGroup(id, group.title, group.members))}
            {collectionView === "all" && <div className="ll-record-list">{snapshot.collectionMembers.map(renderMember)}</div>}
            {selectedCollection.notes && <section className="ll-detail-section"><h3>Collection notes</h3><p className="ll-preserve-lines">{selectedCollection.notes}</p></section>}
          </>}
          {searchMode && <section className="ll-search-screen"><form className="ll-search-form" onSubmit={(event) => { event.preventDefault(); void controller.searchLifeLinks(); }}><Search size={19} /><input aria-label="Search records" placeholder="Search places, things, and notes" value={snapshot.lifeLinkSearchQuery} onChange={(event) => controller.setLifeLinkSearchQuery(event.target.value)} /><button className="ll-button ll-primary" disabled={snapshot.lifeLinkSearchLoading}>Search</button></form>
            {snapshot.lifeLinkSearchLoading && <p className="ll-muted">Searching…</p>}
            {snapshot.lifeLinkSearchResults.map((result) => {
              const locator = deriveLifeLinkPhysicalLocator(result.path);
              const badges = snapshot.lifeLinkMemberships[result.lifeLink.id] ?? [];
              const reason = { all: "Life Link", exact_qr: "QR code", exact_title: "Title", title_prefix: "Title", title: "Title", recorded_path: "Recorded path", body: "Notes", context: "Context" }[result.matchClass];
              return <div key={result.lifeLink.id} className="ll-search-result"><button className="ll-search-open" onClick={() => void controller.activateLifeLink(result.lifeLink.id)}><strong>{result.lifeLink.title}</strong><span>{formatRecordedLifeLinkPath(result.path)}</span><small>{locator ? `QR locator: ${locator.title} · ${locator.qrId}` : result.path.truncated ? "Recorded path is incomplete" : "No QR locator recorded"}</small><small>{result.bodySummary}</small><small>Matched: {reason}</small></button>
                {badges[0] && <button className="ll-chip ll-blue" onClick={() => void controller.openCollection(badges[0].collection.id, result.lifeLink.id)}>{badges[0].collection.title}{badges.length > 1 ? ` +${badges.length - 1}` : ""}</button>}
                {!snapshot.lifeLinkMembershipsComplete[result.lifeLink.id] && <small>Collections pending</small>}
              </div>;
            })}
            {snapshot.collectionSearchResults.map((result) => <div key={result.collection.id} className="ll-search-result"><button className="ll-text-button" onClick={() => void controller.openCollection(result.collection.id)}><Boxes size={17} />{result.collection.title}</button>{result.sections.length > 0 && <small>Sections: {result.sections.map((section) => section.title).join(", ")}</small>}{result.members.map((member) => <button className="ll-search-member" key={member.id} onClick={() => void controller.openCollection(result.collection.id, member.id)}><Package size={16} /><span>{member.title}</span></button>)}</div>)}
            {!snapshot.collectionSearchComplete && !snapshot.lifeLinkSearchLoading && snapshot.lifeLinkSearchQuery && <p className="ll-inline-warning">Collection search could not be fully loaded.</p>}
            {snapshot.lifeLinkSearchNextCursor && <button className="ll-text-button" onClick={() => void controller.searchLifeLinks(undefined, true)}>Load more results</button>}
            {!snapshot.lifeLinkSearchLoading && snapshot.lifeLinkSearchQuery && !snapshot.lifeLinkSearchResults.length && !snapshot.collectionSearchResults.length && <p className="ll-muted">No results.</p>}
          </section>}
          {scanMode && <section className="ll-scan-screen"><form className="ll-form" onSubmit={(event) => { event.preventDefault(); void controller.scanQr(scanInput); }}><label>QR code or URL<input value={scanInput} onChange={(event) => setScanInput(event.target.value)} placeholder="Paste a QR ID or scanned URL" /></label><button className="ll-button ll-primary" disabled={busy || !scanInput.trim()}><ScanLine size={18} />Open QR</button></form>
            <p className="ll-muted">Scan with a camera, or paste the QR code or URL above.</p>
            {scannerPanel}
            <button className="ll-button" onClick={() => setDialog({ kind: "factory" })}><QrCode size={18} />Generate labels</button>
            {snapshot.findTargetId && <section className="ll-detail-section"><h3>Find Mode</h3><p>Looking for <strong>{snapshot.findTargetId}</strong></p><form className="ll-form" onSubmit={(event) => { event.preventDefault(); void controller.evaluateFindScan(findInput); }}><label>Scanned QR<input value={findInput} onChange={(event) => setFindInput(event.target.value)} /></label><button className="ll-button" disabled={busy || !findInput.trim()}>Check QR</button></form>{findScannerPanel}<p role="status">{snapshot.scanMessage.title} {snapshot.scanMessage.detail}</p></section>}
          </section>}
        </div>}
      </main>
      <aside className="ll-details" aria-label="Details"><div className="ll-panel-heading ll-panel-heading-right">{detailsOpen && <><button className="ll-mobile-back ll-text-button" onClick={() => controller.setDetailsOpen(false)}><ChevronLeft size={18} />Back</button><span>Details</span>{undoControl()}</>}<button className="ll-icon-button" aria-label={detailsOpen ? "Collapse Details" : "Expand Details"} title={detailsOpen ? "Collapse Details" : "Expand Details"} onClick={() => controller.setDetailsOpen(!detailsOpen)}>{detailsOpen ? <PanelRightClose size={19} /> : <PanelRightOpen size={19} />}</button></div>
        {detailsOpen && <div className="ll-panel-scroll" key={snapshot.routePathname}>{changeError && <p className="ll-inline-warning" role="alert">{changeError}</p>}<LifeLinkDetail detail={selectedLifeLinkDetail} busy={busy} collectionMode={collectionsMode} memberships={snapshot.selectedLifeLinkMemberships} membershipsLoading={snapshot.membershipsLoading} membershipsComplete={snapshot.membershipsComplete}
          onNavigate={(id) => void (id === null ? controller.openHierarchy() : controller.activateLifeLink(id))} onEdit={(id) => void controller.openCanonicalEditor(id)} onCreateChild={(id) => openCreate(id)} onMove={(id) => setDialog({ kind: "move", lifeLinkIds: [id] })} onQr={(id) => setDialog({ kind: "qr", lifeLinkId: id })}
          onMedia={(id) => { mediaTarget.current = id; mediaInput.current?.click(); }} onCollection={(id, memberId, sectionId) => void openMembership(id, memberId, sectionId)} onMemberships={(id) => void manageMemberships(id)} /></div>}
      </aside>
    </div>
    <input type="file" aria-label="Add attachments" accept={ATTACHMENT_FILE_ACCEPT} multiple hidden ref={mediaInput} onChange={(event) => { if (event.target.files?.length && mediaTarget.current) void controller.uploadCanonicalMedia(mediaTarget.current, event.target.files); event.target.value = ""; }} />
    {dialog && ["create", "collection", "section", "members"].includes(dialog.kind) && <FormDialog key={JSON.stringify(dialog)} dialog={dialog} controller={controller} snapshot={snapshot} onClose={close} />}
    {(dialog?.kind === "move" || dialog?.kind === "delete") && <LifeLinkChangeDialog key={JSON.stringify(dialog)} operation={dialog.kind} lifeLinkIds={dialog.lifeLinkIds} controller={controller} snapshot={snapshot} onClose={close} onApplied={() => { close(); finishEditing(); }} />}
    {!dialog && snapshot.agentChangeConfirmation && <ChangePreviewDialog preview={snapshot.agentChangeConfirmation} busy={false} onConfirm={() => controller.confirmAgentChange(true)} onCancel={() => controller.confirmAgentChange(false)} />}
    {dialog?.kind === "assign" && <SectionAssignmentDialog controller={controller} snapshot={snapshot} lifeLinkId={dialog.lifeLinkId} onClose={close} />}
    {dialog?.kind === "qr" && <QrDialog controller={controller} snapshot={snapshot} lifeLinkId={dialog.lifeLinkId} onClose={close} />}
    {dialog?.kind === "agent" && <Dialog title="Agent connection" onClose={close}>{agentPanel}</Dialog>}
    {dialog?.kind === "settings" && <Dialog title="Settings" onClose={close}><div className="ll-form"><label>Appearance<select value={snapshot.theme} onChange={(event) => controller.setTheme(event.target.value as "light" | "dark")}><option value="light">Light</option><option value="dark">Dark</option></select></label></div></Dialog>}
    {dialog?.kind === "help" && <Dialog title="Help" onClose={close}><div className="ll-help"><h3>My Life Links</h3><p>Folders describe where things belong. Open a folder to see its contents; select an item for its details.</p><h3>My Collections</h3><p>Bring items together for a purpose without moving them. Sections organize a Collection, and an item can belong to several sections or Collections.</p><h3>QR codes</h3><p>Attach a QR to an item or container. Choose exactly which fields its public page shows in Details → QR code.</p></div></Dialog>}
    {dialog?.kind === "factory" && <Dialog title="Generate labels" onClose={close}><div className="ll-form"><label>Number of QR labels<input type="number" min={1} max={MAX_BATCH_COUNT} value={snapshot.batchCount} onChange={(event) => controller.setBatchCount(Number(event.target.value))} /></label><button className="ll-button ll-primary" disabled={busy} onClick={() => void controller.generateBatch()}>Generate batch</button>{snapshot.lastBatchIds.length > 0 && <><p>{snapshot.lastBatchIds.length} QR labels ready</p><div className="ll-button-row"><button className="ll-button" onClick={() => void controller.downloadCsv(snapshot.lastBatchIds)}><Download size={17} />Download CSV</button><button className="ll-button" onClick={() => void controller.downloadZip()}><Download size={17} />Download ZIP</button></div><div className="ll-generated-ids">{snapshot.lastBatchIds.map((id) => <code key={id}>{id}</code>)}</div></>}{snapshot.error && <p role="alert" className="ll-inline-warning">{snapshot.error}</p>}</div></Dialog>}
  </div>;
}
