import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Extension, type Editor } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { PluginKey, Selection } from "@tiptap/pm/state";
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from "@tiptap/suggestion";
import { Bold, Check, Heading1, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Minus, Pilcrow, Quote, Unlink, X } from "lucide-react";

import {
  LINK_BODY_DOC_VERSION,
  MAX_BODY_LENGTH,
  createLinkBodyDocFromPlainText,
  extractPlainTextFromLinkBodyDoc,
  normalizeLinkBodyHref,
  normalizeLinkBodyDoc,
  type LinkBodyDoc
} from "@life-links/core";

type RichBodyEditorProps = {
  contentKey: string;
  value: LinkBodyDoc | null | undefined;
  fallbackBody: string;
  disabled?: boolean;
  onChange: (next: { body: string; bodyDoc: LinkBodyDoc; bodyDocVersion: number }) => void;
};

type SlashCommandItem = {
  label: string;
  description: string;
  hint: string;
  command: (editor: Editor) => void;
};

const slashPluginKey = new PluginKey("lifeLinksSlashCommand");

const SLASH_COMMANDS: SlashCommandItem[] = [
  { label: "Text", description: "Plain paragraph", hint: "text", command: (editor) => editor.chain().focus().setParagraph().run() },
  { label: "Heading 1", description: "Large section heading", hint: "#", command: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
  { label: "Heading 2", description: "Smaller section heading", hint: "##", command: (editor) => editor.chain().focus().setHeading({ level: 2 }).run() },
  { label: "Bullet list", description: "Unordered list", hint: "-", command: (editor) => editor.chain().focus().toggleBulletList().run() },
  { label: "Numbered list", description: "Ordered list", hint: "1.", command: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { label: "To-do list", description: "Checklist items", hint: "[]", command: (editor) => editor.chain().focus().toggleTaskList().run() },
  { label: "Quote", description: "Inset note", hint: ">", command: (editor) => editor.chain().focus().setBlockquote().run() },
  { label: "Divider", description: "Horizontal rule", hint: "---", command: (editor) => editor.chain().focus().setHorizontalRule().run() }
];

const SlashCommand = Extension.create({
  name: "lifeLinksSlashCommand",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommandItem, SlashCommandItem>({
        editor: this.editor,
        char: "/",
        pluginKey: slashPluginKey,
        startOfLine: false,
        items: ({ query }) => {
          const needle = query.trim().toLowerCase();
          return SLASH_COMMANDS.filter((item) => {
            return (
              item.label.toLowerCase().includes(needle) ||
              item.description.toLowerCase().includes(needle) ||
              item.hint.toLowerCase().includes(needle)
            );
          }).slice(0, 8);
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        render: () => createSlashMenuRenderer()
      })
    ];
  }
});

export function RichBodyEditor({ contentKey, value, fallbackBody, disabled = false, onChange }: RichBodyEditorProps) {
  const lastContentKey = useRef(contentKey);
  const initialContent = useMemo(() => value ?? createLinkBodyDocFromPlainText(fallbackBody), [contentKey, fallbackBody, value]);
  const [bodyLength, setBodyLength] = useState(() => plainTextLength(initialContent));
  const [linkPanelOpen, setLinkPanelOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState("");
  const [, setSelectionVersion] = useState(0);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true },
        link: false
      }),
      Link.configure({
        autolink: true,
        linkOnPaste: true,
        openOnClick: false,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank"
        }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Press '/' for blocks, or use Markdown shortcuts." }),
      SlashCommand
    ],
    content: initialContent,
    editable: !disabled,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "rich-body-editor-surface",
        "aria-label": "Body"
      },
      transformPastedHTML: cleanPastedHtml,
      transformPastedText: cleanPastedText,
      handleDOMEvents: {
        mousedown: collapseSelectedTextOnPlainClick
      }
    },
    onUpdate: ({ editor: updatedEditor }) => {
      const bodyDoc = normalizeLinkBodyDoc(updatedEditor.getJSON()) ?? createLinkBodyDocFromPlainText("");
      const body = extractPlainTextFromLinkBodyDoc(bodyDoc).slice(0, MAX_BODY_LENGTH);
      setBodyLength(body.length);
      onChange({
        body,
        bodyDoc,
        bodyDocVersion: LINK_BODY_DOC_VERSION
      });
    },
    onSelectionUpdate: () => {
      setSelectionVersion((version) => version + 1);
    }
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useEffect(() => {
    if (!editor || lastContentKey.current === contentKey) {
      return;
    }
    const nextContent = value ?? createLinkBodyDocFromPlainText(fallbackBody);
    lastContentKey.current = contentKey;
    const normalizedContent = normalizeLinkBodyDoc(nextContent) ?? createLinkBodyDocFromPlainText("");
    const body = extractPlainTextFromLinkBodyDoc(normalizedContent).slice(0, MAX_BODY_LENGTH);
    setBodyLength(body.length);
    editor.commands.setContent(nextContent, { emitUpdate: false });
    onChange({
      body,
      bodyDoc: normalizedContent,
      bodyDocVersion: LINK_BODY_DOC_VERSION
    });
  }, [contentKey, editor, fallbackBody, value]);

  const toolbarDisabled = disabled || !editor;
  const currentLinkHref = editor ? getCurrentLinkHref(editor) : "";

  function openLinkPanel() {
    if (!editor) {
      return;
    }
    setLinkDraft(getCurrentLinkHref(editor));
    setLinkError("");
    setLinkPanelOpen(true);
  }

  function closeLinkPanel() {
    setLinkPanelOpen(false);
    setLinkError("");
  }

  function applyLink() {
    if (!editor) {
      return;
    }
    const href = normalizeEditableHref(linkDraft);
    if (!href) {
      setLinkError("Enter a URL or email.");
      return;
    }
    let command = editor.chain().focus();
    if (editor.isActive("link")) {
      command = command.extendMarkRange("link");
    }
    command.setLink({ href }).run();
    setLinkDraft(href);
    closeLinkPanel();
  }

  function removeLink() {
    if (!editor) {
      return;
    }
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkDraft("");
    closeLinkPanel();
  }

  return (
    <div className="rich-body-shell">
      <div className="format-toolbar rich-toolbar" aria-label="Body formatting tools">
        <RichToolbarButton
          label="Paragraph"
          active={editor?.isActive("paragraph")}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().setParagraph().run()}
        >
          <Pilcrow size={16} />
        </RichToolbarButton>
        <RichToolbarButton
          label="Heading 1"
          active={editor?.isActive("heading", { level: 1 })}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={16} />
        </RichToolbarButton>
        <RichToolbarButton
          label="Heading 2"
          active={editor?.isActive("heading", { level: 2 })}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={16} />
        </RichToolbarButton>
        <span className="toolbar-divider" />
        <RichToolbarButton label="Bold" active={editor?.isActive("bold")} disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </RichToolbarButton>
        <RichToolbarButton label="Italic" active={editor?.isActive("italic")} disabled={toolbarDisabled} onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </RichToolbarButton>
        <RichToolbarButton label="Link" active={editor?.isActive("link")} disabled={toolbarDisabled} onClick={openLinkPanel}>
          <Link2 size={16} />
        </RichToolbarButton>
        <RichToolbarButton label="Remove link" disabled={toolbarDisabled || !editor?.isActive("link")} onClick={removeLink}>
          <Unlink size={16} />
        </RichToolbarButton>
        <span className="toolbar-divider" />
        <RichToolbarButton
          label="Bullet list"
          active={editor?.isActive("bulletList")}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={16} />
        </RichToolbarButton>
        <RichToolbarButton
          label="Numbered list"
          active={editor?.isActive("orderedList")}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={16} />
        </RichToolbarButton>
        <RichToolbarButton
          label="To-do list"
          active={editor?.isActive("taskList")}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        >
          <ListChecks size={16} />
        </RichToolbarButton>
        <RichToolbarButton
          label="Quote"
          active={editor?.isActive("blockquote")}
          disabled={toolbarDisabled}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={16} />
        </RichToolbarButton>
        <RichToolbarButton label="Divider" disabled={toolbarDisabled} onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
          <Minus size={16} />
        </RichToolbarButton>
      </div>
      {editor ? (
        <BubbleMenu
          editor={editor}
          pluginKey="lifeLinksSelectionBubble"
          updateDelay={80}
          options={{ placement: "top", offset: 8, flip: true, shift: { padding: 8 } }}
          shouldShow={({ editor: menuEditor, state }) => {
            if (disabled || !menuEditor.isEditable) {
              return false;
            }
            return linkPanelOpen || !state.selection.empty || menuEditor.isActive("link");
          }}
          className={linkPanelOpen ? "selection-bubble-menu link-open" : "selection-bubble-menu"}
          aria-label="Selection formatting tools"
        >
          {linkPanelOpen ? (
            <div className="selection-link-panel">
              <label>
                <span>Link URL</span>
                <input
                  value={linkDraft}
                  onChange={(event) => {
                    setLinkDraft(event.target.value);
                    setLinkError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyLink();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      closeLinkPanel();
                    }
                  }}
                  placeholder="https://example.com"
                  aria-label="Link URL"
                />
              </label>
              {linkError ? <span className="selection-link-error">{linkError}</span> : null}
              <div className="selection-link-actions">
                <button type="button" className="icon-button format-button" onClick={applyLink} aria-label="Apply link" title="Apply link">
                  <Check size={16} />
                </button>
                <button type="button" className="icon-button format-button" onClick={closeLinkPanel} aria-label="Cancel link edit" title="Cancel">
                  <X size={16} />
                </button>
                <button
                  type="button"
                  className="icon-button format-button"
                  onClick={removeLink}
                  disabled={!currentLinkHref}
                  aria-label="Remove link"
                  title="Remove link"
                >
                  <Unlink size={16} />
                </button>
              </div>
            </div>
          ) : (
            <>
              <RichToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
                <Bold size={16} />
              </RichToolbarButton>
              <RichToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
                <Italic size={16} />
              </RichToolbarButton>
              <span className="toolbar-divider" />
              <RichToolbarButton label="Link" active={editor.isActive("link")} onClick={openLinkPanel}>
                <Link2 size={16} />
              </RichToolbarButton>
              <RichToolbarButton label="Remove link" disabled={!currentLinkHref} onClick={removeLink}>
                <Unlink size={16} />
              </RichToolbarButton>
              <span className="toolbar-divider" />
              <RichToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
                <List size={16} />
              </RichToolbarButton>
              <RichToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
                <ListOrdered size={16} />
              </RichToolbarButton>
              <RichToolbarButton label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
                <Quote size={16} />
              </RichToolbarButton>
            </>
          )}
        </BubbleMenu>
      ) : null}
      <EditorContent editor={editor} />
      <div className="rich-body-helper" aria-live="polite">
        <span>Type / for blocks. Markdown shortcuts work too.</span>
        <span>{bodyLength.toLocaleString()} / {MAX_BODY_LENGTH.toLocaleString()}</span>
      </div>
    </div>
  );
}

function RichToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick
}: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "icon-button format-button active" : "icon-button format-button"}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={Boolean(active)}
      title={label}
    >
      {children}
    </button>
  );
}

function createSlashMenuRenderer() {
  let element: HTMLDivElement | null = null;
  let selectedIndex = 0;
  let lastProps: SuggestionProps<SlashCommandItem, SlashCommandItem> | null = null;

  function update(props: SuggestionProps<SlashCommandItem, SlashCommandItem>) {
    lastProps = props;
    selectedIndex = Math.min(selectedIndex, Math.max(0, props.items.length - 1));
    if (!element) {
      element = document.createElement("div");
      element.className = "slash-command-menu";
      element.setAttribute("role", "listbox");
      element.setAttribute("aria-label", "Body block commands");
      document.body.appendChild(element);
    }

    const children: HTMLElement[] = [];
    if (!props.items.length) {
      const empty = document.createElement("div");
      empty.className = "slash-command-empty";
      empty.textContent = "No matching blocks";
      children.push(empty);
    } else {
      props.items.forEach((item, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = index === selectedIndex ? "active" : "";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(index === selectedIndex));

        const copy = document.createElement("span");
        copy.className = "slash-command-copy";
        const label = document.createElement("span");
        label.textContent = item.label;
        const description = document.createElement("small");
        description.textContent = item.description;
        copy.append(label, description);

        const hint = document.createElement("kbd");
        hint.textContent = item.hint;

        button.append(copy, hint);
        button.onmousedown = (event) => {
          event.preventDefault();
          props.command(item);
        };
        children.push(button);
      });
    }

    element.replaceChildren(...children);
    positionSlashMenu(element, props.clientRect?.() ?? null);
    element.querySelector("button.active")?.scrollIntoView({ block: "nearest" });
  }

  return {
    onStart: update,
    onUpdate: update,
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (!lastProps?.items.length) {
        return event.key === "Escape";
      }
      if (event.key === "ArrowDown") {
        selectedIndex = (selectedIndex + 1) % lastProps.items.length;
        update(lastProps);
        return true;
      }
      if (event.key === "ArrowUp") {
        selectedIndex = (selectedIndex + lastProps.items.length - 1) % lastProps.items.length;
        update(lastProps);
        return true;
      }
      if (event.key === "Enter") {
        lastProps.command(lastProps.items[selectedIndex]);
        return true;
      }
      return event.key === "Escape";
    },
    onExit: () => {
      element?.remove();
      element = null;
      lastProps = null;
      selectedIndex = 0;
    }
  };
}

function positionSlashMenu(element: HTMLElement, rect: DOMRect | null) {
  if (!rect) {
    return;
  }
  const margin = 12;
  const width = Math.min(320, Math.max(220, window.innerWidth - margin * 2));
  element.style.width = `${width}px`;

  const viewportLeft = window.scrollX + margin;
  const viewportRight = window.scrollX + window.innerWidth - width - margin;
  const left = Math.min(Math.max(rect.left + window.scrollX, viewportLeft), Math.max(viewportLeft, viewportRight));

  const preferredTop = rect.bottom + window.scrollY + 8;
  const maxTop = window.scrollY + window.innerHeight - element.offsetHeight - margin;
  const top = Math.min(Math.max(preferredTop, window.scrollY + margin), Math.max(window.scrollY + margin, maxTop));

  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

function getCurrentLinkHref(editor: Editor): string {
  const href = editor.getAttributes("link").href;
  return typeof href === "string" ? href : "";
}

function normalizeEditableHref(raw: string): string {
  const value = raw.trim();
  if (!value || /\s/.test(value)) {
    return "";
  }
  const existingHref = normalizeLinkBodyHref(value);
  if (existingHref) {
    return existingHref;
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return `mailto:${value}`;
  }
  if (/^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?::\d{1,5})?(?:[/?#][^\s]*)?$/.test(value)) {
    return normalizeLinkBodyHref(`https://${value}`);
  }
  return "";
}

function cleanPastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html;
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, meta, link").forEach((node) => node.remove());
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    const originalHref = tagName === "a" ? element.getAttribute("href") : null;
    for (const attribute of Array.from(element.attributes)) {
      element.removeAttribute(attribute.name);
    }
    if (tagName === "a") {
      const href = normalizeLinkBodyHref(originalHref);
      if (href) {
        element.setAttribute("href", href);
      }
    }
  }
  return doc.body.innerHTML;
}

function cleanPastedText(text: string): string {
  return text.replace(/\r\n?/g, "\n").slice(0, MAX_BODY_LENGTH);
}

function collapseSelectedTextOnPlainClick(view: Editor["view"], event: Event): boolean {
  if (!(event instanceof MouseEvent) || event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  }
  if (!view.editable || view.state.selection.empty) {
    return false;
  }
  const target = event.target instanceof Node ? event.target : null;
  if (!target || !view.dom.contains(target)) {
    return false;
  }

  const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
  const selection = position ? Selection.near(view.state.doc.resolve(position.pos), 1) : Selection.atEnd(view.state.doc);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
  return false;
}

function plainTextLength(doc: LinkBodyDoc) {
  return extractPlainTextFromLinkBodyDoc(normalizeLinkBodyDoc(doc) ?? createLinkBodyDocFromPlainText("")).length;
}
