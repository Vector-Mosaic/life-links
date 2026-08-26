export function Tooltip({ text }: { text: string }) {
  return (
    <span className="tooltip-bubble" aria-hidden="true">
      {text}
    </span>
  );
}
