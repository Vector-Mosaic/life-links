import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link2, X } from "lucide-react";

const focusable = 'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]';

export function LifeLinksGlyph({ double = false }: { double?: boolean }) {
  return double ? <span className="ll-double-link" aria-hidden="true"><Link2 /><Link2 /></span> : <Link2 aria-hidden="true" />;
}

export function Dialog({ title, children, onClose, wide = false, closeLabel, closeDisabled = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean; closeLabel?: string; closeDisabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = closeDisabled ? () => undefined : onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(focusable)?.focus());
    function key(event: KeyboardEvent) {
      if ((event.target as Element | null)?.closest(".ll-menu")) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? []).filter((node) => node.getClientRects().length);
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", key, true);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", key, true); previous?.focus(); };
  }, []);
  return createPortal(<div className="ll-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRef.current(); }}>
    <div ref={ref} className={`ll-dialog${wide ? " ll-dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header><h2 id={titleId}>{title}</h2><button className="ll-icon-button" aria-label={closeLabel ?? `Close ${title}`} title="Close" disabled={closeDisabled} onClick={onClose}><X size={19} /></button></header>
      <div className="ll-dialog-body">{children}</div>
    </div>
  </div>, document.body);
}

export type MenuItem = { label: string; icon?: ReactNode; onClick(): void; disabled?: boolean; danger?: boolean } | { separator: true };

export function ActionMenu({ label, children, items, className = "", heading, above = false, onOpenChange }: { label: string; children: ReactNode; items: MenuItem[]; className?: string; heading?: ReactNode; above?: boolean; onOpenChange?(open: boolean): void }) {
  const [position, setPosition] = useState<{ left: number; top: number; bottom?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(Boolean(position)); }, [position]);
  const close = () => setPosition(null);
  useEffect(() => { close(); }, [label]);
  useEffect(() => () => onOpenChangeRef.current?.(false), []);
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    function outside(event: PointerEvent) { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); trigger.current?.focus(); }
      if (event.key === "Tab") close();
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []);
      if (!items.length) return;
      event.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next].focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", close); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" className={className || "ll-icon-button"} title={label} aria-label={label} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined} onClick={() => {
      if (position) { close(); return; }
      const rect = trigger.current!.getBoundingClientRect();
      const left = Math.max(10, Math.min(above ? rect.left : rect.right - 248, window.innerWidth - 258));
      setPosition(above ? { left, top: 0, bottom: window.innerHeight - rect.top + 8 } : { left, top: Math.min(rect.bottom + 8, window.innerHeight - 260) });
    }}>{children}</button>
    {position && createPortal(<div ref={menu} id={id} role="menu" aria-label={label} className="ll-menu" style={{ left: position.left, top: position.bottom === undefined ? position.top : undefined, bottom: position.bottom, maxHeight: Math.max(0, window.innerHeight - (position.bottom ?? position.top) - 10) }}>
      {heading && <div className="ll-menu-identity">{heading}</div>}
      {items.map((item, index) => "separator" in item ? <hr role="separator" key={index} /> : <button role="menuitem" type="button" disabled={item.disabled} className={item.danger ? "ll-danger-text" : undefined} key={`${index}-${item.label}`} onClick={() => { close(); trigger.current?.focus(); item.onClick(); }}>{item.icon}{item.label}</button>)}
    </div>, document.body)}
  </>;
}
