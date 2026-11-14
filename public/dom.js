/**
 * DOM helpers. Every node is built with DOM APIs (never innerHTML), so pasted
 * data and model output cannot inject markup.
 */

import { $ } from './state.js';

export function h(tag, attrs) {
  const el = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  });
  for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
  return el;
}

export function append(el, kid) {
  if (kid == null || kid === false) return;
  if (Array.isArray(kid)) kid.forEach((k) => { append(el, k); });
  else el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
}

export function replace(el) {
  el.textContent = '';
  for (let i = 1; i < arguments.length; i++) append(el, arguments[i]);
}

export function setStatus(text, busy) {
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('busy', Boolean(busy));
}

export function showError(text) {
  const el = $('error');
  el.hidden = !text;
  el.textContent = text || '';
  if (text) el.scrollIntoView({ block: 'center' });
}

export function copyText(text, button) {
  const done = function () {
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = old; }, 1600);
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); done(); });
  } else {
    fallbackCopy(text);
    done();
  }
}

export function fallbackCopy(text) {
  const ta = h('textarea', { class: 'visually-hidden', 'aria-hidden': 'true' });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* nothing more to try */ }
  ta.remove();
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => { URL.revokeObjectURL(url); }, 500);
}

export function catChip(category) {
  return category ? h('span', { class: `cat cat-${  category.key}`, text: category.label }) : null;
}

export function withUnit(value, unit) {
  return value + (unit ? ` ${  unit}` : '');
}
