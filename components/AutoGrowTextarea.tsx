import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** Chrome 123+ sizes a textarea to its content in CSS; checked once. */
const FIELD_SIZING = (() => {
  try {
    return CSS.supports('field-sizing', 'content');
  } catch {
    return false;
  }
})();

/**
 * A textarea that starts three lines tall and grows with its text, up to about twelve lines,
 * then scrolls (spec §4.2). CSS `field-sizing: content` does it in Chrome 123+. Older ones (the
 * minimum is 116) measure scrollHeight when the text changes and when the width changes (the
 * text rewraps); they can't also be resized by hand, since the next keystroke would undo it.
 */
export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AutoGrowTextarea({ value, className = '', ...props }, ref) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = own.current;
    if (!element || FIELD_SIZING) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight + 2}px`;
    };
    fit();
    let width = element.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (element.clientWidth === width) return;
            width = element.clientWidth;
            fit();
          });
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [value]);
  return (
    <textarea
      {...props}
      ref={(element) => {
        own.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
      }}
      rows={3}
      value={value}
      className={`${className} field-sizing-content max-h-[18rem] min-h-[4.75rem] ${
        FIELD_SIZING ? 'resize-y' : 'resize-none'
      }`}
    />
  );
});
