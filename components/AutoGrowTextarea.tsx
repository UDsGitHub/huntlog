import { forwardRef, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

const supportsFieldSizing = () => {
  try {
    return CSS.supports('field-sizing', 'content');
  } catch {
    return false;
  }
};

/**
 * A textarea that starts three lines tall and grows with its text, up to about twelve lines,
 * then scrolls (spec §4.2). CSS `field-sizing: content` does it in Chrome 123+; older ones (the
 * minimum is 116) get the same from measuring scrollHeight.
 */
export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function AutoGrowTextarea({ value, className = '', ...props }, ref) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const element = own.current;
    if (!element || supportsFieldSizing()) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
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
      className={`${className} field-sizing-content max-h-[18rem] min-h-[4.75rem] resize-y`}
    />
  );
});
