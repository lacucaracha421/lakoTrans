import React from "react";

export type ObserveBlockLibraryPreview = (
  element: Element,
  onVisibility: (visible: boolean) => void,
) => () => void;

/** One observer per library dialog; leaving the viewport releases artwork. */
export function useBlockLibraryPreviewObserver(): ObserveBlockLibraryPreview {
  const callbacks = React.useRef(
    new Map<Element, (visible: boolean) => void>(),
  );
  const observer = React.useRef<IntersectionObserver | null>(null);
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const instance = new IntersectionObserver((entries) => {
      for (const entry of entries)
        callbacks.current.get(entry.target)?.(entry.isIntersecting);
    });
    observer.current = instance;
    for (const element of callbacks.current.keys()) instance.observe(element);
    return () => {
      instance.disconnect();
      observer.current = null;
    };
  }, []);
  return React.useCallback((element, onVisibility) => {
    if (typeof IntersectionObserver === "undefined") {
      onVisibility(true);
      return () => undefined;
    }
    callbacks.current.set(element, onVisibility);
    observer.current?.observe(element);
    return () => {
      callbacks.current.delete(element);
      observer.current?.unobserve(element);
    };
  }, []);
}

export function useBlockLibraryPreviewVisibility(
  observePreview?: ObserveBlockLibraryPreview,
) {
  const ref = React.useRef<HTMLElement>(null);
  const [visible, setVisible] = React.useState(!observePreview);
  const [focused, setFocused] = React.useState(false);
  React.useEffect(() => {
    if (!observePreview || !ref.current) return;
    return observePreview(ref.current, setVisible);
  }, [observePreview]);
  return {
    visible: visible || focused,
    frameProps: {
      ref,
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      },
    },
  };
}
