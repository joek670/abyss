/**
 * toast.js — transient notifications.
 *
 * Toasts are announced through the aria-live region in index.html, so a screen
 * reader hears a saved dive without the focus being stolen from the form.
 */
import { h } from './dom.js';

let host = null;

function ensureHost() {
  if (!host) host = document.getElementById('toasts');
  return host;
}

export function toast(message, { title = '', tone = 'accent', duration = 4200 } = {}) {
  const el = ensureHost();
  if (!el) return () => {};

  const colours = {
    accent: 'var(--accent)',
    lure: 'var(--lure)',
    danger: 'var(--danger)',
    ok: 'var(--ok)',
  };

  const node = h(
    'div.toast',
    { style: { '--toast-color': colours[tone] ?? colours.accent }, role: 'status' },
    h(
      'div.stack.stack-2',
      null,
      title ? h('div.toast__title', null, title) : null,
      h('div.toast__msg', null, message),
    ),
  );

  el.appendChild(node);

  const dismiss = () => {
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
  };

  const timer = setTimeout(dismiss, duration);
  node.addEventListener('click', () => {
    clearTimeout(timer);
    dismiss();
  });

  return dismiss;
}

export const notifyError = (err) =>
  toast(err?.message ?? 'Something went wrong', { title: 'Error', tone: 'danger', duration: 6000 });
