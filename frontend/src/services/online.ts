/**
 * Whether the backend answers.
 *
 * A module-level observable rather than context: exactly two consumers (the
 * navbar pill and the submit buttons), and no part of the tree should have to be
 * wrapped for it.
 *
 * The reason it exists: when the server is not running, every form in the app
 * stayed live and failed at submit with "Backend unavailable". For a local app
 * the commonest failure by far is that the server is not running, and it should
 * say so once, at the top, rather than once per form.
 */

let online = true;
const subscribers = new Set<(value: boolean) => void>();

export function isOnline(): boolean {
  return online;
}

export function setOnline(value: boolean): void {
  if (value === online) return;
  online = value;
  for (const notify of subscribers) notify(value);
}

export function subscribeOnline(notify: () => void): () => void {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}
