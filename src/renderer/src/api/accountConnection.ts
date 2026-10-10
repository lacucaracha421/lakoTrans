/** Account refreshes share in-flight work; late reads cannot overwrite login/logout. */
export function createAccountConnection<T>(read: () => Promise<T>) {
  let snapshot: T | null = null;
  let pending: Promise<T | null> | null = null;
  let revision = 0;
  let checked = false;
  const listeners = new Set<() => void>();
  const connection = {
    getSnapshot: () => snapshot,
    isChecked: () => checked,
    getRevision: () => revision,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (next: T | null) => {
      revision++;
      checked = true;
      snapshot = next;
      for (const listener of listeners) listener();
    },
    refresh: (): Promise<T | null> => {
      if (pending) return pending;
      const started = revision;
      pending = read()
        .then((next) => {
          if (revision === started) connection.publish(next);
          return snapshot;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
  return connection;
}
