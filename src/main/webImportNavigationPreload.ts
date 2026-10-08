// Cancelling here precedes Chromium's parser teardown for an early script redirect.
// No app bridge or Node capability is exposed to the untrusted page.
if (window === window.top) {
  window.navigation?.addEventListener("navigate", (event) => {
    if (!event.destination.sameDocument && event.cancelable)
      event.preventDefault();
  });
}

export {};
